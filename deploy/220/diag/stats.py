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
import sqlite3
import sys

import report as R

TZ = R.TZ
DAYS = 30            # số ngày trong biểu đồ
HIST_DAYS = 90       # khớp thời hạn giữ dữ liệu của bộ thu
TOP_USERS = 300
DAILY_KEEP = 400
SPARK_DAYS = 14
OUTCOMES = ("ok", "interrupted", "error", "step_limit", "loop")
OUTCOME_VI = {"ok": "Thành công", "interrupted": "Bị ngắt", "error": "Lỗi", "step_limit": "Chạm giới hạn bước", "loop": "Lặp"}
STATUS_CLS = {"mới": "bn", "hoạt động": "ba", "ngủ đông": "bd"}
ERR_VI = {"not_found": "Không có file/thư mục", "outside_project": "Đường dẫn ngoài dự án", "read_first": "Sửa trước khi đọc", "stale": "File đã đổi sau khi đọc", "binary": "File nhị phân", "bad_args": "Thiếu/sai tham số",
          "no_match": "Không tìm thấy đoạn cần sửa", "ambiguous": "Đoạn cần sửa không duy nhất", "wrong_type": "Nhầm file/thư mục", "sandbox": "Dùng thứ sandbox không có", "program": "Chương trình/test của người dùng lỗi (bình thường)",
          "timeout": "Quá thời gian", "unsupported": "Không hỗ trợ", "denied": "Bị từ chối quyền", "hook": "Bị hook chặn", "unknown_tool": "Công cụ không tồn tại", "bad_json": "Tham số không phải JSON", "internal": "Lỗi nội bộ", "other": "Khác", "unknown": "Chưa rõ (bản cũ)"}
UI_VI = {"tab_switch": "Chuyển tab", "suggestion": "Bấm gợi ý trên màn hình chào", "template": "Dùng 'Mẫu prompt'", "attach": "Đính kèm tệp", "learn_open": "Mở bài học", "settings_open": "Mở Cài đặt", "new_chat": "Cuộc trò chuyện mới",
         "open_chat": "Mở lại cuộc trò chuyện cũ", "mode_change": "Đổi chế độ chạy", "model_change": "Mở danh sách mô hình", "run_click": "Bấm Chạy", "changes_open": "Xem thay đổi", "login_prompt": "Bấm Đăng nhập lại", "update_banner": "Thấy thông báo cập nhật",
         "update_download": "Tải bản cập nhật", "download_open": "Mở hộp Tải ứng dụng", "slash_command": "Dùng lệnh /", "mention_file": "Nhắc tệp bằng @", "stop_click": "Bấm Dừng"}
FB_VI = {"wrong": "Sai/không đúng ý", "incomplete": "Chưa làm xong", "slow": "Chậm", "confusing": "Khó hiểu", "other": "Khác", "none": "Không chọn lý do"}
NOT_TOOL_FAULT = ("program", "denied")  # kết quả bình thường/ý người dùng, không tính là công cụ lỗi


def vn_day(ts):
    return datetime.datetime.fromtimestamp(ts, TZ).date().isoformat()


# ---------------------------------------------------------------- nginx theo ngày (cộng dồn)
def nginx_daily(rows):
    d = collections.defaultdict(lambda: {"req": 0, "chat": 0, "chat_ok": 0, "chat_5xx": 0, "pkg": 0, "update_check": 0, "diag": 0})
    rts, chat_st, diag_st = collections.defaultdict(list), collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    for r in rows:
        day = vn_day(r["_ts"])
        x = d[day]
        x["req"] += 1
        route, st = r.get("route"), r["status"]
        if route == "vllm_chat":
            chat_st[day][str(st)] += 1
            if st == 200 and isinstance(r.get("rt"), (int, float)):
                rts[day].append(r["rt"])
        elif route == "diag":
            diag_st[day][str(st)] += 1
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
    for day, x in d.items():
        x["chat_p50"], x["chat_p95"] = (R.pct(rts[day], 50), R.pct(rts[day], 95)) if rts.get(day) else (None, None)
        x["chat_st"], x["diag_st"] = dict(chat_st.get(day, {})), dict(diag_st.get(day, {}))
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


