#!/usr/bin/env python3
"""NEU Agent - trang tổng quan quản trị (máy 220). Chỉ dùng thư viện chuẩn của Python 3.

Đọc JSONL chẩn đoán (giữ 90 ngày) + nhật ký nginx (giữ 14 ngày, số liệu theo ngày được cộng dồn sang nginx-daily.json) rồi viết:
  <out>/index.html   trang tổng quan (một tệp tĩnh, biểu đồ SVG, không script, không tài nguyên ngoài) — là trang mặc định của /agent/admin/
  <out>/stats.json   cùng số liệu dạng JSON
  <out>/nginx-daily.json  số liệu nginx theo ngày (tích luỹ vượt thời hạn giữ nhật ký)

Người dùng chỉ hiện dưới dạng MÃ GIẢ DANH (HMAC của email, 8 ký tự đầu): không email, không nội dung. Ngày tính theo giờ Việt Nam.
Chạy mỗi 10 phút bởi neu-agent-diag-stats.timer; báo cáo chất lượng chi tiết (latest.html) vẫn do report.py tạo hằng ngày.

  python3 stats.py [--diag-dir D] [--nginx-log F] [--out DIR] [--health FILE] [--now ISO|epoch]
"""
import argparse
import collections
import datetime
import glob
import html
import json
import os
import sys

import report as R

TZ = R.TZ
DAYS = 30            # số ngày trong biểu đồ
HIST_DAYS = 90       # khớp thời hạn giữ dữ liệu của bộ thu
TOP_USERS = 100
DAILY_KEEP = 400
SPARK_DAYS = 14
OUTCOMES = ("ok", "interrupted", "error", "step_limit", "loop")
OUTCOME_VI = {"ok": "Thành công", "interrupted": "Bị ngắt", "error": "Lỗi", "step_limit": "Chạm giới hạn bước", "loop": "Lặp"}
STATUS_CLS = {"mới": "bn", "hoạt động": "ba", "ngủ đông": "bd"}
ERR_VI = {"not_found": "Không có file/thư mục", "outside_project": "Đường dẫn ngoài dự án", "read_first": "Sửa trước khi đọc", "stale": "File đã đổi sau khi đọc", "binary": "File nhị phân", "bad_args": "Thiếu/sai tham số",
          "no_match": "Không tìm thấy đoạn cần sửa", "ambiguous": "Đoạn cần sửa không duy nhất", "wrong_type": "Nhầm file/thư mục", "sandbox": "Dùng thứ sandbox không có", "program": "Chương trình/test của người dùng lỗi (bình thường)",
          "timeout": "Quá thời gian", "unsupported": "Không hỗ trợ", "denied": "Bị từ chối quyền", "hook": "Bị hook chặn", "unknown_tool": "Công cụ không tồn tại", "bad_json": "Tham số không phải JSON", "internal": "Lỗi nội bộ", "other": "Khác", "unknown": "Chưa rõ (bản cũ)"}
NOT_TOOL_FAULT = ("program", "denied")  # kết quả bình thường/ý người dùng, không tính là công cụ lỗi
WD = ("T2", "T3", "T4", "T5", "T6", "T7", "CN")


def vn_day(ts):
    return datetime.datetime.fromtimestamp(ts, TZ).date().isoformat()


# ---------------------------------------------------------------- nginx theo ngày (cộng dồn)
def nginx_daily(rows):
    d = collections.defaultdict(lambda: {"req": 0, "chat": 0, "chat_ok": 0, "chat_5xx": 0, "pkg": 0, "update_check": 0, "diag": 0})
    for r in rows:
        x = d[vn_day(r["_ts"])]
        x["req"] += 1
        route, st = r.get("route"), r["status"]
        if route == "vllm_chat":
            x["chat"] += 1
            x["chat_ok"] += st == 200
            x["chat_5xx"] += st >= 500
        elif route == "download_pkg" and st == 200:
            x["pkg"] += 1
        elif route == "download" and st == 200:
            x["update_check"] += 1
        elif route == "diag":
            x["diag"] += 1
    return dict(d)


def merge_daily(path, fresh, today):
    """Ngày có trong nhật ký hiện tại thì ghi đè (đầy đủ hơn); ngày đã bị xoay vòng khỏi nhật ký thì giữ bản cũ."""
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
        if not isinstance(old, dict):
            old = {}
    except (OSError, ValueError):
        old = {}
    old.update(fresh)
    cutoff = (datetime.date.fromisoformat(today) - datetime.timedelta(days=DAILY_KEEP)).isoformat()
    return {k: v for k, v in sorted(old.items()) if k >= cutoff}


# ---------------------------------------------------------------- tính toán
def _bucket(v, edges, labels):
    for e, lab in zip(edges, labels):
        if v <= e:
            return lab
    return labels[-1]