def compute(recs, daily, now, findings=None, release=None, quota=None):
    t = now.timestamp()
    today = vn_day(t)
    days = [(datetime.date.fromisoformat(today) - datetime.timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
    t30 = t - DAYS * 86400
    U = {}
    D = collections.defaultdict(lambda: {"users": set(), "installs": set(), "turns": 0, "out": collections.Counter(), "dur": [], "ttft": [], "ptok": 0, "ctok": 0, "tool_calls": 0, "tool_fails": 0, "signals": 0, "llm_errors": 0, "retries": 0, "calls": 0, "peak": [], "cached": 0, "tool_out": 0, "pruned": 0, "first_tool": [], "turns_v2": 0})
    ui_acts, fb, ui_day = collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter)
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
            if "calls" in e:   # bản ứng dụng mới (có số đo token chi tiết)
                pd["turns_v2"] += 1
                pd["calls"] += e.get("calls", 0)
                pd["cached"] += e.get("cached_tok", 0)
                pd["tool_out"] += e.get("tool_out_tok", 0)
                pd["pruned"] += e.get("pruned", 0)
                if e.get("peak_prompt_tok"):
                    pd["peak"].append(e["peak_prompt_tok"])
                if "first_tool_s" in e:
                    pd["first_tool"].append(e["first_tool_s"])
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
        elif et == "ui":
            if in30:
                ui_acts[e.get("act", "?")] += 1
            ui_day[day][e.get("act", "?")] += 1
        elif et == "feedback":
            if in30:
                fb[e.get("v", "?")] += 1
                if e.get("v") == "down":
                    fb["why:" + (e.get("reason") or "none")] += 1
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
            "calls_per_turn": R.ratio(pd["calls"], pd["turns_v2"]) if pd and pd["turns_v2"] else None, "peak_prompt_avg": (sum(pd["peak"]) / len(pd["peak"])) if pd and pd["peak"] else None,
            "cached_ratio": R.ratio(pd["cached"], pd["ptok"]) if pd and pd["ptok"] and pd["cached"] else None, "tool_out_per_turn": R.ratio(pd["tool_out"], pd["turns_v2"]) if pd and pd["turns_v2"] else None,
            "pruned": pd["pruned"] if pd else 0, "first_tool_p50": R.pct(pd["first_tool"], 50) if pd and pd["first_tool"] else None, "turns_v2": pd["turns_v2"] if pd else 0,
            "chat": ng.get("chat", 0), "chat_5xx": ng.get("chat_5xx", 0), "chat_p50": ng.get("chat_p50"), "chat_p95": ng.get("chat_p95"), "chat_st": ng.get("chat_st", {}), "diag_st": ng.get("diag_st", {}), "diag": ng.get("diag", 0), "pkg": ng.get("pkg", 0), "update_check": ng.get("update_check", 0)})
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
        "release": release_info(release, dists["version"], kpi["users_30d"]), "quota": quota,
        "ui": dict(ui_acts.most_common()), "feedback": {"up": fb.get("up", 0), "down": fb.get("down", 0), "reasons": {k[4:]: v for k, v in fb.items() if k.startswith("why:")}},
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


def read_quota(db_path, now):
    """Mức dùng token theo người (mã giả danh) do cổng hạn mức đếm (deploy/220/quota). None nếu chưa cài/chưa có dữ liệu."""
    try:
        db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True, timeout=3)
    except sqlite3.Error:
        return None
    try:
        t = now.timestamp()
        today = vn_day(t)
        since = vn_day(t - (DAYS - 1) * 86400)
        rows = db.execute("SELECT uid,tier,lim,tokens,requests,blocked,estimated FROM usage WHERE day=? ORDER BY tokens DESC", (today,)).fetchall()
        users = []
        for uid, tier, lim, tokens, req, blocked, est in rows:
            pct = None if lim < 0 else (100.0 * tokens / lim if lim else 100.0)
            users.append({"id": uid[:8], "tier": tier, "tokens": tokens, "limit": None if lim < 0 else lim, "pct": None if pct is None else round(pct, 1), "requests": req, "blocked": blocked, "estimated": est})
        by_day = {r[0]: r[1:] for r in db.execute("SELECT day,sum(tokens),count(*),sum(blocked),sum(CASE WHEN lim>=0 AND tokens>=lim*0.8 THEN 1 ELSE 0 END) FROM usage WHERE day>=? GROUP BY day", (since,))}
        days = [(datetime.date.fromisoformat(today) - datetime.timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
        series = [{"day": d, "tokens": (by_day.get(d) or (0, 0, 0, 0))[0] or 0, "users": (by_day.get(d) or (0, 0, 0, 0))[1], "blocked": (by_day.get(d) or (0, 0, 0, 0))[2] or 0, "near": (by_day.get(d) or (0, 0, 0, 0))[3] or 0} for d in days]
        tiers = collections.defaultdict(lambda: {"users": 0, "tokens": 0})
        for u in users:
            tiers[u["tier"]]["users"] += 1
            tiers[u["tier"]]["tokens"] += u["tokens"]
        return {
            "today": today, "users": users[:30], "users_today": len(users), "tokens_today": sum(u["tokens"] for u in users),
            "near": sum(1 for u in users if u["pct"] is not None and 80 <= u["pct"] < 100), "over": sum(1 for u in users if u["pct"] is not None and u["pct"] >= 100),
            "blocked_users": sum(1 for u in users if u["blocked"]), "blocked_requests": sum(u["blocked"] for u in users), "series": series, "tiers": dict(tiers),
        }
    except sqlite3.Error:
        return None
    finally:
        db.close()


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
    qt = S.get("quota")
    if qt and qt["users_today"]:
        if qt["blocked_users"]:
            out.append(("bad", "%d người đã bị chặn vì hết hạn mức token hôm nay (%d yêu cầu bị từ chối)." % (qt["blocked_users"], qt["blocked_requests"])))
        if qt["near"] + qt["over"]:
            out.append(("warn", "%d người đã dùng ≥ 80%% hạn mức token hôm nay (%d người đã chạm hạn mức)." % (qt["near"] + qt["over"], qt["over"])))
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


def pages_reports(reps):
    import pages as P  # noqa: PLC0415
    return P.reports_table(reps)


# ---------------------------------------------------------------- hiển thị (biểu đồ/thành phần dùng chung ở charts.py)
from charts import CSS, WD, _e, bars, delta, heatmap, hbars, hero, legend, lines, spark, stack, strip, table  # noqa: E402,F401


def cohort_table(U, t, weeks=8):
    """Giữ chân theo tuần: mỗi hàng là nhóm người dùng lần đầu xuất hiện trong một tuần (thứ Hai đầu tuần, giờ VN); các cột là % còn hoạt động ở tuần +0, +1, …"""
    def wk(ts_or_day):
        d = datetime.date.fromisoformat(ts_or_day) if isinstance(ts_or_day, str) else datetime.datetime.fromtimestamp(ts_or_day, TZ).date()
        return (d - datetime.timedelta(days=d.weekday())).toordinal() // 7
    cur = wk(t)
    coh = collections.defaultdict(list)
    for uid, u in U.items():
        coh[wk(u["first"])].append({wk(d) for d in u["days"]})
    out = []
    for w in range(cur - weeks + 1, cur + 1):
        users = coh.get(w, [])
        if not users:
            continue
        out.append({"week": (datetime.date.fromordinal(w * 7 + 1 + 6) - datetime.timedelta(days=6)).isoformat(), "n": len(users),
                    "ret": [round(100.0 * sum(1 for act in users if (w + k) in act) / len(users), 1) for k in range(0, cur - w + 1)]})
    return out


def system_info(diag_dir, recs, out, t):
    """Độ mới và dung lượng của dữ liệu (để quản trị biết hệ thống thu dữ liệu có đang chạy)."""
    newest = max((r["ts_srv"] for r in recs), default=None)
    files, size, oldest = 0, 0, None
    try:
        for p in glob.glob(os.path.join(diag_dir, "????-??-??.jsonl")):
            files += 1
            size += os.path.getsize(p)
            d = os.path.basename(p)[:10]
            oldest = d if oldest is None or d < oldest else oldest
    except OSError:
        pass
    rsize = 0
    try:
        rsize = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    except OSError:
        pass
    return {"newest_event_age_s": None if newest is None else int(t - newest), "diag_files": files, "diag_bytes": size, "diag_oldest": oldest, "reports_bytes": rsize}


def _mb(n):
    return "%.1f MB" % (n / 1048576.0) if n >= 1048576 else "%d KB" % max(1, n // 1024)


def read_health(path, t):
    try:
        with open(path, encoding="utf-8") as f:
            h = json.load(f)
        age = t - os.path.getmtime(path)
        failed = [k for k, v in (h.get("checks") or {}).items() if isinstance(v, dict) and not v.get("ok")] or [str(x) for x in h.get("failed", [])][:10]
        checks = {str(k): {"ok": bool(v.get("ok")), "ms": v.get("ms"), "detail": str(v.get("detail", ""))[:80]} for k, v in (h.get("checks") or {}).items() if isinstance(v, dict)}
        return bool(h.get("ok")) and age < 900, failed[:10], age, checks
    except (OSError, ValueError, AttributeError):
        return None, [], None, {}


def render(S, health, report_links, nginx_note, info=None, sysinfo=None, cohorts=None):
    k, ser = S["kpi"], S["series"]
    lab = [x["day"] for x in ser]

    def col(f):
        return [x[f] for x in ser]

    def sp(f, cls="s1"):
        return spark(col(f)[-SPARK_DAYS:], cls)

    ok, failed, age, checks = health
    info = info or {"linked": set(), "days": set(), "reports": []}
    dl = ["d-%s.html" % d if d in info["days"] else None for d in lab]
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
    o.append('<nav class="top"><b>NEU Agent</b><a href="#tong-quan">Tổng quan</a><a href="#tang-truong">Tăng trưởng &amp; giữ chân</a><a href="#chat-luong">Chất lượng</a><a href="#su-dung">Cách sử dụng</a><a href="#han-muc">Hạn mức token</a><a href="#nguoi-dung">Người dùng</a><a href="#he-thong">Hệ thống</a>'
             '<span style="flex:1"></span><span>Hệ thống: %s</span><a href="accounts">Tài khoản</a><a href="data.html">Dữ liệu &amp; CSV</a><a href="latest.html">Báo cáo chất lượng</a><a href="stats.json">JSON</a></nav>' % hs)

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
    o.append('<div class="card"><h3>Người dùng hoạt động mỗi ngày</h3>%s</div>' % bars(col("users"), lab, links=dl))
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

    if cohorts:
        wmax = max(len(c["ret"]) for c in cohorts)
        o.append("<h3>Giữ chân theo tuần</h3><p class=\"note\">Mỗi hàng là nhóm người dùng lần đầu xuất hiện trong tuần đó (thứ Hai đầu tuần). Mỗi cột là % số người của nhóm còn dùng ở tuần +0, +1, …</p>")
        o.append(table(["Tuần", "Người"] + ["+%d" % k for k in range(wmax)], [[c["week"], c["n"]] + [("%s%%" % v) for v in c["ret"]] + [""] * (wmax - len(c["ret"])) for c in cohorts]))

    # ---- chất lượng
    o.append('<h2 id="chat-luong">Chất lượng &amp; hiệu năng <small>30 ngày gần nhất</small></h2><div class="grid">')
    oc = [(OUTCOME_VI[nm], [x["outcomes"][nm] for x in ser], c) for nm, c in zip(OUTCOMES, ("s2", "s3", "s4", "s5", "s6"))]
    o.append('<div class="card"><h3>Kết quả các lượt mỗi ngày</h3>%s%s</div>' % (stack(oc, lab, links=dl), legend([(nm, c) for nm, _, c in oc])))
    o.append('<div class="card"><h3>Tỷ lệ lượt lỗi mỗi ngày</h3>%s</div>' % lines([("Tỷ lệ lỗi", [None if v is None else 100 * v for v in col("error_rate")], "s4")], lab, unit="%"))
    o.append('<div class="card"><h3>Thời gian một lượt</h3>%s%s</div>' % (lines([("p50", col("dur_p50"), "s1"), ("p95", col("dur_p95"), "s3")], lab, unit=" s"), legend([("p50 (trung vị)", "s1"), ("p95", "s3")])))
    o.append('<div class="card"><h3>Thời gian tới token đầu tiên</h3>%s%s</div>' % (lines([("p50", col("ttft_p50"), "s1"), ("p95", col("ttft_p95"), "s3")], lab, unit=" ms"), legend([("p50", "s1"), ("p95", "s3")])))
    o.append('<div class="card"><h3>Token mỗi ngày</h3>%s%s</div>' % (stack([("Prompt", col("ptok"), "s6"), ("Trả lời", col("ctok"), "s5")], lab, links=dl), legend([("Prompt (gửi lên)", "s6"), ("Trả lời (sinh ra)", "s5")])))
    if any(x["turns_v2"] for x in ser):
        o.append('<div class="card"><h3>Token đi đâu: lời nhắc trung bình một lần gọi</h3><p class="sub">đỉnh lời nhắc của một lần gọi, trung bình mỗi lượt (từ bản ứng dụng có số đo mới)</p>%s</div>' % lines([("Đỉnh lời nhắc (token)", col("peak_prompt_avg"), "s1")], lab, unit=" tok", links=dl))
        o.append('<div class="card"><h3>Số lần gọi mô hình và kết quả công cụ mỗi lượt</h3>%s%s</div>' % (lines([("Lần gọi/lượt", col("calls_per_turn"), "s3"), ("Token kết quả công cụ/lượt ÷ 1000", [None if v is None else v / 1000 for v in col("tool_out_per_turn")], "s4")], lab, links=dl), legend([("Lần gọi mô hình/lượt", "s3"), ("Kết quả công cụ gửi lại/lượt (nghìn token)", "s4")])))
        if any(x["cached_ratio"] for x in ser):
            o.append('<div class="card"><h3>Token lời nhắc dùng lại từ bộ nhớ đệm</h3><p class="sub">%% số token lời nhắc được máy chủ dùng lại (càng cao càng tiết kiệm)</p>%s</div>' % lines([("Bộ nhớ đệm", [None if v is None else 100 * v for v in col("cached_ratio")], "s2")], lab, unit="%", links=dl))
    o.append('<div class="card"><h3>Lệnh gọi mô hình qua nginx</h3><p class="sub">đỏ: lỗi 5xx của cổng mô hình</p>%s</div>' % bars(col("chat"), lab, col("chat_5xx"), links=dl))
    o.append('<div class="card"><h3>Độ trễ cổng mô hình (nginx)</h3><p class="sub">thời gian cả yêu cầu chat thành công, gồm sinh văn bản</p>%s%s</div>' % (lines([("p50", col("chat_p50"), "s1"), ("p95", col("chat_p95"), "s3")], lab, unit=" s", links=dl), legend([("p50", "s1"), ("p95", "s3")])))
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
    ui = S.get("ui") or {}
    o.append('<div class="card"><h3>Tính năng được dùng <small>số lần bấm, 30 ngày</small></h3><p class="sub">chỉ từ bản ứng dụng có ghi nhận; không có nội dung</p>%s%s</div>' % (
        hbars([(UI_VI.get(k, k), v, str(v)) for k, v in list(ui.items())[:14]]) if ui else '<p class="note">Chưa có dữ liệu (cần người dùng cập nhật bản mới).</p>',
        '<p class="note">Chưa ai dùng: %s</p>' % _e(", ".join(UI_VI[k] for k in UI_VI if k not in ui and k not in ("update_banner", "update_download", "mention_file"))) if ui else ""))
    fbk = S.get("feedback") or {}
    if fbk.get("up") or fbk.get("down"):
        tot = fbk["up"] + fbk["down"]
        o.append('<div class="card"><h3>Phản hồi của người dùng <small>30 ngày</small></h3><div class="mini"><div><b>👍 %d</b><span>có ích</span></div><div><b>👎 %d</b><span>chưa tốt</span></div><div><b>%s</b><span>hài lòng</span></div></div>%s</div>' % (
            fbk["up"], fbk["down"], R._p(fbk["up"] / tot), hbars([(FB_VI.get(k, k), v, str(v)) for k, v in sorted(fbk["reasons"].items(), key=lambda kv: -kv[1])], "bad") if fbk["reasons"] else ""))
    o.append('<div class="card"><h3>Bản đồ nhiệt: lượt theo thứ và giờ</h3><p class="sub">giờ Việt Nam; càng đậm càng nhiều lượt</p>%s</div>' % heatmap(S["heat"]))
    o.append('<div class="card"><h3>Lượt làm việc theo giờ trong ngày</h3>%s</div>' % stack([("Lượt", S["hours"], "s1")], ["%02d:00" % h for h in range(24)], trim=0))
    o.append('<div class="card"><h3>Tải bản cài mỗi ngày</h3>%s</div>' % stack([("Lượt tải", col("pkg"), "s2")], lab))
    o.append('<div class="card"><h3>Desktop kiểm tra cập nhật mỗi ngày</h3><p class="sub">xấp xỉ số lần máy Desktop mở và kiểm tra</p>%s</div>' % stack([("Kiểm tra", col("update_check"), "s6")], lab))
    o.append('</div><p class="note">%s</p>' % _e(nginx_note))

    # ---- hạn mức token
    o.append('<h2 id="han-muc">Hạn mức token <small>mỗi người một hạn mức/ngày, làm mới 00:00 giờ VN</small></h2>')
    qt = S.get("quota")
    if not qt:
        o.append('<p class="note">Chưa có dữ liệu hạn mức: cổng hạn mức (deploy/220/quota) chưa cài hoặc chưa có yêu cầu nào đi qua. Xem docs/QUOTA.md.</p>')
    else:
        qs = qt["series"]
        ql = [x["day"] for x in qs]
        o.append('<div class="mini">' + "".join("<div><b>%s</b><span>%s</span></div>" % (_e(a), _e(b)) for a, b in [
            (qt["users_today"], "người đã dùng hôm nay"), ("%.2f triệu" % (qt["tokens_today"] / 1e6), "token hôm nay (đã tính)"), (qt["near"], "người đã dùng 80–99% hạn mức"), (qt["over"], "người đã chạm hạn mức"),
            (qt["blocked_users"], "người bị chặn hôm nay"), (qt["blocked_requests"], "yêu cầu bị từ chối hôm nay")]) + "</div>")
        o.append('<div class="grid">')
        o.append('<div class="card"><h3>Token mỗi ngày (cổng hạn mức đếm)</h3><p class="sub">triệu token; số do máy chủ đếm, chính xác hơn số ứng dụng tự báo</p>%s</div>' % stack([("Triệu token", [round(x["tokens"] / 1e6, 3) for x in qs], "s6")], ql))
        o.append('<div class="card"><h3>Người dùng gần/hết hạn mức mỗi ngày</h3><p class="sub">đỏ: số yêu cầu bị từ chối</p>%s</div>' % bars([x["near"] for x in qs], ql, [x["blocked"] for x in qs]))
        tiers = qt["tiers"]
        o.append('<div class="card"><h3>Theo bậc (hôm nay)</h3>%s</div>' % table(["Bậc", "Người", "Token"], [[k, v["users"], format(v["tokens"], ",").replace(",", ".")] for k, v in sorted(tiers.items())] or [["—", 0, 0]]))
        o.append("</div>")
        hot = [u for u in qt["users"] if (u["pct"] or 0) >= 50 or u["blocked"]][:15]
        o.append("<h3>Người dùng đang dùng nhiều hạn mức hôm nay <small>(từ 50% trở lên; mã giả danh)</small></h3>")
        o.append(table(["Mã", "Bậc", "Token", "Hạn mức", "Đã dùng", "Yêu cầu", "Bị chặn"], [[u["id"], u["tier"], format(u["tokens"], ",").replace(",", "."), "không giới hạn" if u["limit"] is None else format(u["limit"], ",").replace(",", "."),
                                                                                              "—" if u["pct"] is None else "%s%%" % u["pct"], u["requests"], u["blocked"]] for u in hot] or [["—", "", "", "", "", "", ""]]))
        o.append('<p class="note">Đổi hạn mức trên máy 220: <code>sudo ~/neu-agent-220/quota/quota.sh show | mode | tier | set</code>. Mặc định sinh viên 1 triệu, giảng viên 10 triệu token/ngày; vượt thêm 10%% để hoàn tất việc đang làm. Tra mã ứng với ai: <code>quota.sh uid &lt;email&gt;</code>.</p>')

    # ---- người dùng
    o.append('<h2 id="nguoi-dung">Người dùng <small>%d người đứng đầu theo số lượt 30 ngày · bấm mã để xem chi tiết từng người</small></h2>' % S["users_listed"])
    near = {u["id"] for u in (S.get("quota") or {}).get("users", []) if (u.get("pct") or 0) >= 80}
    cnt = collections.Counter(u["status"] for u in S["users"])
    o.append('<div class="ftab flt"><input type="radio" name="f" id="f-all" checked><label for="f-all">Tất cả (%d)</label><input type="radio" name="f" id="f-bn"><label for="f-bn">Mới (%d)</label>'
             '<input type="radio" name="f" id="f-ba"><label for="f-ba">Hoạt động (%d)</label><input type="radio" name="f" id="f-bd"><label for="f-bd">Ngủ đông (%d)</label>'
             '<input type="radio" name="f" id="f-near"><label for="f-near">Gần/hết hạn mức (%d)</label><input type="radio" name="f" id="f-err"><label for="f-err">Có lượt lỗi</label>' % (len(S["users"]), cnt["mới"], cnt["hoạt động"], cnt["ngủ đông"], len(near)))
    rows, rc = [], []
    for u in S["users"]:
        idc = '<a href="u-%s.html"><code>%s</code></a>' % (_e(u["id"]), _e(u["id"])) if u["id"] in info["linked"] else "<code>%s</code>" % _e(u["id"])
        rows.append(['<span class="badge %s">%s</span>' % (STATUS_CLS[u["status"]], u["status"]), idc, strip(u["spark"]), u["first"], u["last"], u["days"], u["turns30"], u["turns"],
                     "—" if u["error_rate"] is None else R._p(u["error_rate"]), u["profile"], u["platform"], u["version"], u["model"]])
        rc.append("r st-%s%s%s" % (STATUS_CLS[u["status"]], " near" if u["id"] in near else "", " haserr" if (u["error_rate"] or 0) > 0 else ""))
    o.append(table(["Trạng thái", "Mã", "%d ngày qua" % SPARK_DAYS, "Lần đầu", "Gần nhất (VN)", "Ngày dùng", "Lượt 30 ngày", "Tổng lượt", "Lỗi", "Tab chính", "Nền tảng", "Phiên bản", "Mô hình"], rows, "u", raw=(0, 1, 2), row_cls=rc))
    o.append("</div>")
    o.append('<p class="note">Mã = 8 ký tự đầu của HMAC(bí mật máy chủ, email). Tra mã ứng với ai: <code>sudo ~/neu-agent-220/quota/quota.sh uid &lt;email&gt;</code> trên máy 220. Trang này không lưu và không hiển thị email. Xem tất cả người dùng và tải CSV ở <a href="data.html">Dữ liệu &amp; CSV</a>.</p>')

    # ---- báo lỗi do người dùng gửi
    if info["reports"]:
        o.append('<h2 id="bao-loi">Báo lỗi do người dùng gửi <small>ghi chú tự gõ khi bấm "Báo lỗi"</small></h2>')
        o.append(pages_reports(info["reports"][:15]))

    # ---- hệ thống & dữ liệu
    o.append('<h2 id="he-thong">Hệ thống &amp; dữ liệu</h2><div class="grid">')
    if checks:
        o.append('<div class="card"><h3>Kiểm tra sức khoẻ (5 phút/lần)</h3>%s</div>' % table(["Thành phần", "Tình trạng", "ms", "Chi tiết"], [[nm, "✓ tốt" if v["ok"] else "✗ lỗi", v["ms"] if v["ms"] is not None else "—", v["detail"]] for nm, v in checks.items()]))
    if sysinfo:
        fresh = sysinfo["newest_event_age_s"]
        o.append('<div class="card"><h3>Dữ liệu chẩn đoán</h3>%s</div>' % table(["Chỉ số", "Giá trị"], [
            ["Sự kiện mới nhất", "chưa có" if fresh is None else ("%d phút trước" % (fresh // 60) if fresh >= 120 else "%d giây trước" % fresh)], ["Số tệp ngày / từ ngày", "%d / %s" % (sysinfo["diag_files"], sysinfo["diag_oldest"] or "—")],
            ["Dung lượng chẩn đoán", _mb(sysinfo["diag_bytes"])], ["Dung lượng báo cáo và trang quản trị", _mb(sysinfo["reports_bytes"])], ["Thời hạn giữ", "%d ngày (xoá tự động)" % HIST_DAYS]]))
    o.append("</div>")
    nd = [x for x in ser[-7:]]
    st_rows = []
    for x in reversed(nd):
        cs, ds = x.get("chat_st") or {}, x.get("diag_st") or {}
        if not cs and not ds and not x["chat"]:
            continue
        st_rows.append([x["day"], x["chat"], ", ".join("%s: %d" % kv for kv in sorted(cs.items())) or "—", "—" if x["chat_p50"] is None else "%.1f / %.1f s" % (x["chat_p50"], x["chat_p95"]), x.get("diag", 0), ", ".join("%s: %d" % kv for kv in sorted(ds.items())) or "—"])
    if st_rows:
        o.append("<h3>Cổng mô hình và nhận chẩn đoán (nginx, 7 ngày)</h3>" + table(["Ngày", "Lệnh chat", "Mã trạng thái", "p50 / p95", "Gói chẩn đoán", "Mã trạng thái"], st_rows))
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


def run(diag_dir, nginx_log, out, health_file, now, dl_dir=None, quota_db=None):
    import pages as P  # noqa: PLC0415 (pages.py dùng chung biểu đồ với tệp này)
    t = now.timestamp()
    os.makedirs(out, exist_ok=True)
    recs = R.load_diag(diag_dir, t - HIST_DAYS * 86400, t + 1)
    rows = R.load_nginx(nginx_log, t - 15 * 86400, t + 1) if nginx_log else []
    dpath = os.path.join(out, "nginx-daily.json")
    daily = merge_daily(dpath, nginx_daily(rows), vn_day(t))
    S = compute(recs, daily, now, read_findings(out), read_release(dl_dir) if dl_dir else None, read_quota(quota_db, now) if quota_db else None)
    first = S["daily_first"]
    note = "Số liệu nginx (lệnh gọi mô hình, tải bản cài, kiểm tra cập nhật) được cộng dồn theo ngày từ %s; nhật ký gốc chỉ giữ 14 ngày. Ngày trước mốc đó hiện bằng 0. Lượt tải đếm yêu cầu HTTP 200 tới tệp .dmg/.exe (tải lại hoặc tiếp tục tải có thể tính thêm)." % (first or "lần chạy đầu")
    links = sorted((os.path.basename(p) for p in glob.glob(os.path.join(out, "????-??-??.html"))), reverse=True)[:30]
    write_atomic(dpath, json.dumps(daily, ensure_ascii=False, indent=1))
    info = P.write_all(out, S, recs, quota_db, t, write_atomic)          # trang từng người, từng ngày, dữ liệu đầy đủ, CSV
    coh, sysinfo = cohort_table(info["U"], t), system_info(diag_dir, recs, out, t)
    S["cohorts"], S["system"] = coh, sysinfo
    write_atomic(os.path.join(out, "stats.json"), json.dumps(S, ensure_ascii=False, indent=1, default=str))
    write_atomic(os.path.join(out, "index.html"), render(S, read_health(health_file, t), links, note, info, sysinfo, coh))
    return S


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--diag-dir", default=os.environ.get("NEU_DIAG_DIR", "/var/lib/neu-agent/diag"))
    ap.add_argument("--nginx-log", default=os.environ.get("NEU_DIAG_NGINX_LOG", "/var/log/nginx/neu-agent-access.json.log"))
    ap.add_argument("--out", default=os.environ.get("NEU_DIAG_REPORTS", "/var/lib/neu-agent/reports"))
    ap.add_argument("--health", default=os.environ.get("NEU_DIAG_HEALTH", "/var/lib/neu-agent/health.json"))
    ap.add_argument("--dl-dir", default=os.environ.get("NEU_DL_DIR", "/var/www/neu-agent-dl"), help="thư mục tải về chứa latest.json")
    ap.add_argument("--quota-db", default=os.environ.get("NEU_QUOTA_DB", "/var/lib/neu-agent/quota/usage.db"), help="CSDL hạn mức token của cổng hạn mức")
    ap.add_argument("--now", help="ISO hoặc epoch; mặc định: bây giờ")
    a = ap.parse_args(argv)
    S = run(a.diag_dir, a.nginx_log, a.out, a.health, R.parse_now(a.now), a.dl_dir, a.quota_db)
    print("Đã ghi %s/index.html (%d người dùng 30 ngày, %d lượt 24 giờ)" % (a.out, S["kpi"]["users_30d"], S["kpi"]["turns_24h"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