def compute(recs, daily, now, findings=None, release=None):
    t = now.timestamp()
    today = vn_day(t)
    days = [(datetime.date.fromisoformat(today) - datetime.timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
    t30 = t - DAYS * 86400
    U = {}
    D = collections.defaultdict(lambda: {"users": set(), "installs": set(), "turns": 0, "out": collections.Counter(), "dur": [], "ttft": [], "ptok": 0, "ctok": 0, "tool_calls": 0, "tool_fails": 0, "signals": 0, "llm_errors": 0, "retries": 0})
    heat = [[0] * 24 for _ in range(7)]
    dist = {k: collections.defaultdict(lambda: {"users": set(), "installs": set(), "turns": 0}) for k in ("version", "platform", "profile", "model")}
    tools = collections.defaultdict(lambda: {"calls": 0, "fails": 0, "prog": 0})
    tool_err = collections.Counter()
    signals, llm_err, outcomes30 = collections.Counter(), collections.Counter(), collections.Counter()
    # cửa sổ trượt: (đầu, cuối) tính bằng giây trước hiện tại
    W = {"24h": (0, 86400), "p24": (86400, 172800), "7d": (0, 7 * 86400), "p7": (7 * 86400, 14 * 86400), "30d": (0, 30 * 86400), "p30": (30 * 86400, 60 * 86400), "all": (0, HIST_DAYS * 86400)}
    win = {k: {"users": set(), "installs": set(), "turns": 0, "errors": 0} for k in W}
    for r in recs:
        ts, uid, a, e = r["ts_srv"], r.get("uid") or "?", r.get("a") or {}, r["e"]
        et = e.get("t")
        dt = datetime.datetime.fromtimestamp(ts, TZ)
        day = dt.date().isoformat()
        ins = a.get("install")
        age = t - ts
        is_turn, is_err = et == "turn", et == "turn" and e.get("end") == "error"
        for k, (lo, hi) in W.items():
            if lo <= age < hi:
                w = win[k]
                w["users"].add(uid)
                w["installs"].add(ins)
                w["turns"] += is_turn
                w["errors"] += is_err
        u = U.setdefault(uid, {"first": ts, "last": ts, "days": set(), "turns": 0, "turns30": 0, "errors": 0, "by_day": collections.Counter(), "prof": collections.Counter(), "plat": collections.Counter(), "ver": "", "model": "", "ver_ts": 0, "installs": set()})
        u["first"], u["last"] = min(u["first"], ts), max(u["last"], ts)
        u["days"].add(day)
        u["installs"].add(ins)
        if ts >= u["ver_ts"]:
            u["ver_ts"], u["ver"], u["model"] = ts, str(a.get("version", "")), str(a.get("model", ""))
        pd = D[day]
        pd["users"].add(uid)
        pd["installs"].add(ins)
        in30 = ts >= t30
        if is_turn:
            u["turns"] += 1
            u["errors"] += is_err
            u["by_day"][day] += 1
            u["prof"][str(a.get("profile", "?"))] += 1
            u["plat"][str(a.get("platform", "?"))] += 1
            pd["turns"] += 1
            pd["out"][e.get("end", "?")] += 1
            if "dur_s" in e:
                pd["dur"].append(e["dur_s"])
            if "ttft_ms" in e:
                pd["ttft"].append(e["ttft_ms"])
            pd["ptok"] += e.get("prompt_tok", 0)
            pd["ctok"] += e.get("completion_tok", 0)
            if in30:
                u["turns30"] += 1
                heat[dt.weekday()][dt.hour] += 1
                outcomes30[e.get("end", "?")] += 1
        elif et == "tool":
            failed = e.get("ok") is False
            real = failed and e.get("err") not in NOT_TOOL_FAULT
            pd["tool_calls"] += 1
            pd["tool_fails"] += real
            if in30:
                x = tools[e.get("name", "other")]
                x["calls"] += 1
                x["fails"] += real
                x["prog"] += failed and not real
                if failed:
                    tool_err[e.get("err") or "unknown"] += 1
        elif et == "signal":
            pd["signals"] += 1
            if in30:
                signals[e.get("code", "?")] += 1
        elif et == "llm_error":
            pd["llm_errors"] += 1
            if in30:
                llm_err[e.get("kind", "?")] += 1
        elif et == "llm_retry":
            pd["retries"] += 1
        if in30:
            for k in dist:
                x = dist[k][str(a.get(k, "?"))]
                x["users"].add(uid)
                x["installs"].add(ins)
                x["turns"] += is_turn

    def n(k, f):
        return len(win[k][f])

    def er(k):
        return R.ratio(win[k]["errors"], win[k]["turns"]) if win[k]["turns"] else None

    new7 = {uid for uid, u in U.items() if u["first"] >= t - 7 * 86400}
    new30 = {uid for uid, u in U.items() if u["first"] >= t - 30 * 86400}
    prev7 = win["p7"]["users"]
    kpi = {
        "users_24h": n("24h", "users"), "users_7d": n("7d", "users"), "users_30d": n("30d", "users"), "users_total": n("all", "users"),
        "installs_24h": n("24h", "installs"), "installs_7d": n("7d", "installs"), "installs_30d": n("30d", "installs"), "installs_total": n("all", "installs"),
        "turns_24h": win["24h"]["turns"], "turns_7d": win["7d"]["turns"], "turns_30d": win["30d"]["turns"], "turns_total": win["all"]["turns"],
        "new_users_7d": len(new7), "new_users_30d": len(new30),
        "returning_7d": R.ratio(len(win["7d"]["users"] & prev7), len(prev7)) if prev7 else None,
        "error_rate_7d": er("7d"), "error_rate_prev7": er("p7"),
        "prev": {"users_24h": n("p24", "users"), "users_7d": n("p7", "users"), "users_30d": n("p30", "users"), "turns_24h": win["p24"]["turns"], "turns_7d": win["p7"]["turns"], "turns_30d": win["p30"]["turns"]},
    }
    first_seen_day = {uid: vn_day(u["first"]) for uid, u in U.items()}
    new_by_day = collections.Counter(first_seen_day.values())
    first_day = min(D) if D else today
    series = []
    for d in days:
        pd, ng = D.get(d), daily.get(d, {})
        out = pd["out"] if pd else collections.Counter()
        series.append({
            "day": d, "users": len(pd["users"]) if pd else 0, "installs": len(pd["installs"]) if pd else 0,
            "new": new_by_day.get(d, 0) if d > first_day else 0, "turns": pd["turns"] if pd else 0, "errors": out.get("error", 0),
            "outcomes": {k: out.get(k, 0) for k in OUTCOMES},
            "error_rate": R.ratio(out.get("error", 0), pd["turns"]) if pd and pd["turns"] else None,
            "dur_p50": R.pct(pd["dur"], 50) if pd else None, "dur_p95": R.pct(pd["dur"], 95) if pd else None,
            "ttft_p50": R.pct(pd["ttft"], 50) if pd else None, "ttft_p95": R.pct(pd["ttft"], 95) if pd else None,
            "ptok": pd["ptok"] if pd else 0, "ctok": pd["ctok"] if pd else 0,
            "tool_calls": pd["tool_calls"] if pd else 0, "tool_fails": pd["tool_fails"] if pd else 0,
            "signals": pd["signals"] if pd else 0, "llm_errors": pd["llm_errors"] if pd else 0,
            "chat": ng.get("chat", 0), "chat_5xx": ng.get("chat_5xx", 0), "pkg": ng.get("pkg", 0), "update_check": ng.get("update_check", 0)})
    spark_days = days[-SPARK_DAYS:]
    seg = {"new": 0, "active": 0, "dormant": 0}
    for u in U.values():
        if u["first"] >= t - 7 * 86400:
            seg["new"] += 1
        elif u["last"] >= t - 7 * 86400:
            seg["active"] += 1
        else:
            seg["dormant"] += 1
    funnel = [("Máy đã cài và gửi dữ liệu", len({i for u in U.values() for i in u["installs"]})), ("Người dùng", len(U)),
              ("Có ≥ 1 lượt làm việc", sum(1 for u in U.values() if u["turns"] >= 1)), ("Có ≥ 5 lượt", sum(1 for u in U.values() if u["turns"] >= 5)),
              ("Dùng ≥ 2 ngày khác nhau", sum(1 for u in U.values() if len(u["days"]) >= 2)), ("Dùng ≥ 5 ngày khác nhau", sum(1 for u in U.values() if len(u["days"]) >= 5))]
    tl, dl = ["1", "2–4", "5–9", "10–19", "20–49", "≥ 50"], ["1 ngày", "2 ngày", "3–6 ngày", "7–13 ngày", "≥ 14 ngày"]
    hist_turns, hist_days = collections.Counter(), collections.Counter()
    for u in U.values():
        hist_turns[_bucket(u["turns"], (1, 4, 9, 19, 49), tl)] += 1
        hist_days[_bucket(len(u["days"]), (1, 2, 6, 13), dl)] += 1
    users = []
    for uid, u in sorted(U.items(), key=lambda kv: (-kv[1]["turns30"], -kv[1]["last"]))[:TOP_USERS]:
        st = "mới" if u["first"] >= t - 7 * 86400 else ("hoạt động" if u["last"] >= t - 7 * 86400 else "ngủ đông")
        users.append({"id": uid[:8], "status": st, "first": vn_day(u["first"]), "last": datetime.datetime.fromtimestamp(u["last"], TZ).strftime("%Y-%m-%d %H:%M"),
                      "days": len(u["days"]), "turns30": u["turns30"], "turns": u["turns"], "error_rate": R.ratio(u["errors"], u["turns"]) if u["turns"] else None,
                      "spark": [u["by_day"].get(d, 0) for d in spark_days],
                      "profile": (u["prof"].most_common(1) or [("—", 0)])[0][0], "platform": (u["plat"].most_common(1) or [("—", 0)])[0][0], "version": u["ver"], "model": u["model"]})
    dists = {k: [{"value": v, "users": len(x["users"]), "installs": len(x["installs"]), "turns": x["turns"]} for v, x in sorted(d.items(), key=lambda kv: (-len(kv[1]["users"]), -kv[1]["turns"]))] for k, d in dist.items()}
    hours = [sum(heat[w][h] for w in range(7)) for h in range(24)]
    return {
        "generated": datetime.datetime.fromtimestamp(t, TZ).strftime("%Y-%m-%d %H:%M"), "today": today, "kpi": kpi, "series": series, "spark_days": spark_days,
        "users": users, "users_listed": len(users), "segments": seg, "funnel": funnel, "hist_turns": [(k, hist_turns.get(k, 0)) for k in tl], "hist_days": [(k, hist_days.get(k, 0)) for k in dl],
        "dist": dists, "hours": hours, "heat": heat, "outcomes30": {k: outcomes30.get(k, 0) for k in OUTCOMES},
        "tools": sorted(({"name": k, **v} for k, v in tools.items()), key=lambda x: -x["calls"]), "tool_errors": dict(tool_err.most_common()), "signals": dict(signals.most_common()), "llm_errors": dict(llm_err.most_common()),
        "release": release_info(release, dists["version"], kpi["users_30d"]),
        "findings": findings or [], "downloads_total": sum(v.get("pkg", 0) for v in daily.values()), "daily_first": min(daily) if daily else None}


def read_release(dl_dir):
    """latest.json đang phát hành (tệp do deploy/220/make-latest.sh tạo): phiên bản, ngày, phiên bản tối thiểu."""
    try:
        with open(os.path.join(dl_dir, "latest.json"), encoding="utf-8") as f:
            j = json.load(f)
        ok = lambda v: isinstance(v, str) and len(v) <= 24 and all(c.isalnum() or c in ".-" for c in v)
        return {"version": j["version"] if ok(j.get("version")) else "", "released": str(j.get("released", ""))[:10], "min": j["minVersion"] if ok(j.get("minVersion")) else "", "notes": str(j.get("notes", ""))[:400]}
    except (OSError, ValueError, AttributeError, KeyError):
        return None


def release_info(rel, versions, users30):
    """Mức người dùng đã lên bản đang phát hành, và số người còn dưới phiên bản tối thiểu."""
    if not rel or not rel.get("version"):
        return None
    cur, mn = _ver_key(rel["version"]), _ver_key(rel["min"]) if rel.get("min") else None
    on_latest = sum(x["users"] for x in versions if _ver_key(x["value"]) >= cur)
    below_min = sum(x["users"] for x in versions if mn and _ver_key(x["value"]) < mn)
    return {**rel, "on_latest": on_latest, "adoption": R.ratio(on_latest, users30) if users30 else None, "below_min": below_min}


def _ver_key(v):
    return tuple(int(c) if c.isdigit() else 0 for c in str(v).replace("-", ".").split(".")[:3])


def insights(S):
    """Vài nhận xét tự động, ngắn, dựa trên số liệu (không phải kết luận)."""
    k, out = S["kpi"], []
    p = k["prev"]
    if k["users_total"] == 0:
        return [("warn", "Chưa có dữ liệu chẩn đoán nào. Kiểm tra bộ thu và việc ứng dụng đã cấu hình điểm nhận chưa.")]
    if k["users_24h"] > p["users_24h"]:
        out.append(("good", "Số người dùng 24 giờ qua tăng: %d so với %d của 24 giờ trước đó." % (k["users_24h"], p["users_24h"])))
    elif k["users_24h"] < p["users_24h"]:
        out.append(("warn", "Số người dùng 24 giờ qua giảm: %d so với %d của 24 giờ trước đó." % (k["users_24h"], p["users_24h"])))
    sg = S["segments"]
    if sg["dormant"]:
        out.append(("warn", "%d người dùng đã ngủ đông (không hoạt động quá 7 ngày) trên tổng %d người." % (sg["dormant"], k["users_total"])))
    one = S["hist_turns"][0][1]
    if one and k["users_total"]:
        out.append(("warn" if one / k["users_total"] >= 0.3 else "info", "%d người (%s) chỉ làm việc đúng 1 lượt: thử rồi bỏ, nên xem lại trải nghiệm ban đầu." % (one, R._p(one / k["users_total"]))))
    e7 = k["error_rate_7d"]
    if e7 is not None:
        out.append(("bad" if e7 >= 0.15 else "warn" if e7 >= 0.05 else "good", "Tỷ lệ lượt kết thúc bằng lỗi 7 ngày: %s%s." % (R._p(e7), "" if k["error_rate_prev7"] is None else " (tuần trước %s)" % R._p(k["error_rate_prev7"]))))
    rl = S.get("release")
    if rl and rl.get("adoption") is not None:
        out.append(("good" if rl["adoption"] >= 0.8 else "warn" if rl["adoption"] < 0.5 else "info", "%s người dùng 30 ngày đã dùng bản mới nhất đang phát hành (%s)%s." % (R._p(rl["adoption"]), rl["version"], "; còn %d người dưới phiên bản tối thiểu %s" % (rl["below_min"], rl["min"]) if rl.get("below_min") else "")))
    vs = S["dist"]["version"]
    if len(vs) > 1 and not rl:
        newest = max(vs, key=lambda x: _ver_key(x["value"]))["value"]
        old = sum(x["users"] for x in vs if x["value"] != newest)
        if old:
            out.append(("info", "%d người dùng (30 ngày) vẫn dùng phiên bản cũ hơn %s." % (old, newest)))
    if sum(S["hours"]):
        h = max(range(24), key=lambda i: S["hours"][i])
        out.append(("info", "Giờ cao điểm: %02d:00–%02d:00 (giờ Việt Nam)." % (h, (h + 1) % 24)))
    fs = [f for f in S["findings"] if f.get("sev") == "cao"]
    if fs:
        out.append(("bad", "Báo cáo chất lượng có %d phát hiện mức cao: %s." % (len(fs), "; ".join(f["title"] for f in fs[:3]))))
    return out


# ---------------------------------------------------------------- hiển thị
CSS = R.CSS + """
:root{--c1:#4a7bd0;--c2:#2f9e6f;--c3:#d69e2e;--c4:#d8554a;--c5:#8b6fd0;--c6:#2b9aa8;--ok:#2f855a;--bad:#c0362c}
@media (prefers-color-scheme:dark){:root{--c1:#6b9bf2;--c2:#48c78e;--c3:#e3b341;--c4:#ff7b72;--c5:#a78bfa;--c6:#4fc3d0;--ok:#48c78e;--bad:#ff7b72}}
html{scroll-behavior:smooth}main{max-width:1100px}a{color:var(--lo)}
nav.top{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);margin:0 -16px 14px;padding:8px 16px;display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}
nav.top b{margin-right:6px}nav.top a{text-decoration:none;font-size:14px}nav.top a:hover{text-decoration:underline}
h2{scroll-margin-top:52px;border-bottom:1px solid var(--line);padding-bottom:4px;margin-top:34px}h2 small{font-weight:400;color:var(--mut);font-size:13px;margin-left:8px}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;background:var(--card);border:1px solid var(--line)}.pill.good{color:var(--ok)}.pill.bad{color:var(--bad)}.pill.warn{color:var(--c3)}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:12px 0}
.hero .k{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;position:relative}
.hero .k span{color:var(--mut);font-size:12.5px;display:block}.hero .k b{font-size:28px;line-height:1.15;display:block}.hero .k i{font-style:normal;font-size:12px;color:var(--mut)}
.hero .k svg{position:absolute;right:10px;bottom:10px;width:84px;height:26px}
.up{color:var(--ok)}.dn{color:var(--bad)}.up.inv{color:var(--bad)}.dn.inv{color:var(--ok)}
.mini{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}.mini div{border:1px solid var(--line);border-radius:8px;padding:6px 10px}.mini b{display:block;font-size:17px}.mini span{font-size:12px;color:var(--mut)}
.ins{list-style:none;margin:8px 0;padding:0}.ins li{padding:5px 10px;margin:4px 0;border-left:4px solid var(--lo);background:var(--card);border-radius:0 6px 6px 0}
.ins li.good{border-left-color:var(--ok)}.ins li.warn{border-left-color:var(--c3)}.ins li.bad{border-left-color:var(--bad)}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
@media (max-width:520px){.grid{grid-template-columns:1fr}}
.card{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.card h3{margin:0 0 6px;font-size:14px}.card .sub{color:var(--mut);font-size:12px;margin:-2px 0 4px}
.ch{width:100%;height:auto;display:block}.ch rect.s1,.ch rect.hm{fill:var(--c1)}.ch rect.s2{fill:var(--c2)}.ch rect.s3{fill:var(--c3)}.ch rect.s4{fill:var(--c4)}.ch rect.s5{fill:var(--c5)}.ch rect.s6{fill:var(--c6)}
.ch path.ln{fill:none;stroke-width:1.6;stroke-linejoin:round}.ch path.s1{stroke:var(--c1)}.ch path.s2{stroke:var(--c2)}.ch path.s3{stroke:var(--c3)}.ch path.s4{stroke:var(--c4)}
.ch circle.s1{fill:var(--c1)}.ch circle.s2{fill:var(--c2)}.ch circle.s3{fill:var(--c3)}.ch circle.s4{fill:var(--c4)}.ch line{stroke:var(--line)}.ch text{fill:var(--mut);font-size:9px}
.lg{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;color:var(--mut);margin:4px 0 0}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.s1b{background:var(--c1)}.s2b{background:var(--c2)}.s3b{background:var(--c3)}.s4b{background:var(--c4)}.s5b{background:var(--c5)}.s6b{background:var(--c6)}
.hb{display:grid;grid-template-columns:minmax(70px,32%) 1fr auto;gap:4px 8px;align-items:center;font-size:13.5px;margin-bottom:6px}.hb .t{height:10px;background:var(--line);border-radius:5px;overflow:hidden}.hb .t i{display:block;height:100%;background:var(--c1);border-radius:5px}
.hb .n{color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}.hb .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hb.bad .t i{background:var(--c4)}.hb.g .t i{background:var(--c2)}
.seg{display:flex;height:16px;border-radius:8px;overflow:hidden;margin:6px 0;background:var(--line)}.seg i{display:block;height:100%}
.fn{display:grid;grid-template-columns:minmax(120px,38%) 1fr auto;gap:5px 8px;align-items:center;font-size:13.5px}.fn .t{height:20px;background:var(--line);border-radius:4px;overflow:hidden}.fn .t i{display:block;height:100%;background:var(--c1);opacity:.85}.fn .n{color:var(--mut);white-space:nowrap}
.badge{display:inline-block;padding:0 8px;border-radius:99px;font-size:12px;border:1px solid var(--line)}.badge.bn{color:var(--c1)}.badge.ba{color:var(--ok)}.badge.bd{color:var(--mut)}
table.u td svg{width:70px;height:18px;display:block}table.u{font-size:13px}table.u td,table.u th{white-space:nowrap}.num{text-align:right;font-variant-numeric:tabular-nums}
small,.note{color:var(--mut);font-size:12.5px}code{font-size:13px}.ok{color:var(--ok)}.bad{color:var(--bad)}"""


def _e(x):
    return html.escape(str(x))


def spark(vals, cls="s1"):
    n, mx = len(vals), max(vals) if vals else 0
    if n < 2 or mx == 0:
        return '<svg viewBox="0 0 84 26" aria-hidden="true"><line x1="0" y1="24" x2="84" y2="24" stroke="var(--line)"/></svg>'
    pts = [(i * 84 / (n - 1), 24 - 22 * v / mx) for i, v in enumerate(vals)]
    return '<svg viewBox="0 0 84 26" class="ch" aria-hidden="true"><path class="ln %s" d="M%s"/><circle class="%s" cx="%.1f" cy="%.1f" r="2"/></svg>' % (cls, " L".join("%.1f,%.1f" % p for p in pts), cls, pts[-1][0], pts[-1][1])


def strip(vals):
    n, mx = len(vals), max(vals) if vals else 0
    if not mx:
        return '<svg viewBox="0 0 70 18" aria-hidden="true"></svg>'
    bw = 70 / n
    return '<svg viewBox="0 0 70 18" class="ch" aria-hidden="true">' + "".join('<rect class="s1" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1"><title>%d lượt</title></rect>' % (i * bw + .5, 17 - 16 * v / mx, bw - 1, 16 * v / mx + .5, v) for i, v in enumerate(vals) if v) + "</svg>"


def _frame(w, h, mx, labels, trim, unit=""):
    return '<text x="0" y="%d">%s</text><text x="%d" y="%d" text-anchor="end">%s</text><text x="%d" y="9" text-anchor="end">max %.3g%s</text>' % (h + 12, _e(labels[0][trim:]), w, h + 12, _e(labels[-1][trim:]), w, mx, unit)


def stack(series, labels, h=70, trim=5, unit=""):
    """Cột chồng: series = [(tên, giá trị[], lớp màu)]."""
    n, w = len(labels), 300
    tot = [sum(s[1][i] or 0 for s in series) for i in range(n)]
    mx = max(tot) or 1
    bw = w / n
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Biểu đồ cột %d cột, lớn nhất %g">' % (w, h + 16, n, mx)]
    for i in range(n):
        y = h
        for name, vals, cls in series:
            v = vals[i] or 0
            if v:
                bh = (h - 10) * v / mx
                y -= bh
                o.append('<rect class="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f"><title>%s · %s: %g</title></rect>' % (cls, i * bw + 1, y, max(bw - 2, 1), max(bh, .6), _e(labels[i]), _e(name), v))
    o.append(_frame(w, h, mx, labels, trim, unit) + "</svg>")
    return "".join(o)


def bars(vals, labels, errs=None, h=70, trim=5):
    if errs:
        return stack([("Không lỗi", [max(v - x, 0) for v, x in zip(vals, errs)], "s1"), ("Lỗi", errs, "s4")], labels, h, trim)
    return stack([("Giá trị", vals, "s1")], labels, h, trim)


def lines(series, labels, h=70, trim=5, unit=""):
    """Đường: series = [(tên, giá trị[] (None = trống), lớp màu)]. Nối các điểm có dữ liệu."""
    n, w = len(labels), 300
    mx = max([v for _, vs, _ in series for v in vs if v is not None] or [1]) or 1
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Biểu đồ đường %d ngày, lớn nhất %g%s"><line x1="0" y1="%d" x2="%d" y2="%d"/>' % (w, h + 16, n, mx, unit, h, w, h)]
    for name, vals, cls in series:
        pts = [(i * w / max(n - 1, 1), h - (h - 12) * v / mx - 1, v, labels[i]) for i, v in enumerate(vals) if v is not None]
        if len(pts) > 1:
            o.append('<path class="ln %s" d="M%s"/>' % (cls, " L".join("%.1f,%.1f" % p[:2] for p in pts)))
        for x, y, v, lab in pts:
            o.append('<circle class="%s" cx="%.1f" cy="%.1f" r="%s"><title>%s · %s: %.3g%s</title></circle>' % (cls, x, y, "2.2" if len(pts) < 20 else "1.4", _e(lab), _e(name), v, unit))
    o.append(_frame(w, h, mx, labels, trim, unit) + "</svg>")
    return "".join(o)


def legend(items):
    return '<div class="lg">' + "".join('<span><i class="%sb"></i>%s</span>' % (cls, _e(name)) for name, cls in items) + "</div>"


def heatmap(heat):
    mx = max(max(r) for r in heat) or 1
    cw, ch, left, top = 11, 11, 18, 10
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Bản đồ nhiệt lượt làm việc theo thứ và giờ">' % (left + 24 * cw, top + 7 * ch + 2)]
    for h in range(0, 24, 3):
        o.append('<text x="%d" y="8">%02d</text>' % (left + h * cw, h))
    for d in range(7):
        o.append('<text x="0" y="%d">%s</text>' % (top + d * ch + 9, WD[d]))
        for h in range(24):
            v = heat[d][h]
            o.append('<rect class="hm" x="%d" y="%d" width="%d" height="%d" rx="2" fill-opacity="%.2f"><title>%s %02d:00 · %d lượt</title></rect>' % (left + h * cw + 1, top + d * ch + 1, cw - 2, ch - 2, .08 if not v else .2 + .8 * v / mx, WD[d], h, v))
    return "".join(o) + "</svg>"


def hbars(rows, cls=""):
    """rows = [(nhãn, giá trị, chú thích)]; độ dài thanh theo giá trị lớn nhất."""
    if not rows:
        return '<p class="note">Chưa có dữ liệu.</p>'
    mx = max(r[1] for r in rows) or 1
    return '<div class="hb %s">' % cls + "".join('<div class="l" title="%s">%s</div><div class="t"><i style="width:%.1f%%"></i></div><div class="n">%s</div>' % (_e(l), _e(l), 100 * v / mx, _e(note)) for l, v, note in rows) + "</div>"


def delta(cur, prev, inv=False, pct=False):
    if cur is None or prev is None:
        return ""
    if cur == prev:
        return "<i>bằng kỳ trước</i>"
    up = cur > prev
    txt = "mới" if prev == 0 else ("%+.1f điểm %%" % (100 * (cur - prev)) if pct else "%+.0f%%" % (100 * (cur - prev) / prev))
    return '<i><span class="%s%s">%s %s</span> so với kỳ trước</i>' % ("up" if up else "dn", " inv" if inv else "", "▲" if up else "▼", txt)


def hero(label, value, dl, sp):
    return '<div class="k"><span>%s</span><b>%s</b>%s%s</div>' % (_e(label), _e(value), sp, dl)


def table(cols, rows, cls="", raw=()):
    th = "".join("<th>%s</th>" % _e(c) for c in cols)
    body = "".join("<tr>%s</tr>" % "".join("<td%s>%s</td>" % (' class="num"' if isinstance(c, (int, float)) else "", c if i in raw else _e(c)) for i, c in enumerate(r)) for r in rows)
    return '<div class="wrap"><table class="%s"><tr>%s</tr>%s</table></div>' % (cls, th, body)


def read_health(path, t):
    try:
        with open(path, encoding="utf-8") as f:
            h = json.load(f)
        age = t - os.path.getmtime(path)
        return bool(h.get("ok")) and age < 900, [str(x) for x in h.get("failed", [])][:10], age
    except (OSError, ValueError, AttributeError):
        return None, [], None


def render(S, health, report_links, nginx_note):
    k, ser = S["kpi"], S["series"]
    lab = [x["day"] for x in ser]

    def col(f):
        return [x[f] for x in ser]

    def sp(f, cls="s1"):
        return spark(col(f)[-SPARK_DAYS:], cls)

    ok, failed, age = health
    if ok is None:
        hs = '<span class="bad">chưa có dữ liệu kiểm tra sức khoẻ</span>'
    elif ok:
        hs = '<span class="ok">hoạt động tốt</span> (kiểm tra %d phút trước)' % max(age // 60, 0)
    else:
        hs = '<span class="bad">có sự cố: %s</span>' % _e(", ".join(failed) or "kiểm tra đã cũ")
    ret, e7, p = k["returning_7d"], k["error_rate_7d"], k["prev"]
    dur_all = [x["dur_p95"] for x in ser[-7:] if x["dur_p95"] is not None]
    o = ['<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quản trị NEU Agent</title><style>%s</style></head><body><main>' % CSS]
    o.append('<h1>Quản trị NEU Agent</h1><p class="sub">Cập nhật %s (giờ Việt Nam), tự làm mới mỗi 10 phút. Người dùng chỉ hiện dưới <b>mã giả danh</b>; không có email hay nội dung hội thoại.</p>' % _e(S["generated"]))
    o.append('<nav class="top"><b>NEU Agent</b><a href="#tong-quan">Tổng quan</a><a href="#tang-truong">Tăng trưởng &amp; giữ chân</a><a href="#chat-luong">Chất lượng</a><a href="#su-dung">Cách sử dụng</a><a href="#nguoi-dung">Người dùng</a>'
             '<span style="flex:1"></span><span>Hệ thống: %s</span><a href="latest.html">Báo cáo chất lượng</a><a href="stats.json">JSON</a></nav>' % hs)

    # ---- tổng quan
    o.append('<h2 id="tong-quan">Tổng quan</h2>')
    ins = insights(S)
    if ins:
        o.append('<ul class="ins">' + "".join('<li class="%s">%s</li>' % (c, _e(m)) for c, m in ins) + "</ul>")
    o.append('<div class="hero">' + hero("Người dùng 24 giờ", k["users_24h"], delta(k["users_24h"], p["users_24h"]), sp("users"))
             + hero("Người dùng 7 ngày", k["users_7d"], delta(k["users_7d"], p["users_7d"]), "")
             + hero("Người dùng 30 ngày", k["users_30d"], delta(k["users_30d"], p["users_30d"]), "")
             + hero("Người dùng mới 7 ngày", k["new_users_7d"], "<i>tổng %d trong %d ngày giữ dữ liệu</i>" % (k["users_total"], HIST_DAYS), sp("new", "s2"))
             + hero("Lượt làm việc 24 giờ", k["turns_24h"], delta(k["turns_24h"], p["turns_24h"]), sp("turns"))
             + hero("Lượt làm việc 7 ngày", k["turns_7d"], delta(k["turns_7d"], p["turns_7d"]), "")
             + hero("Tỷ lệ lỗi 7 ngày", "—" if e7 is None else R._p(e7), delta(e7, k["error_rate_prev7"], inv=True, pct=True), sp("errors", "s4"))
             + hero("p95 thời gian một lượt", "—" if not dur_all else "%.0f giây" % max(dur_all), "<i>cao nhất trong 7 ngày gần nhất</i>", spark([x["dur_p95"] or 0 for x in ser[-SPARK_DAYS:]], "s3")) + "</div>")
    o.append('<div class="mini">' + "".join("<div><b>%s</b><span>%s</span></div>" % (_e(a), _e(b)) for a, b in [
        (k["installs_30d"], "máy hoạt động 30 ngày"), ("—" if ret is None else R._p(ret), "quay lại (tuần này/tuần trước)"), (sum(x["tool_calls"] for x in ser), "lần gọi công cụ (30 ngày)"),
        (sum(x["chat"] for x in ser), "lệnh gọi mô hình (nginx, 30 ngày)"), (sum(x["pkg"] for x in ser), "lượt tải bản cài (30 ngày)"), (k["turns_30d"], "lượt làm việc 30 ngày")]) + "</div>")
    if S["findings"]:
        sev = collections.Counter(f["sev"] for f in S["findings"])
        o.append('<p>Báo cáo chất lượng hôm nay: %s. <a href="latest.html">Xem chi tiết và đề xuất</a>.</p>' % ", ".join('<span class="pill %s">%d mức %s</span>' % ({"cao": "bad", "trung bình": "warn"}.get(s, ""), c, _e(s)) for s, c in sorted(sev.items(), key=lambda kv: R.SEV_ORDER.get(kv[0], 9))))

    # ---- tăng trưởng
    o.append('<h2 id="tang-truong">Tăng trưởng &amp; giữ chân <small>30 ngày gần nhất</small></h2><div class="grid">')
    o.append('<div class="card"><h3>Người dùng hoạt động mỗi ngày</h3>%s</div>' % bars(col("users"), lab))
    o.append('<div class="card"><h3>Người dùng mới mỗi ngày</h3><p class="sub">lần đầu xuất hiện trong dữ liệu</p>%s</div>' % stack([("Mới", col("new"), "s2")], lab))
    sg = S["segments"]
    tot = sum(sg.values()) or 1
    o.append('<div class="card"><h3>Tình trạng người dùng</h3><div class="seg">%s</div>%s<p class="note">Mới: lần đầu trong 7 ngày · Hoạt động: có dùng trong 7 ngày · Ngủ đông: quá 7 ngày không dùng.</p></div>'
             % ("".join('<i class="%sb" style="width:%.1f%%" title="%s: %d"></i>' % (c, 100 * sg[key] / tot, nm, sg[key]) for key, nm, c in (("new", "Mới", "s1"), ("active", "Hoạt động", "s2"), ("dormant", "Ngủ đông", "s3"))),
                legend([("Mới %d" % sg["new"], "s1"), ("Hoạt động %d" % sg["active"], "s2"), ("Ngủ đông %d" % sg["dormant"], "s3")])))
    fn = S["funnel"]
    top = fn[0][1] or 1
    o.append('<div class="card"><h3>Phễu sử dụng</h3><p class="sub">từ khi cài đến khi dùng đều đặn</p><div class="fn">%s</div></div>'
             % "".join('<div>%s</div><div class="t"><i style="width:%.1f%%"></i></div><div class="n">%d · %s</div>' % (_e(nm), 100 * v / top, v, R._p(v / top)) for nm, v in fn))
    o.append('<div class="card"><h3>Mức độ gắn bó: số ngày dùng</h3><p class="sub">số người theo số ngày khác nhau đã dùng</p>%s</div>' % hbars([(nm, v, "%d người" % v) for nm, v in S["hist_days"]]))
    o.append('<div class="card"><h3>Cường độ dùng: số lượt mỗi người</h3><p class="sub">số người theo tổng số lượt làm việc</p>%s</div>' % hbars([(nm, v, "%d người" % v) for nm, v in S["hist_turns"]], "g"))
    o.append("</div>")

    # ---- chất lượng
    o.append('<h2 id="chat-luong">Chất lượng &amp; hiệu năng <small>30 ngày gần nhất</small></h2><div class="grid">')
    oc = [(OUTCOME_VI[nm], [x["outcomes"][nm] for x in ser], c) for nm, c in zip(OUTCOMES, ("s2", "s3", "s4", "s5", "s6"))]
    o.append('<div class="card"><h3>Kết quả các lượt mỗi ngày</h3>%s%s</div>' % (stack(oc, lab), legend([(nm, c) for nm, _, c in oc])))
    o.append('<div class="card"><h3>Tỷ lệ lượt lỗi mỗi ngày</h3>%s</div>' % lines([("Tỷ lệ lỗi", [None if v is None else 100 * v for v in col("error_rate")], "s4")], lab, unit="%"))
    o.append('<div class="card"><h3>Thời gian một lượt</h3>%s%s</div>' % (lines([("p50", col("dur_p50"), "s1"), ("p95", col("dur_p95"), "s3")], lab, unit=" s"), legend([("p50 (trung vị)", "s1"), ("p95", "s3")])))
    o.append('<div class="card"><h3>Thời gian tới token đầu tiên</h3>%s%s</div>' % (lines([("p50", col("ttft_p50"), "s1"), ("p95", col("ttft_p95"), "s3")], lab, unit=" ms"), legend([("p50", "s1"), ("p95", "s3")])))
    o.append('<div class="card"><h3>Token mỗi ngày</h3>%s%s</div>' % (stack([("Prompt", col("ptok"), "s6"), ("Trả lời", col("ctok"), "s5")], lab), legend([("Prompt (gửi lên)", "s6"), ("Trả lời (sinh ra)", "s5")])))
    o.append('<div class="card"><h3>Lệnh gọi mô hình qua nginx</h3><p class="sub">đỏ: lỗi 5xx của cổng mô hình</p>%s</div>' % bars(col("chat"), lab, col("chat_5xx")))
    o.append('<div class="card"><h3>Công cụ: số lần gọi và tỷ lệ lỗi</h3>%s</div>' % hbars([(x["name"], x["calls"], "%d · lỗi %s%s" % (x["calls"], R._p(R.ratio(x["fails"], x["calls"])), " (+%d chương trình lỗi)" % x["prog"] if x.get("prog") else "")) for x in S["tools"][:12]]))
    if S.get("tool_errors"):
        o.append('<div class="card"><h3>Vì sao công cụ thất bại</h3><p class="sub">lý do (mã), 30 ngày; "chương trình/test lỗi" là kết quả bình thường</p>%s</div>' % hbars([(ERR_VI.get(nm, nm), v, str(v)) for nm, v in S["tool_errors"].items()], "bad"))
    o.append('<div class="card"><h3>Tín hiệu vấn đề và lỗi gọi mô hình</h3>%s%s</div>' % (hbars([(nm, v, str(v)) for nm, v in list(S["signals"].items())[:10]], "bad"), hbars([("lỗi " + nm, v, str(v)) for nm, v in S["llm_errors"].items()], "bad") if S["llm_errors"] else ""))
    o.append("</div>")
    if S["findings"]:
        o.append("<h3>Phát hiện từ báo cáo chất lượng hôm nay</h3>" + table(["Mức", "Vấn đề", "Bằng chứng"], [[f["sev"], f["title"], f["evidence"]] for f in S["findings"][:8]]))

    # ---- cách sử dụng
    o.append('<h2 id="su-dung">Cách sử dụng <small>30 ngày gần nhất</small></h2><div class="grid">')
    names = {"profile": "Tab (Work/Code/Design)", "platform": "Nền tảng", "version": "Phiên bản", "model": "Mô hình"}
    for key in ("profile", "platform", "version", "model"):
        o.append('<div class="card"><h3>%s</h3><p class="sub">số người dùng · lượt</p>%s</div>' % (names[key], hbars([(x["value"], x["users"], "%d người · %d lượt" % (x["users"], x["turns"])) for x in S["dist"][key]])))
    rl = S.get("release")
    if rl:
        o.append('<div class="card"><h3>Phát hành &amp; cập nhật</h3><p class="sub">tệp latest.json đang phục vụ</p><div class="mini"><div><b>%s</b><span>bản đang phát hành%s</span></div><div><b>%s</b><span>đã dùng bản này</span></div><div><b>%s</b><span>phiên bản tối thiểu%s</span></div></div>%s</div>'
                 % (_e(rl["version"]), " · " + _e(rl["released"]) if rl.get("released") else "", "—" if rl["adoption"] is None else R._p(rl["adoption"]), _e(rl["min"] or "chưa đặt"), " · %d người dưới mức" % rl["below_min"] if rl.get("below_min") else "",
                    '<p class="note" style="white-space:pre-wrap">%s</p>' % _e(rl["notes"]) if rl.get("notes") else ""))
    o.append('<div class="card"><h3>Bản đồ nhiệt: lượt theo thứ và giờ</h3><p class="sub">giờ Việt Nam; càng đậm càng nhiều lượt</p>%s</div>' % heatmap(S["heat"]))
    o.append('<div class="card"><h3>Lượt làm việc theo giờ trong ngày</h3>%s</div>' % stack([("Lượt", S["hours"], "s1")], ["%02d:00" % h for h in range(24)], trim=0))
    o.append('<div class="card"><h3>Tải bản cài mỗi ngày</h3>%s</div>' % stack([("Lượt tải", col("pkg"), "s2")], lab))
    o.append('<div class="card"><h3>Desktop kiểm tra cập nhật mỗi ngày</h3><p class="sub">xấp xỉ số lần máy Desktop mở và kiểm tra</p>%s</div>' % stack([("Kiểm tra", col("update_check"), "s6")], lab))
    o.append('</div><p class="note">%s</p>' % _e(nginx_note))

    # ---- người dùng
    o.append('<h2 id="nguoi-dung">Người dùng <small>%d người đứng đầu theo số lượt 30 ngày</small></h2>' % S["users_listed"])
    rows = [['<span class="badge %s">%s</span>' % (STATUS_CLS[u["status"]], u["status"]), "<code>%s</code>" % _e(u["id"]), strip(u["spark"]), u["first"], u["last"], u["days"], u["turns30"], u["turns"],
             "—" if u["error_rate"] is None else R._p(u["error_rate"]), u["profile"], u["platform"], u["version"], u["model"]] for u in S["users"]]
    o.append(table(["Trạng thái", "Mã", "%d ngày qua" % SPARK_DAYS, "Lần đầu", "Gần nhất (VN)", "Ngày dùng", "Lượt 30 ngày", "Tổng lượt", "Lỗi", "Tab chính", "Nền tảng", "Phiên bản", "Mô hình"], rows, "u", raw=(0, 1, 2)))
    o.append('<p class="note">Mã = 8 ký tự đầu của HMAC(bí mật máy chủ, email). Muốn biết mã ứng với ai: tính HMAC cho email cần tra bằng <code>diag-secret</code> trên máy 220 (xem docs/DIAGNOSTICS.md); trang này không lưu và không hiển thị email.</p>')
    if report_links:
        o.append("<h2>Báo cáo chất lượng các ngày trước</h2><p>" + " · ".join('<a href="%s">%s</a>' % (_e(x), _e(x[:-5])) for x in report_links) + "</p>")
    o.append("</main></body></html>")
    return "".join(o)


def write_atomic(path, text):
    tmp = os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(tmp, 0o640)
    os.replace(tmp, path)


def read_findings(out):
    try:
        with open(os.path.join(out, "latest.json"), encoding="utf-8") as f:
            fs = json.load(f).get("findings", [])
        return [{"sev": str(x.get("sev", "")), "title": str(x.get("title", ""))[:160], "evidence": str(x.get("evidence", ""))[:240]} for x in fs if isinstance(x, dict)]
    except (OSError, ValueError, AttributeError):
        return []


def run(diag_dir, nginx_log, out, health_file, now, dl_dir=None):
    t = now.timestamp()
    os.makedirs(out, exist_ok=True)
    recs = R.load_diag(diag_dir, t - HIST_DAYS * 86400, t + 1)
    rows = R.load_nginx(nginx_log, t - 15 * 86400, t + 1) if nginx_log else []
    dpath = os.path.join(out, "nginx-daily.json")
    daily = merge_daily(dpath, nginx_daily(rows), vn_day(t))
    S = compute(recs, daily, now, read_findings(out), read_release(dl_dir) if dl_dir else None)
    first = S["daily_first"]
    note = "Số liệu nginx (lệnh gọi mô hình, tải bản cài, kiểm tra cập nhật) được cộng dồn theo ngày từ %s; nhật ký gốc chỉ giữ 14 ngày. Ngày trước mốc đó hiện bằng 0. Lượt tải đếm yêu cầu HTTP 200 tới tệp .dmg/.exe (tải lại hoặc tiếp tục tải có thể tính thêm)." % (first or "lần chạy đầu")
    links = sorted((os.path.basename(p) for p in glob.glob(os.path.join(out, "????-??-??.html"))), reverse=True)[:30]
    write_atomic(dpath, json.dumps(daily, ensure_ascii=False, indent=1))
    write_atomic(os.path.join(out, "stats.json"), json.dumps(S, ensure_ascii=False, indent=1, default=str))
    write_atomic(os.path.join(out, "index.html"), render(S, read_health(health_file, t), links, note))
    return S


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--diag-dir", default=os.environ.get("NEU_DIAG_DIR", "/var/lib/neu-agent/diag"))
    ap.add_argument("--nginx-log", default=os.environ.get("NEU_DIAG_NGINX_LOG", "/var/log/nginx/neu-agent-access.json.log"))
    ap.add_argument("--out", default=os.environ.get("NEU_DIAG_REPORTS", "/var/lib/neu-agent/reports"))
    ap.add_argument("--health", default=os.environ.get("NEU_DIAG_HEALTH", "/var/lib/neu-agent/health.json"))
    ap.add_argument("--dl-dir", default=os.environ.get("NEU_DL_DIR", "/var/www/neu-agent-dl"), help="thư mục tải về chứa latest.json")
    ap.add_argument("--now", help="ISO hoặc epoch; mặc định: bây giờ")
    a = ap.parse_args(argv)
    S = run(a.diag_dir, a.nginx_log, a.out, a.health, R.parse_now(a.now), a.dl_dir)
    print("Đã ghi %s/index.html (%d người dùng 30 ngày, %d lượt 24 giờ)" % (a.out, S["kpi"]["users_30d"], S["kpi"]["turns_24h"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
