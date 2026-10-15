#!/usr/bin/env python3
"""NEU Agent - trang tổng quan quản trị (máy 220). Chỉ dùng thư viện chuẩn của Python 3.

Đọc JSONL chẩn đoán (giữ 90 ngày) + nhật ký nginx (giữ 14 ngày, số liệu theo ngày được cộng dồn sang nginx-daily.json) rồi viết:
  <out>/index.html   trang tổng quan (một tệp tĩnh, biểu đồ SVG, không script, không tài nguyên ngoài) — là trang mặc định của /agent/admin/ (khoảng 30 ngày)
  <out>/index-1d.html, index-3d.html, index-7d.html, index-90d.html   cùng trang cho các khoảng 1 ngày/3 ngày (chia theo giờ), 7 ngày, 90 ngày
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
DAYS = 30            # số ngày của khoảng mặc định
# Khoảng xem: khoá -> (số cột, chia theo giờ?, nhãn trong tiêu đề, nhãn nút). 1d/3d chia theo giờ; khoảng mặc định ghi vào index.html, còn lại index-<khoá>.html
RANGES = {"1d": (24, True, "24 giờ", "1 ngày"), "3d": (72, True, "3 ngày", "3 ngày"), "7d": (7, False, "7 ngày", "7 ngày"), "30d": (30, False, "30 ngày", "30 ngày"), "90d": (90, False, "90 ngày", "90 ngày")}
DEFAULT_RANGE = "30d"
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
         "update_download": "Tải bản cập nhật", "download_open": "Mở hộp Tải ứng dụng", "slash_command": "Dùng lệnh /", "point_edit": "Chỉ vào để sửa (Design)", "feedback_send": "Gửi góp ý / báo lỗi", "share_create": "Chia sẻ cuộc trò chuyện", "guide_open": "Mở Hướng dẫn", "mention_file": "Nhắc tệp bằng @", "stop_click": "Bấm Dừng"}
FB_VI = {"wrong": "Sai/không đúng ý", "incomplete": "Chưa làm xong", "slow": "Chậm", "confusing": "Khó hiểu", "other": "Khác", "none": "Không chọn lý do"}
NOT_TOOL_FAULT = ("program", "denied")  # kết quả bình thường/ý người dùng, không tính là công cụ lỗi


def vn_day(ts):
    return datetime.datetime.fromtimestamp(ts, TZ).date().isoformat()


# ---------------------------------------------------------------- nginx theo ngày (cộng dồn)
def nginx_daily(rows, keyf=None):
    """Gom nhật ký nginx theo ngày VN (mặc định) hoặc theo khoá keyf(ts), ví dụ vn_hour."""
    keyf = keyf or vn_day
    d = collections.defaultdict(lambda: {"req": 0, "chat": 0, "chat_ok": 0, "chat_5xx": 0, "pkg": 0, "update_check": 0, "diag": 0})
    rts, chat_st, diag_st = collections.defaultdict(list), collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    for r in rows:
        day = keyf(r["_ts"])
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


def vn_hour(ts):
    return datetime.datetime.fromtimestamp(ts, TZ).strftime("%Y-%m-%d %H:00")


def range_page(key):
    return "index.html" if key == DEFAULT_RANGE else "index-%s.html" % key


def range_info(key):
    n, hourly, label, pill = RANGES[key]
    return {"key": key, "label": label, "pill": pill, "hourly": hourly, "buckets": n, "per": "giờ" if hourly else "ngày",
            "long": "%s gần nhất%s" % (label, ", theo giờ" if hourly else ""), "page": range_page(key)}


def bucket_keys(t, key):
    """Nhãn các cột của khoảng: giờ ('YYYY-MM-DD HH:00') cho 1d/3d, ngày ('YYYY-MM-DD') cho các khoảng còn lại; cũ → mới."""
    n, hourly = RANGES[key][:2]
    if hourly:
        h0 = int(t // 3600)
        return [vn_hour((h0 - i) * 3600) for i in range(n - 1, -1, -1)]
    d0 = datetime.date.fromisoformat(vn_day(t))
    return [(d0 - datetime.timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def range_start(t, key):
    n, hourly = RANGES[key][:2]
    return (int(t // 3600) - (n - 1)) * 3600 if hourly else t - n * 86400


def _pd():
    return {"users": set(), "installs": set(), "turns": 0, "out": collections.Counter(), "dur": [], "ttft": [], "ptok": 0, "ctok": 0, "tool_calls": 0, "tool_fails": 0, "signals": 0, "llm_errors": 0, "retries": 0, "calls": 0, "peak": [], "cached": 0, "tool_out": 0, "pruned": 0, "first_tool": [], "turns_v2": 0,
            "ctx_n": 0, "ctx_hi": 0, "compactions": 0, "perm_allow": 0, "perm_deny": 0, "steps": []}


def _span(key):
    n, hourly = RANGES[key][:2]
    return n * (3600 if hourly else 86400)


def _acc(t, key):
    t0 = range_start(t, key)
    has_prev = t0 - _span(key) >= t - HIST_DAYS * 86400          # kỳ liền trước nằm trọn trong thời hạn giữ dữ liệu
    return {"key": key, "hourly": RANGES[key][1], "t0": t0, "tp": t0 - _span(key) if has_prev else t0, "has_prev": has_prev, "D": collections.defaultdict(_pd), "heat": [[0] * 24 for _ in range(7)],
            "dist": {k: collections.defaultdict(lambda: {"users": set(), "installs": set(), "turns": 0}) for k in ("version", "platform", "profile", "model")},
            "qual": {k: collections.defaultdict(lambda: {"turns": 0, "out": collections.Counter(), "dur": [], "ttft": []}) for k in ("version", "profile", "model", "platform")},
            "work": {k: collections.defaultdict(lambda: {"turns": 0, "out": collections.Counter(), "dur": [], "steps": [], "redo": 0, "vpass": 0, "vfail": 0, "tok": 0, "new": 0, "edit": 0}) for k in WORK_DIMS},
            "tool_v": collections.defaultdict(lambda: [0, 0, 0, 0]), "tool_err_v": collections.Counter(), "tool_dur": collections.defaultdict(collections.Counter),
            "signals": collections.Counter(), "sig_tool": collections.Counter(), "llm_err": collections.Counter(), "llm_status": collections.Counter(),
            "outcomes": collections.Counter(), "ui": collections.Counter(), "fb": collections.Counter(), "uturns": collections.Counter(), "utok": collections.Counter(),
            "users": set(), "installs": set(), "pusers": set(), "pturns": 0, "perrs": 0}


def compute(recs, daily, now, findings=None, release=None, quota=None):
    """Số liệu của khoảng mặc định (30 ngày)."""
    return compute_all(recs, daily, now, findings, release, (lambda _n: quota), keys=(DEFAULT_RANGE,))[DEFAULT_RANGE]


WORK_DIMS = ("kind", "art", "stack", "ui", "nth")


def _wrow(value, x):
    """Một hàng của bảng "Công việc người dùng làm": kết quả, tỷ lệ nói chưa đạt (redo), kiểm chứng cuối hỏng, số bước và token trung bình."""
    n, o = x["turns"], x["out"]
    v = x["vpass"] + x["vfail"]
    return {"value": value, "turns": n, "ok_rate": R.ratio(o.get("ok", 0), n) if n else None, "bad_rate": R.ratio(o.get("error", 0) + o.get("loop", 0) + o.get("step_limit", 0), n) if n else None,
            "interrupt_rate": R.ratio(o.get("interrupted", 0), n) if n else None, "redo_rate": R.ratio(x["redo"], n) if n else None, "verify_n": v,
            "verify_fail_rate": R.ratio(x["vfail"], v) if v else None, "steps_p50": R.pct(x["steps"], 50) if x["steps"] else None,
            "tok_avg": round(x["tok"] / n) if n else None, "dur_p50": R.pct(x["dur"], 50) if x["dur"] else None, "files_new": x["new"], "files_edit": x["edit"]}


def _qrow(value, x):
    n, o = x["turns"], x["out"]
    return {"value": value, "turns": n, "error_rate": R.ratio(o.get("error", 0), n) if n else None, "stop_rate": R.ratio(o.get("loop", 0) + o.get("step_limit", 0), n) if n else None,
            "interrupt_rate": R.ratio(o.get("interrupted", 0), n) if n else None, "dur_p50": R.pct(x["dur"], 50) if x["dur"] else None, "dur_p95": R.pct(x["dur"], 95) if x["dur"] else None,
            "ttft_p50": R.pct(x["ttft"], 50) if x["ttft"] else None, "ttft_p95": R.pct(x["ttft"], 95) if x["ttft"] else None}


def find_anomalies(series, hourly):
    """Cột (giờ/ngày) bất thường so với phần còn lại của khoảng: tỷ lệ lỗi, thời gian một lượt p95, 5xx của cổng mô hình. Trả [{idx, kind, msg}] nặng nhất trước."""
    per = "giờ" if hourly else "ngày"
    rates = sorted(x["error_rate"] for x in series if x["turns"] >= 10 and x["error_rate"] is not None)
    p95s = sorted(x["dur_p95"] for x in series if x["turns"] >= 10 and x["dur_p95"] is not None)
    med_r = rates[len(rates) // 2] if rates else 0
    med_p = p95s[len(p95s) // 2] if p95s else 0
    out = []
    for i, x in enumerate(series):
        if x["turns"] >= 10 and x["error_rate"] is not None and x["error_rate"] >= max(0.15, 2 * med_r):
            out.append({"idx": i, "kind": "error", "score": x["error_rate"], "msg": "%s: %d%% lượt lỗi (%d trên %d lượt)" % (x["day"], round(100 * x["error_rate"]), x["errors"], x["turns"])})
        if x["turns"] >= 10 and x["dur_p95"] is not None and x["dur_p95"] >= max(60, 2 * med_p):
            out.append({"idx": i, "kind": "slow", "score": x["dur_p95"] / max(med_p, 1), "msg": "%s: p95 một lượt %.0f giây (bình thường %.0f giây)" % (x["day"], x["dur_p95"], med_p)})
        if x["chat"] >= 20 and x["chat_5xx"] / x["chat"] >= 0.05:
            out.append({"idx": i, "kind": "5xx", "score": x["chat_5xx"] / x["chat"], "msg": "%s: cổng mô hình lỗi 5xx %d trên %d lệnh" % (x["day"], x["chat_5xx"], x["chat"])})
    # một điều kiện xảy ra ở phần lớn các cột là mức nền của hệ thống, không phải bất thường: gộp thành một dòng
    res = []
    for kind in ("error", "slow", "5xx"):
        xs = [a for a in out if a["kind"] == kind]
        if len(xs) > max(3, 0.4 * len(series)):
            what = {"error": "tỷ lệ lượt lỗi cao", "slow": "p95 một lượt chậm", "5xx": "cổng mô hình lỗi 5xx ≥ 5%"}[kind]
            res.append({"idx": None, "kind": kind + "_base", "score": 0.5, "msg": "%d/%d %s có %s: đây là mức nền, không phải ngoại lệ — nên xử lý nguyên nhân gốc" % (len(xs), len(series), per, what)})
        else:
            res += xs
    res.sort(key=lambda a: -a["score"])
    return res[:8]


def compute_all(recs, daily, now, findings=None, release=None, quota_fn=None, hourly=None, keys=tuple(RANGES)):
    """Một lượt đọc dữ liệu cho mọi khoảng xem: trả {khoá khoảng: S}. Phần không phụ thuộc khoảng (cửa sổ cố định, phễu, nhóm người dùng) tính một lần.
    daily: số liệu nginx theo ngày; hourly: số liệu nginx theo giờ (cho 1d/3d); quota_fn(số ngày) -> số liệu hạn mức.
    Mỗi khoảng còn gom thêm kỳ liền trước cùng độ dài (để so sánh) nếu nằm trọn trong thời hạn giữ dữ liệu."""
    t = now.timestamp()
    today = vn_day(t)
    # dài trước: bản ghi nằm ngoài khoảng dài (kể cả kỳ trước) thì cũng nằm ngoài mọi khoảng ngắn hơn
    accs = [_acc(t, k) for k in sorted(keys, key=lambda k: _acc(t, k)["tp"])]
    U = {}
    vfirst = {}
    # cửa sổ trượt: (đầu, cuối) tính bằng giây trước hiện tại
    W = {"24h": (0, 86400), "p24": (86400, 172800), "7d": (0, 7 * 86400), "p7": (7 * 86400, 14 * 86400), "30d": (0, 30 * 86400), "p30": (30 * 86400, 60 * 86400), "all": (0, HIST_DAYS * 86400)}
    win = {k: {"users": set(), "installs": set(), "turns": 0, "errors": 0} for k in W}
    first_ts = None
    for r in recs:
        ts, uid, a, e = r["ts_srv"], r.get("uid") or "?", r.get("a") or {}, r["e"]
        et = e.get("t")
        dt = datetime.datetime.fromtimestamp(ts, TZ)
        day = dt.date().isoformat()
        hk = "%s %02d:00" % (day, dt.hour)
        ins = a.get("install")
        age = t - ts
        is_turn, is_err = et == "turn", et == "turn" and e.get("end") == "error"
        first_ts = ts if first_ts is None or ts < first_ts else first_ts
        ver = str(a.get("version", ""))
        if ver and (ver not in vfirst or ts < vfirst[ver]):
            vfirst[ver] = ts
        for k, (lo, hi) in W.items():
            if lo <= age < hi:
                w = win[k]
                w["users"].add(uid)
                w["installs"].add(ins)
                w["turns"] += is_turn
                w["errors"] += is_err
        u = U.setdefault(uid, {"first": ts, "last": ts, "days": set(), "turns": 0, "errors": 0, "by_day": collections.Counter(), "prof": collections.Counter(), "plat": collections.Counter(), "ver": "", "model": "", "ver_ts": 0, "installs": set()})
        u["first"], u["last"] = min(u["first"], ts), max(u["last"], ts)
        u["days"].add(day)
        u["installs"].add(ins)
        if ts >= u["ver_ts"]:
            u["ver_ts"], u["ver"], u["model"] = ts, ver, str(a.get("model", ""))
        if is_turn:
            u["turns"] += 1
            u["errors"] += is_err
            u["by_day"][day] += 1
            u["prof"][str(a.get("profile", "?"))] += 1
            u["plat"][str(a.get("platform", "?"))] += 1
        for ac in accs:
            if ts < ac["tp"]:
                break
            inr = ts >= ac["t0"]
            pd = ac["D"][hk if ac["hourly"] else day]
            pd["users"].add(uid)
            pd["installs"].add(ins)
            if inr:
                ac["users"].add(uid)
                ac["installs"].add(ins)
            else:
                ac["pusers"].add(uid)
            if is_turn:
                pd["turns"] += 1
                pd["out"][e.get("end", "?")] += 1
                if "dur_s" in e:
                    pd["dur"].append(e["dur_s"])
                if "ttft_ms" in e:
                    pd["ttft"].append(e["ttft_ms"])
                pd["ptok"] += e.get("prompt_tok", 0)
                pd["ctok"] += e.get("completion_tok", 0)
                if "ctx_pct" in e:
                    pd["ctx_n"] += 1
                    pd["ctx_hi"] += e["ctx_pct"] >= 85
                pd["compactions"] += e.get("compactions", 0)
                pd["perm_allow"] += e.get("perm_allow", 0)
                pd["perm_deny"] += e.get("perm_deny", 0)
                if "steps" in e:
                    pd["steps"].append(e["steps"])
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
                if not inr:
                    ac["pturns"] += 1
                    ac["perrs"] += is_err
                    continue
                ac["uturns"][uid] += 1
                ac["utok"][uid] += e.get("prompt_tok", 0) + e.get("completion_tok", 0)
                ac["heat"][dt.weekday()][dt.hour] += 1
                ac["outcomes"][e.get("end", "?")] += 1
                for k, d in ac["work"].items():
                    v = e.get(k)
                    if k == "nth" and v is not None:
                        v = "1" if v == 1 else "2" if v == 2 else "3–5" if v <= 5 else "6+"
                    if v is None:
                        continue
                    w = d[str(v)]
                    w["turns"] += 1
                    w["out"][e.get("end", "?")] += 1
                    if "dur_s" in e:
                        w["dur"].append(e["dur_s"])
                    if "steps" in e:
                        w["steps"].append(e["steps"])
                    w["redo"] += bool(e.get("redo"))
                    w["vpass"] += e.get("verify") == "pass"
                    w["vfail"] += e.get("verify") == "fail"
                    w["tok"] += e.get("prompt_tok", 0) + e.get("completion_tok", 0)
                    w["new"] += e.get("files_new", 0)
                    w["edit"] += e.get("files_edit", 0)
                for k, d in ac["qual"].items():
                    q = d[str(a.get(k, "?"))]
                    q["turns"] += 1
                    q["out"][e.get("end", "?")] += 1
                    if "dur_s" in e:
                        q["dur"].append(e["dur_s"])
                    if "ttft_ms" in e:
                        q["ttft"].append(e["ttft_ms"])
            elif not inr:
                continue
            elif et == "tool":
                failed = e.get("ok") is False
                err = e.get("err")
                real = failed and err not in NOT_TOOL_FAULT
                pd["tool_calls"] += 1
                pd["tool_fails"] += real
                nm = e.get("name", "other")
                x = ac["tool_v"][(ver, nm)]
                x[0] += 1
                if e.get("dur"):
                    ac["tool_dur"][nm][e["dur"]] += 1
                if failed:
                    ac["tool_err_v"][(ver, nm, err or "unknown")] += 1
                    if not err:
                        x[3] += 1                      # bản ứng dụng cũ chưa phân loại lỗi
                    else:
                        x[1 if real else 2] += 1
            elif et == "signal":
                pd["signals"] += 1
                ac["signals"][e.get("code", "?")] += 1
                if e.get("tool"):
                    ac["sig_tool"][(e.get("code", "?"), e["tool"])] += 1
            elif et == "llm_error":
                pd["llm_errors"] += 1
                ac["llm_err"][e.get("kind", "?")] += 1
                if e.get("status"):
                    ac["llm_status"][(e.get("kind", "?"), e["status"])] += 1
            elif et == "llm_retry":
                pd["retries"] += 1
            elif et == "ui":
                ac["ui"][e.get("act", "?")] += 1
            elif et == "feedback":
                ac["fb"][e.get("v", "?")] += 1
                if e.get("v") == "down":
                    ac["fb"]["why:" + (e.get("reason") or "none")] += 1
            if inr:
                for k, d in ac["dist"].items():
                    x = d[str(a.get(k, "?"))]
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
        "errors_24h": win["24h"]["errors"], "error_rate_24h": er("24h"),
        "new_users_7d": len(new7), "new_users_30d": len(new30),
        "returning_7d": R.ratio(len(win["7d"]["users"] & prev7), len(prev7)) if prev7 else None,
        "error_rate_7d": er("7d"), "error_rate_prev7": er("p7"),
        "prev": {"users_24h": n("p24", "users"), "users_7d": n("p7", "users"), "users_30d": n("p30", "users"), "turns_24h": win["p24"]["turns"], "turns_7d": win["p7"]["turns"], "turns_30d": win["p30"]["turns"]},
    }
    spark_days = [(datetime.date.fromisoformat(today) - datetime.timedelta(days=i)).isoformat() for i in range(SPARK_DAYS - 1, -1, -1)]
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
    common = {"generated": datetime.datetime.fromtimestamp(t, TZ).strftime("%Y-%m-%d %H:%M"), "today": today, "first_data": vn_day(first_ts) if first_ts is not None else today, "kpi": kpi, "spark_days": spark_days, "segments": seg, "funnel": funnel,
              "hist_turns": [(k, hist_turns.get(k, 0)) for k in tl], "hist_days": [(k, hist_days.get(k, 0)) for k in dl], "findings": findings or [],
              "downloads_total": sum(v.get("pkg", 0) for v in daily.values()), "daily_first": min(daily) if daily else None}
    out = {}
    for ac in accs:
        key, hourly_ = ac["key"], ac["hourly"]
        keyf = vn_hour if hourly_ else vn_day
        labels = bucket_keys(t, key)
        ng_src = (hourly or {}) if hourly_ else daily
        D = ac["D"]
        first_key = keyf(first_ts) if first_ts is not None else keyf(t)
        new_by = collections.Counter(keyf(u["first"]) for u in U.values())

        def row(d):
            pd, ng = D.get(d), ng_src.get(d, {})
            o = pd["out"] if pd else collections.Counter()
            cn = pd["ctx_n"] if pd else 0
            return {
                "day": d, "users": len(pd["users"]) if pd else 0, "installs": len(pd["installs"]) if pd else 0,
                "new": new_by.get(d, 0) if d > first_key else 0, "turns": pd["turns"] if pd else 0, "errors": o.get("error", 0),
                "outcomes": {k: o.get(k, 0) for k in OUTCOMES},
                "error_rate": R.ratio(o.get("error", 0), pd["turns"]) if pd and pd["turns"] else None,
                "dur_p50": R.pct(pd["dur"], 50) if pd else None, "dur_p95": R.pct(pd["dur"], 95) if pd else None,
                "ttft_p50": R.pct(pd["ttft"], 50) if pd else None, "ttft_p95": R.pct(pd["ttft"], 95) if pd else None,
                "ptok": pd["ptok"] if pd else 0, "ctok": pd["ctok"] if pd else 0,
                "tool_calls": pd["tool_calls"] if pd else 0, "tool_fails": pd["tool_fails"] if pd else 0,
                "signals": pd["signals"] if pd else 0, "llm_errors": pd["llm_errors"] if pd else 0,
                "calls_per_turn": R.ratio(pd["calls"], pd["turns_v2"]) if pd and pd["turns_v2"] else None, "peak_prompt_avg": (sum(pd["peak"]) / len(pd["peak"])) if pd and pd["peak"] else None,
                "cached_ratio": R.ratio(pd["cached"], pd["ptok"]) if pd and pd["ptok"] and pd["cached"] else None, "tool_out_per_turn": R.ratio(pd["tool_out"], pd["turns_v2"]) if pd and pd["turns_v2"] else None,
                "pruned": pd["pruned"] if pd else 0, "first_tool_p50": R.pct(pd["first_tool"], 50) if pd and pd["first_tool"] else None, "turns_v2": pd["turns_v2"] if pd else 0,
                "ctx_n": cn, "ctx_hi_ratio": R.ratio(pd["ctx_hi"], cn) if cn else None, "compactions": pd["compactions"] if pd else 0, "perm_allow": pd["perm_allow"] if pd else 0, "perm_deny": pd["perm_deny"] if pd else 0,
                "steps_p50": R.pct(pd["steps"], 50) if pd and pd["steps"] else None, "steps_p95": R.pct(pd["steps"], 95) if pd and pd["steps"] else None,
                "chat": ng.get("chat", 0), "chat_5xx": ng.get("chat_5xx", 0), "chat_p50": ng.get("chat_p50"), "chat_p95": ng.get("chat_p95"), "chat_st": ng.get("chat_st", {}), "diag_st": ng.get("diag_st", {}), "diag": ng.get("diag", 0), "pkg": ng.get("pkg", 0), "update_check": ng.get("update_check", 0)}

        series = [row(d) for d in labels]
        prev_series = [row(d) for d in bucket_keys(t - _span(key), key)] if ac["has_prev"] else None
        if prev_series is not None and not any(x["turns"] or x["users"] for x in prev_series):
            prev_series = None
        users = []
        for uid, u in sorted(U.items(), key=lambda kv: (-ac["uturns"].get(kv[0], 0), -kv[1]["last"]))[:TOP_USERS]:
            st = "mới" if u["first"] >= t - 7 * 86400 else ("hoạt động" if u["last"] >= t - 7 * 86400 else "ngủ đông")
            users.append({"id": uid[:8], "status": st, "first": vn_day(u["first"]), "last": datetime.datetime.fromtimestamp(u["last"], TZ).strftime("%Y-%m-%d %H:%M"),
                          "days": len(u["days"]), "turns30": ac["uturns"].get(uid, 0), "turns": u["turns"], "error_rate": R.ratio(u["errors"], u["turns"]) if u["turns"] else None,
                          "spark": [u["by_day"].get(d, 0) for d in spark_days],
                          "profile": (u["prof"].most_common(1) or [("—", 0)])[0][0], "platform": (u["plat"].most_common(1) or [("—", 0)])[0][0], "version": u["ver"], "model": u["model"]})
        dists = {k: [{"value": v, "users": len(x["users"]), "installs": len(x["installs"]), "turns": x["turns"]} for v, x in sorted(d.items(), key=lambda kv: (-len(kv[1]["users"]), -kv[1]["turns"]))] for k, d in ac["dist"].items()}
        fb = ac["fb"]
        latest_ver = collections.Counter(U[uid]["ver"] for uid in ac["users"] if uid in U)     # mỗi người một phiên bản: bản đang dùng gần nhất
        # công cụ: bản ứng dụng cũ không gắn mã lý do lỗi nên không phân biệt được "chương trình lỗi"; loại các bản đó khỏi tỷ lệ lỗi
        byv = collections.defaultdict(lambda: [0, 0, 0, 0])
        for (v, _nm), x in ac["tool_v"].items():
            for i in range(4):
                byv[v][i] += x[i]
        old = {v for v, x in byv.items() if x[3] > 0 and x[1] + x[2] == 0}
        tl_ = {}
        for (v, nm), x in ac["tool_v"].items():
            r = tl_.setdefault(nm, {"name": nm, "calls": 0, "rated": 0, "fails": 0, "prog": 0, "unk": 0})
            r["calls"] += x[0]
            if v in old:
                r["unk"] += x[3]
            else:                                  # bản đã phân loại lỗi: lỗi không mã (hiếm) vẫn tính là lỗi công cụ
                r["rated"] += x[0]
                r["fails"] += x[1] + x[3]
                r["prog"] += x[2]
        tools = sorted(tl_.values(), key=lambda x: -x["calls"])
        terr, by_tool = collections.Counter(), collections.defaultdict(collections.Counter)
        for (v, nm, err), c in ac["tool_err_v"].items():
            if v not in old:
                terr[err] += c
                by_tool[nm][err] += c
        slow = []
        for nm, dc in ac["tool_dur"].items():
            tot = sum(dc.values())
            if tot >= 10:
                s5 = tot - dc.get("lt1s", 0) - dc.get("lt5s", 0)
                if s5:
                    slow.append({"name": nm, "calls": tot, "slow": s5, "ratio": s5 / tot})
        slow.sort(key=lambda x: (-x["ratio"], -x["calls"]))
        toks = sorted(ac["utok"].values(), reverse=True)
        conc = None
        if toks and sum(toks):
            k = max(1, -(-len(toks) // 10))
            conc = {"users": len(toks), "total": sum(toks), "top1": toks[0] / sum(toks), "top_n": k, "top_share": sum(toks[:k]) / sum(toks)}
        out[key] = {
            **common, "range": {**range_info(key), "users": len(ac["users"]), "installs": len(ac["installs"]), "turns": sum(ac["uturns"].values()),
                                "prev": {"users": len(ac["pusers"]), "turns": ac["pturns"], "errors": ac["perrs"]} if ac["has_prev"] and (ac["pturns"] or ac["pusers"]) else None},
            "series": series, "prev_series": prev_series, "anomalies": find_anomalies(series, hourly_), "users": users, "users_listed": len(users), "dist": dists,
            "hours": [sum(ac["heat"][w][h] for w in range(7)) for h in range(24)], "heat": ac["heat"],
            "outcomes30": {k: ac["outcomes"].get(k, 0) for k in OUTCOMES},
            "quality": {k: [_qrow(v, x) for v, x in sorted(d.items(), key=lambda kv: -kv[1]["turns"])[:10]] for k, d in ac["qual"].items()},
            "work": {k: [_wrow(v, x) for v, x in sorted(d.items(), key=lambda kv: (kv[0] if k == "nth" else -kv[1]["turns"]))[:12]] for k, d in ac["work"].items()},
            "version_first": {v: (vn_hour(ts) if hourly_ else vn_day(ts)) for v, ts in vfirst.items()},
            "tools": tools, "tool_errors": dict(terr.most_common()), "tool_unknown": sum(x["unk"] for x in tools), "tool_unknown_versions": sorted(old),
            "tool_reasons": {nm: dict(c.most_common(3)) for nm, c in sorted(by_tool.items(), key=lambda kv: -sum(kv[1].values()))[:12]}, "tool_slow": slow[:8],
            "signals": dict(ac["signals"].most_common()), "signals_by_tool": [{"code": c, "tool": tl2, "n": v} for (c, tl2), v in ac["sig_tool"].most_common(10)],
            "llm_errors": dict(ac["llm_err"].most_common()), "llm_status": [{"kind": k2, "status": s2, "n": v} for (k2, s2), v in ac["llm_status"].most_common(10)],
            "concentration": conc,
            "version_latest": [{"value": v, "users": c} for v, c in latest_ver.most_common()],
            "release": release_info(release, [{"value": v, "users": c} for v, c in latest_ver.items()], len(ac["users"])), "quota": quota_fn(RANGES[key][0] if not hourly_ else 7) if quota_fn else None,
            "ui": dict(ac["ui"].most_common()), "feedback": {"up": fb.get("up", 0), "down": fb.get("down", 0), "reasons": {k: v for k, v in ((k[4:], v) for k, v in fb.items() if k.startswith("why:"))}}}
    return out


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


def read_quota(db_path, now, ndays=DAYS):
    """Mức dùng token theo người (mã giả danh) do cổng hạn mức đếm (deploy/220/quota). None nếu chưa cài/chưa có dữ liệu."""
    try:
        db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True, timeout=3)
    except sqlite3.Error:
        return None
    try:
        t = now.timestamp()
        today = vn_day(t)
        since = vn_day(t - (ndays - 1) * 86400)
        rows = db.execute("SELECT uid,tier,lim,tokens,requests,blocked,estimated FROM usage WHERE day=? ORDER BY tokens DESC", (today,)).fetchall()
        users = []
        for uid, tier, lim, tokens, req, blocked, est in rows:
            pct = None if lim < 0 else (100.0 * tokens / lim if lim else 100.0)
            users.append({"id": uid[:8], "tier": tier, "tokens": tokens, "limit": None if lim < 0 else lim, "pct": None if pct is None else round(pct, 1), "requests": req, "blocked": blocked, "estimated": est})
        by_day = {r[0]: r[1:] for r in db.execute("SELECT day,sum(tokens),count(*),sum(blocked),sum(CASE WHEN lim>=0 AND tokens>=lim*0.8 THEN 1 ELSE 0 END) FROM usage WHERE day>=? GROUP BY day", (since,))}
        days = [(datetime.date.fromisoformat(today) - datetime.timedelta(days=i)).isoformat() for i in range(ndays - 1, -1, -1)]
        series = [{"day": d, "tokens": (by_day.get(d) or (0, 0, 0, 0))[0] or 0, "users": (by_day.get(d) or (0, 0, 0, 0))[1], "blocked": (by_day.get(d) or (0, 0, 0, 0))[2] or 0, "near": (by_day.get(d) or (0, 0, 0, 0))[3] or 0} for d in days]
        pct_hist = collections.OrderedDict((k, 0) for k in ("< 25%", "25–50%", "50–80%", "80–100%", "≥ 100%", "không giới hạn"))
        for u in users:
            p_ = u["pct"]
            pct_hist["không giới hạn" if p_ is None else "< 25%" if p_ < 25 else "25–50%" if p_ < 50 else "50–80%" if p_ < 80 else "80–100%" if p_ < 100 else "≥ 100%"] += 1
        tiers = collections.defaultdict(lambda: {"users": 0, "tokens": 0})
        for u in users:
            tiers[u["tier"]]["users"] += 1
            tiers[u["tier"]]["tokens"] += u["tokens"]
        return {
            "today": today, "users": users[:30], "users_today": len(users), "tokens_today": sum(u["tokens"] for u in users),
            "near": sum(1 for u in users if u["pct"] is not None and 80 <= u["pct"] < 100), "over": sum(1 for u in users if u["pct"] is not None and u["pct"] >= 100),
            "blocked_users": sum(1 for u in users if u["blocked"]), "blocked_requests": sum(u["blocked"] for u in users), "series": series, "tiers": dict(tiers), "pct_hist": list(pct_hist.items()),
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
    ctxs = [x for x in S["series"] if x.get("ctx_n")]
    if ctxs:
        n_ = sum(x["ctx_n"] for x in ctxs)
        hi = sum(round((x["ctx_hi_ratio"] or 0) * x["ctx_n"]) for x in ctxs)
        if n_ >= 20 and hi / n_ >= 0.10:
            out.append(("warn", "Ngữ cảnh gần đầy (≥ 85%% cửa sổ) ở %s lượt: dễ bị nén/cắt, nên xem lại cách dùng hoặc giới hạn kết quả công cụ." % R._p(hi / n_)))
    errs = sum(x["errors"] for x in S["series"])
    tot = sum(x["turns"] for x in S["series"])
    for r_ in (S.get("quality") or {}).get("version", []):
        if r_["turns"] >= 30 and r_["error_rate"] is not None and tot and r_["error_rate"] >= max(0.10, 2 * errs / tot):
            out.append(("bad", "Phiên bản %s có %s lượt lỗi (%d lượt), cao gấp đôi mức chung %s: nên kiểm tra bản này." % (r_["value"], R._p(r_["error_rate"]), r_["turns"], R._p(errs / tot))))
    rl = S.get("release")
    if rl and rl.get("adoption") is not None:
        out.append(("good" if rl["adoption"] >= 0.8 else "warn" if rl["adoption"] < 0.5 else "info", "%s người dùng %s đã dùng bản mới nhất đang phát hành (%s)%s." % (R._p(rl["adoption"]), (S.get("range") or {}).get("label", "30 ngày"), rl["version"], "; còn %d người dưới phiên bản tối thiểu %s" % (rl["below_min"], rl["min"]) if rl.get("below_min") else "")))
    qt = S.get("quota")
    if qt and qt["users_today"]:
        if qt["blocked_users"]:
            out.append(("bad", "%d người đã bị chặn vì hết hạn mức token hôm nay (%d yêu cầu bị từ chối)." % (qt["blocked_users"], qt["blocked_requests"])))
        if qt["near"] + qt["over"]:
            out.append(("warn", "%d người đã dùng ≥ 80%% hạn mức token hôm nay (%d người đã chạm hạn mức)." % (qt["near"] + qt["over"], qt["over"])))
    vs = S.get("version_latest") or S["dist"]["version"]
    if len(vs) > 1 and not rl:
        newest = max(vs, key=lambda x: _ver_key(x["value"]))["value"]
        old = sum(x["users"] for x in vs if x["value"] != newest)
        if old:
            out.append(("info", "%d người dùng (%s) vẫn dùng phiên bản cũ hơn %s." % (old, (S.get("range") or {}).get("label", "30 ngày"), newest)))
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
        checks = {str(k): {"ok": bool(v.get("ok")), "warn": bool(v.get("warn")), "ms": v.get("ms"), "detail": str(v.get("detail", ""))[:80]} for k, v in (h.get("checks") or {}).items() if isinstance(v, dict)}
        return bool(h.get("ok")) and age < 900, failed[:10], age, checks
    except (OSError, ValueError, AttributeError):
        return None, [], None, {}


def range_nav(cur):
    """Hàng nút chọn khoảng thời gian (liên kết tới trang đã tạo sẵn của từng khoảng)."""
    return '<span class="rng">Khoảng thời gian:' + "".join('<a href="%s" title="%s"%s>%s</a>' % (range_page(k), _e(range_info(k)["long"]), ' class="on" aria-current="page"' if k == cur else "", _e(RANGES[k][3])) for k in RANGES) + "</span>"


def render(S, health, report_links, nginx_note, info=None, sysinfo=None, cohorts=None):
    k, ser = S["kpi"], S["series"]
    lab = [x["day"] for x in ser]
    rg = S.get("range") or range_info(DEFAULT_RANGE)
    lbl, per, hourly = rg["label"], rg["per"], rg["hourly"]
    nsp = len(ser) if hourly else SPARK_DAYS       # số cột của đường nhỏ trên thẻ
    prev = S.get("prev_series")

    def pcol(f, scale=1):
        return None if not prev else [None if x[f] is None else x[f] * scale for x in prev]

    # vạch đứng: ngày/giờ một phiên bản (≥ 2 người dùng) xuất hiện lần đầu trong khoảng, không tính ngày đầu của dữ liệu
    vers = {x["value"]: x["users"] for x in S["dist"]["version"]}
    marks, mnote = {}, []
    for v_, k_ in sorted((S.get("version_first") or {}).items(), key=lambda kv: kv[1]):
        if k_[:10] > S.get("first_data", "") and k_ in lab and lab.index(k_) > 0 and vers.get(v_, 0) >= 2:
            i_ = lab.index(k_)
            marks[i_] = (marks[i_] + ", " if i_ in marks else "") + "phiên bản " + v_
            mnote.append("%s (%s)" % (v_, k_[5:]))
    pvl = [("Kỳ trước (đường đứt nét)", "pv")] if prev else []

    def col(f):
        return [x[f] for x in ser]

    def sp(f, cls="s1"):
        return spark(col(f)[-nsp:], cls)

    ok, failed, age, checks = health
    info = info or {"linked": set(), "days": set(), "reports": []}
    dl = ["d-%s.html" % d if d in info["days"] else None for d in lab]
    if ok is None:
        hs = '<span class="bad">chưa có dữ liệu kiểm tra sức khoẻ</span>'
    elif ok:
        hs = '<span class="ok">hoạt động tốt</span> (kiểm tra %d phút trước)' % max(age // 60, 0)
        warn = [nm for nm, v in checks.items() if v.get("warn")]
        if warn:
            hs += ' · <span class="bad">cảnh báo: %s</span>' % _e(", ".join(warn))
    else:
        hs = '<span class="bad">có sự cố: %s</span>' % _e(", ".join(failed) or "kiểm tra đã cũ")
    ret, e7, p = k["returning_7d"], k["error_rate_7d"], k["prev"]
    dur_all = [x["dur_p95"] for x in (ser if hourly else ser[-7:]) if x["dur_p95"] is not None]
    o = ['<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quản trị NEU Agent</title><style>%s</style></head><body data-refresh="600"><main>' % CSS]
    o.append('<h1>Quản trị NEU Agent</h1><p class="sub">Cập nhật %s (giờ Việt Nam), tự làm mới mỗi 10 phút. Người dùng chỉ hiện dưới <b>mã giả danh</b>; không có email hay nội dung hội thoại. Đang xem <b>%s</b> (<a href="series-%s.csv">tải CSV</a>); các thẻ số đầu trang luôn theo cửa sổ cố định (24 giờ, 7 ngày, 30 ngày).</p>' % (_e(S["generated"]), _e(rg["long"]), _e(rg["key"])))
    o.append('<nav class="top"><b>NEU Agent</b><a href="#tong-quan">Tổng quan</a><a href="#tang-truong">Tăng trưởng &amp; giữ chân</a><a href="#chat-luong">Chất lượng</a><a href="#su-dung">Cách sử dụng</a><a href="#han-muc">Hạn mức token</a><a href="#nguoi-dung">Người dùng</a><a href="#he-thong">Hệ thống</a>'
             '<span style="flex:1"></span><span>Hệ thống: %s</span><a href="accounts">Tài khoản</a><a href="quota">Hạn mức</a><a href="feedback">Góp ý</a><a href="shares">Chia sẻ</a><a href="data.html">Dữ liệu &amp; CSV</a><a href="latest.html">Báo cáo chất lượng</a><a href="stats.json">JSON</a>%s</nav>' % (hs, range_nav(rg["key"])))

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
             + hero("p95 thời gian một lượt", "—" if not dur_all else "%.0f giây" % max(dur_all), "<i>cao nhất trong %s</i>" % ("khoảng đang xem" if hourly else "7 ngày gần nhất"), spark([x["dur_p95"] or 0 for x in ser[-nsp:]], "s3")) + "</div>")
    cur_t, cur_e = sum(x["turns"] for x in ser), sum(x["errors"] for x in ser)
    pr_t = sum(x["turns"] for x in prev) if prev else None
    pr_e = sum(x["errors"] for x in prev) if prev else None
    pr_u = (S["range"].get("prev") or {}).get("users") if S.get("range") else None
    mini = [(rg.get("users", k["users_30d"]), "người dùng " + lbl, delta(rg.get("users"), pr_u) if pr_u is not None else ""),
            (rg.get("installs", k["installs_30d"]), "máy hoạt động " + lbl, ""),
            (rg.get("turns", k["turns_30d"]), "lượt làm việc " + lbl, delta(cur_t, pr_t) if pr_t is not None else ""),
            ("—" if not cur_t else R._p(cur_e / cur_t), "tỷ lệ lượt lỗi " + lbl, delta(cur_e / cur_t, pr_e / pr_t, inv=True, pct=True) if cur_t and pr_t else ""),
            ("—" if ret is None else R._p(ret), "quay lại (tuần này/tuần trước)", ""),
            (sum(x["tool_calls"] for x in ser), "lần gọi công cụ (%s)" % lbl, ""),
            (sum(x["chat"] for x in ser), "lệnh gọi mô hình (nginx, %s)" % lbl, delta(sum(x["chat"] for x in ser), sum(x["chat"] for x in prev)) if prev and sum(x["chat"] for x in prev) else ""),
            (sum(x["pkg"] for x in ser), "lượt tải bản cài (%s)" % lbl, "")]
    o.append('<div class="mini">' + "".join("<div><b>%s</b><span>%s</span>%s</div>" % (_e(a), _e(b), c) for a, b, c in mini) + "</div>")
    if S["findings"]:
        sev = collections.Counter(f["sev"] for f in S["findings"])
        o.append('<p>Báo cáo chất lượng hôm nay: %s. <a href="latest.html">Xem chi tiết và đề xuất</a>.</p>' % ", ".join('<span class="pill %s">%d mức %s</span>' % ({"cao": "bad", "trung bình": "warn"}.get(s, ""), c, _e(s)) for s, c in sorted(sev.items(), key=lambda kv: R.SEV_ORDER.get(kv[0], 9))))

    # ---- tăng trưởng
    o.append('<h2 id="tang-truong">Tăng trưởng &amp; giữ chân <small>%s</small></h2><div class="grid">' % _e(rg["long"]))
    o.append('<div class="card"><h3>Người dùng hoạt động mỗi %s</h3>%s%s</div>' % (per, bars(col("users"), lab, links=dl, marks=marks, prev=pcol("users")), legend(pvl) if pvl else ""))
    o.append('<div class="card"><h3>Người dùng mới mỗi %s</h3><p class="sub">lần đầu xuất hiện trong dữ liệu</p>%s</div>' % (per, stack([("Mới", col("new"), "s2")], lab)))
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
        heat = lambda v: '<span style="display:block;margin:-5px -8px;padding:5px 8px;text-align:right;background:rgba(74,123,208,%.2f)">%s%%</span>' % (min(max(v, 0), 100) / 100 * .75, v)
        o.append(table(["Tuần", "Người"] + ["+%d" % k for k in range(wmax)], [[c["week"], c["n"]] + [heat(v) for v in c["ret"]] + [""] * (wmax - len(c["ret"])) for c in cohorts], raw=tuple(range(2, 2 + wmax))))

    # ---- chất lượng
    o.append('<h2 id="chat-luong">Chất lượng &amp; hiệu năng <small>%s</small></h2>' % _e(rg["long"]))
    an = S.get("anomalies") or []
    if an:
        o.append('<ul class="ins">' + "".join('<li class="warn">Cột bất thường — %s</li>' % _e(a_["msg"]) for a_ in an[:5]) + "</ul>")
    notes = []
    if mnote:
        notes.append("Vạch tím đứt trên biểu đồ: phiên bản mới xuất hiện — " + ", ".join(mnote[:8]) + ".")
    if prev:
        notes.append("Đường đứt nét: cùng độ dài ngay trước khoảng đang xem (so sánh).")
    v2, tt = sum(x["turns_v2"] for x in ser), sum(x["turns"] for x in ser)
    if tt and v2 < tt:
        notes.append("Số đo token chi tiết (các thẻ “Token đi đâu”, bộ nhớ đệm) chỉ có ở %s lượt: từ bản ứng dụng mới." % R._p(v2 / tt))
    if notes:
        o.append('<p class="note">' + " ".join(_e(n_) for n_ in notes) + "</p>")
    o.append('<div class="grid">')
    oc = [(OUTCOME_VI[nm], [x["outcomes"][nm] for x in ser], c) for nm, c in zip(OUTCOMES, ("s2", "s3", "s4", "s5", "s6"))]
    o.append('<div class="card"><h3>Kết quả các lượt mỗi %s</h3>%s%s</div>' % (per, stack(oc, lab, links=dl, marks=marks, prev=pcol("turns")), legend([(nm, c) for nm, _, c in oc] + pvl)))
    o.append('<div class="card"><h3>Tỷ lệ lượt lỗi mỗi %s</h3>%s%s</div>' % (per, lines([("Tỷ lệ lỗi", [None if v is None else 100 * v for v in col("error_rate")], "s4")], lab, unit="%", marks=marks, prev=pcol("error_rate", 100),
                                                                 flags={a["idx"] for a in S.get("anomalies", []) if a["kind"] == "error" and a["idx"] is not None}), legend(pvl) if pvl else ""))
    o.append('<div class="card"><h3>Thời gian một lượt</h3>%s%s</div>' % (lines([("p50", col("dur_p50"), "s1"), ("p95", col("dur_p95"), "s3")], lab, unit=" s", marks=marks, prev=pcol("dur_p95"),
                                                               flags={a["idx"] for a in S.get("anomalies", []) if a["kind"] == "slow" and a["idx"] is not None}), legend([("p50 (trung vị)", "s1"), ("p95", "s3")] + [("p95 kỳ trước", "pv")] * bool(prev))))
    o.append('<div class="card"><h3>Thời gian tới token đầu tiên</h3>%s%s</div>' % (lines([("p50", col("ttft_p50"), "s1"), ("p95", col("ttft_p95"), "s3")], lab, unit=" ms", marks=marks, prev=pcol("ttft_p95")), legend([("p50", "s1"), ("p95", "s3")] + [("p95 kỳ trước", "pv")] * bool(prev))))
    o.append('<div class="card"><h3>Token mỗi %s</h3>%s%s</div>' % (per, stack([("Prompt", col("ptok"), "s6"), ("Trả lời", col("ctok"), "s5")], lab, links=dl, marks=marks,
                                                              prev=None if not prev else [x["ptok"] + x["ctok"] for x in prev]), legend([("Prompt (gửi lên)", "s6"), ("Trả lời (sinh ra)", "s5")] + pvl)))
    if any(x["turns_v2"] for x in ser):
        o.append('<div class="card"><h3>Token đi đâu: lời nhắc trung bình một lần gọi</h3><p class="sub">đỉnh lời nhắc của một lần gọi, trung bình mỗi lượt (từ bản ứng dụng có số đo mới)</p>%s</div>' % lines([("Đỉnh lời nhắc (token)", col("peak_prompt_avg"), "s1")], lab, unit=" tok", links=dl))
        o.append('<div class="card"><h3>Số lần gọi mô hình và kết quả công cụ mỗi lượt</h3>%s%s</div>' % (lines([("Lần gọi/lượt", col("calls_per_turn"), "s3"), ("Token kết quả công cụ/lượt ÷ 1000", [None if v is None else v / 1000 for v in col("tool_out_per_turn")], "s4")], lab, links=dl), legend([("Lần gọi mô hình/lượt", "s3"), ("Kết quả công cụ gửi lại/lượt (nghìn token)", "s4")])))
        if any(x["cached_ratio"] for x in ser):
            o.append('<div class="card"><h3>Token lời nhắc dùng lại từ bộ nhớ đệm</h3><p class="sub">%% số token lời nhắc được máy chủ dùng lại (càng cao càng tiết kiệm)</p>%s</div>' % lines([("Bộ nhớ đệm", [None if v is None else 100 * v for v in col("cached_ratio")], "s2")], lab, unit="%", links=dl))
    o.append('<div class="card"><h3>Lệnh gọi mô hình qua nginx</h3><p class="sub">đỏ: lỗi 5xx của cổng mô hình</p>%s</div>' % bars(col("chat"), lab, col("chat_5xx"), links=dl))
    o.append('<div class="card"><h3>Độ trễ cổng mô hình (nginx)</h3><p class="sub">thời gian cả yêu cầu chat thành công, gồm sinh văn bản</p>%s%s</div>' % (lines([("p50", col("chat_p50"), "s1"), ("p95", col("chat_p95"), "s3")], lab, unit=" s", links=dl), legend([("p50", "s1"), ("p95", "s3")])))
    o.append('<div class="card"><h3>Công cụ: số lần gọi và tỷ lệ lỗi</h3>%s%s</div>' % (
        hbars([(x["name"], x["calls"], "%d · lỗi %s%s%s" % (x["calls"], R._p(R.ratio(x["fails"], x["rated"])) if x.get("rated") else "—",
                                                       " (+%d chương trình lỗi)" % x["prog"] if x.get("prog") else "", " (+%d chưa phân loại)" % x["unk"] if x.get("unk") else "")) for x in S["tools"][:12]]),
        '<p class="note">Tỷ lệ lỗi chỉ tính trên các phiên bản ứng dụng đã phân loại lỗi%s.</p>' % (" (không tính %s)" % ", ".join(S["tool_unknown_versions"][:6]) if S.get("tool_unknown_versions") else "")))
    if S.get("tool_errors") or S.get("tool_unknown"):
        unk = S.get("tool_unknown", 0)
        o.append('<div class="card"><h3>Vì sao công cụ thất bại</h3><p class="sub">lý do (mã), %s; "chương trình/test lỗi" là kết quả bình thường%s</p>%s</div>' % (
            lbl, "; %d lỗi từ bản cũ chưa gắn lý do không đưa vào đây" % unk if unk else "", hbars([(ERR_VI.get(nm, nm), v, str(v)) for nm, v in S["tool_errors"].items()], "bad")))
    if S.get("tool_slow"):
        o.append('<div class="card"><h3>Công cụ chạy chậm</h3><p class="sub">tỷ lệ lần gọi mất ≥ 5 giây (công cụ có ≥ 10 lần gọi)</p>%s</div>' % hbars(
            [(x["name"], x["ratio"], "%s · %d/%d lần" % (R._p(x["ratio"]), x["slow"], x["calls"])) for x in S["tool_slow"]], "bad"))
    o.append('<div class="card"><h3>Tín hiệu vấn đề và lỗi gọi mô hình</h3>%s%s</div>' % (hbars([(nm, v, str(v)) for nm, v in list(S["signals"].items())[:10]], "bad"), hbars([("lỗi " + nm, v, str(v)) for nm, v in S["llm_errors"].items()], "bad") if S["llm_errors"] else ""))
    if S.get("signals_by_tool"):
        o.append('<div class="card"><h3>Tín hiệu theo công cụ</h3><p class="sub">tín hiệu nào xảy ra ở công cụ nào</p>%s</div>' % hbars([("%s · %s" % (x["code"], x["tool"]), x["n"], str(x["n"])) for x in S["signals_by_tool"]], "bad"))
    if S.get("llm_status"):
        o.append('<div class="card"><h3>Lỗi gọi mô hình theo mã HTTP</h3>%s</div>' % hbars([("%s · HTTP %d" % (x["kind"], x["status"]), x["n"], str(x["n"])) for x in S["llm_status"]], "bad"))
    if any(x["ctx_n"] for x in ser):
        n_c = sum(x["ctx_n"] for x in ser)
        comp = sum(x["compactions"] for x in ser)
        o.append('<div class="card"><h3>Ngữ cảnh gần đầy</h3><p class="sub">%% lượt có ngữ cảnh ≥ 85%% cửa sổ · %d lần nén ngữ cảnh</p>%s</div>' % (
            comp, lines([("Ngữ cảnh ≥ 85%", [None if v is None else 100 * v for v in col("ctx_hi_ratio")], "s4")], lab, unit="%", links=dl, marks=marks)))
    if any(x["steps_p50"] is not None for x in ser):
        o.append('<div class="card"><h3>Số bước mỗi lượt</h3>%s%s</div>' % (lines([("p50", col("steps_p50"), "s1"), ("p95", col("steps_p95"), "s3")], lab, links=dl, marks=marks), legend([("p50", "s1"), ("p95", "s3")])))
    pa, pdn = sum(x["perm_allow"] for x in ser), sum(x["perm_deny"] for x in ser)
    if pa + pdn:
        o.append('<div class="card"><h3>Hỏi quyền</h3><div class="mini"><div><b>%d</b><span>được cho phép</span></div><div><b>%d</b><span>bị từ chối</span></div><div><b>%s</b><span>tỷ lệ từ chối</span></div></div>'
                 '<p class="note">Tỷ lệ từ chối cao: người dùng thấy yêu cầu quyền khó hiểu hoặc agent đòi quá nhiều quyền.</p></div>' % (pa, pdn, R._p(pdn / (pa + pdn))))
    o.append("</div>")
    q = S.get("quality") or {}

    def qtable(key, head):
        rows_ = q.get(key) or []
        if not rows_:
            return ""
        rt = lambda v, n: R._p(v) if v is not None and n >= 10 else "—"
        pp = lambda a_, b_: "—" if a_ is None else "%.0f / %.0f" % (a_, b_)
        return table([head, "Lượt", "Lỗi", "Lặp / hết bước", "Bị ngắt", "Thời gian p50 / p95 (s)", "Token đầu p50 / p95 (ms)"],
                     [[r_["value"], r_["turns"], rt(r_["error_rate"], r_["turns"]), rt(r_["stop_rate"], r_["turns"]), rt(r_["interrupt_rate"], r_["turns"]), pp(r_["dur_p50"], r_["dur_p95"]), pp(r_["ttft_p50"], r_["ttft_p95"])] for r_ in rows_], "u sortable")
    if q.get("version"):
        o.append('<h3>Chất lượng theo phiên bản ứng dụng</h3><p class="note">Dùng sau mỗi lần phát hành để xem bản mới có tệ hơn không. Tỷ lệ chỉ hiện khi có ≥ 10 lượt.</p>' + qtable("version", "Phiên bản"))
        o.append('<details class="sec"><summary>Chất lượng theo tab, mô hình, nền tảng</summary>%s%s%s</details>' % (
            "<h3>Theo tab</h3>" + qtable("profile", "Tab"), "<h3>Theo mô hình</h3>" + qtable("model", "Mô hình"), "<h3>Theo nền tảng</h3>" + qtable("platform", "Nền tảng")))
    wk = S.get("work") or {}
    if any(wk.get(k) for k in WORK_DIMS):
        names_w = {"kind": ("Loại việc", {"build": "Tạo mới", "edit": "Sửa", "fix": "Sửa lỗi", "explain": "Giải thích", "research": "Tìm hiểu/so sánh", "convert": "Chuyển đổi", "other": "Khác"}),
                   "art": ("Sản phẩm chính", {"web": "Web (html/css/js)", "python": "Python", "word": "Word", "excel": "Excel", "slides": "PowerPoint", "pdf": "PDF", "text": "Văn bản", "data": "Dữ liệu", "image": "Ảnh", "other": "Khác"}),
                   "stack": ("Bộ khung dự án (tab Code)", {}), "ui": ("Thư viện giao diện", {}), "nth": ("Lượt thứ mấy của cuộc trò chuyện", {})}
        o.append('<h3>Công việc người dùng làm</h3><p class="note">Ứng dụng tự phân loại ngay trên máy người dùng và chỉ gửi MÃ (loại việc, sản phẩm, bộ khung…), không có nội dung. '
                 '«Nói chưa đạt» = người dùng nhắn lại rằng kết quả chưa đúng; «Kiểm chứng hỏng» = lần dựng/kiểm thử/check_page cuối của lượt không qua. Chỉ hiện tỷ lệ khi có ≥ 5 lượt.</p>')
        for k in WORK_DIMS:
            rows_ = wk.get(k) or []
            if not rows_:
                continue
            head, vi = names_w[k]
            rt = lambda v, n: R._p(v) if v is not None and n >= 5 else "—"
            o.append("<h4>%s</h4>" % _e(head) + table([head, "Lượt", "Xong tốt", "Lỗi/lặp", "Bị ngắt", "Nói chưa đạt", "Kiểm chứng hỏng", "Bước p50", "Token TB"],
                     [[vi.get(r_["value"], r_["value"]), r_["turns"], rt(r_["ok_rate"], r_["turns"]), rt(r_["bad_rate"], r_["turns"]), rt(r_["interrupt_rate"], r_["turns"]), rt(r_["redo_rate"], r_["turns"]),
                       "—" if not r_["verify_n"] else "%s (%d)" % (R._p(r_["verify_fail_rate"]), r_["verify_n"]), "—" if r_["steps_p50"] is None else "%.0f" % r_["steps_p50"], "—" if r_["tok_avg"] is None else "{:,}".format(r_["tok_avg"])] for r_ in rows_]))
    if S.get("tool_reasons"):
        o.append("<h3>Công cụ × lý do lỗi</h3>" + table(["Công cụ", "Lỗi có mã", "Lý do hàng đầu"], [[nm, sum(rs.values()), ", ".join("%s %d" % (ERR_VI.get(c, c), n_) for c, n_ in rs.items())] for nm, rs in S["tool_reasons"].items()], "u sortable"))
    if S["findings"]:
        o.append("<h3>Phát hiện từ báo cáo chất lượng hôm nay</h3>" + table(["Mức", "Vấn đề", "Bằng chứng"], [[f["sev"], f["title"], f["evidence"]] for f in S["findings"][:8]]))

    # ---- cách sử dụng
    o.append('<h2 id="su-dung">Cách sử dụng <small>%s</small></h2><div class="grid">' % _e(rg["long"]))
    names = {"profile": "Tab (Work/Code/Design)", "platform": "Nền tảng", "version": "Phiên bản", "model": "Mô hình"}
    for key in ("profile", "platform", "version", "model"):
        o.append('<div class="card"><h3>%s</h3><p class="sub">số người dùng · lượt</p>%s</div>' % (names[key], hbars([(x["value"], x["users"], "%d người · %d lượt" % (x["users"], x["turns"])) for x in S["dist"][key]])))
    rl = S.get("release")
    if rl:
        o.append('<div class="card"><h3>Phát hành &amp; cập nhật</h3><p class="sub">tệp latest.json đang phục vụ</p><div class="mini"><div><b>%s</b><span>bản đang phát hành%s</span></div><div><b>%s</b><span>đã dùng bản này</span></div><div><b>%s</b><span>phiên bản tối thiểu%s</span></div></div>%s</div>'
                 % (_e(rl["version"]), " · " + _e(rl["released"]) if rl.get("released") else "", "—" if rl["adoption"] is None else R._p(rl["adoption"]), _e(rl["min"] or "chưa đặt"), " · %d người dưới mức" % rl["below_min"] if rl.get("below_min") else "",
                    '<p class="note" style="white-space:pre-wrap">%s</p>' % _e(rl["notes"]) if rl.get("notes") else ""))
    ui = S.get("ui") or {}
    o.append('<div class="card"><h3>Tính năng được dùng <small>số lần bấm, %s</small></h3><p class="sub">chỉ từ bản ứng dụng có ghi nhận; không có nội dung</p>%s%s</div>' % (
        lbl,
        hbars([(UI_VI.get(k, k), v, str(v)) for k, v in list(ui.items())[:14]]) if ui else '<p class="note">Chưa có dữ liệu (cần người dùng cập nhật bản mới).</p>',
        '<p class="note">Chưa ai dùng: %s</p>' % _e(", ".join(UI_VI[k] for k in UI_VI if k not in ui and k not in ("update_banner", "update_download", "mention_file"))) if ui else ""))
    fbk = S.get("feedback") or {}
    if fbk.get("up") or fbk.get("down"):
        tot = fbk["up"] + fbk["down"]
        o.append('<div class="card"><h3>Phản hồi của người dùng <small>%s</small></h3><div class="mini"><div><b>👍 %d</b><span>có ích</span></div><div><b>👎 %d</b><span>chưa tốt</span></div><div><b>%s</b><span>hài lòng</span></div></div>%s</div>' % (
            lbl, fbk["up"], fbk["down"], R._p(fbk["up"] / tot), hbars([(FB_VI.get(k, k), v, str(v)) for k, v in sorted(fbk["reasons"].items(), key=lambda kv: -kv[1])], "bad") if fbk["reasons"] else ""))
    o.append('<div class="card"><h3>Bản đồ nhiệt: lượt theo thứ và giờ</h3><p class="sub">giờ Việt Nam; càng đậm càng nhiều lượt</p>%s</div>' % heatmap(S["heat"]))
    o.append('<div class="card"><h3>Lượt làm việc theo giờ trong ngày</h3>%s</div>' % stack([("Lượt", S["hours"], "s1")], ["%02d:00" % h for h in range(24)], trim=0))
    o.append('<div class="card"><h3>Tải bản cài mỗi %s</h3>%s</div>' % (per, stack([("Lượt tải", col("pkg"), "s2")], lab)))
    o.append('<div class="card"><h3>Desktop kiểm tra cập nhật mỗi %s</h3><p class="sub">xấp xỉ số lần máy Desktop mở và kiểm tra</p>%s</div>' % (per, stack([("Kiểm tra", col("update_check"), "s6")], lab)))
    o.append('</div><p class="note">%s</p>' % _e(nginx_note))

    # ---- hạn mức token
    o.append('<h2 id="han-muc">Hạn mức token <small>mỗi người một hạn mức/ngày, làm mới 00:00 giờ VN</small></h2>')
    cc = S.get("concentration")
    if cc and cc["users"] >= 5:
        o.append('<p class="note">Mức tập trung (token do ứng dụng báo, %s): <b>%d người dùng nhiều nhất</b> (10%% trong %d người) chiếm <b>%s</b> tổng token; người dùng nhiều nhất một mình chiếm %s.</p>' % (_e(lbl), cc["top_n"], cc["users"], R._p(cc["top_share"]), R._p(cc["top1"])))
    qt = S.get("quota")
    if not qt:
        o.append('<p class="note">Chưa có dữ liệu hạn mức: cổng hạn mức (deploy/220/quota) chưa cài hoặc chưa có yêu cầu nào đi qua. Xem docs/QUOTA.md.</p>')
    else:
        qs = qt["series"]
        ql = [x["day"] for x in qs]
        if hourly:
            o.append('<p class="note">Cổng hạn mức chỉ đếm theo ngày, nên biểu đồ ở đây luôn là %d ngày gần nhất.</p>' % len(qs))
        o.append('<div class="mini">' + "".join("<div><b>%s</b><span>%s</span></div>" % (_e(a), _e(b)) for a, b in [
            (qt["users_today"], "người đã dùng hôm nay"), ("%.2f triệu" % (qt["tokens_today"] / 1e6), "token hôm nay (đã tính)"), (qt["near"], "người đã dùng 80–99% hạn mức"), (qt["over"], "người đã chạm hạn mức"),
            (qt["blocked_users"], "người bị chặn hôm nay"), (qt["blocked_requests"], "yêu cầu bị từ chối hôm nay")]) + "</div>")
        o.append('<div class="grid">')
        if qt.get("pct_hist") and qt["users_today"]:
            o.append('<div class="card"><h3>Mức dùng so với hạn mức hôm nay</h3><p class="sub">số người theo %% hạn mức đã dùng</p>%s</div>' % hbars([(nm, v, "%d người" % v) for nm, v in qt["pct_hist"]]))
        o.append('<div class="card"><h3>Token mỗi ngày (cổng hạn mức đếm)</h3><p class="sub">triệu token; số do máy chủ đếm, chính xác hơn số ứng dụng tự báo</p>%s</div>' % stack([("Triệu token", [round(x["tokens"] / 1e6, 3) for x in qs], "s6")], ql))
        o.append('<div class="card"><h3>Người dùng gần/hết hạn mức mỗi ngày</h3><p class="sub">đỏ: số yêu cầu bị từ chối</p>%s</div>' % bars([x["near"] for x in qs], ql, [x["blocked"] for x in qs]))
        tiers = qt["tiers"]
        o.append('<div class="card"><h3>Theo bậc (hôm nay)</h3>%s</div>' % table(["Bậc", "Người", "Token"], [[k, v["users"], format(v["tokens"], ",").replace(",", ".")] for k, v in sorted(tiers.items())] or [["—", 0, 0]]))
        o.append("</div>")
        hot = [u for u in qt["users"] if (u["pct"] or 0) >= 50 or u["blocked"]][:15]
        o.append("<h3>Người dùng đang dùng nhiều hạn mức hôm nay <small>(từ 50% trở lên; mã giả danh)</small></h3>")
        o.append(table(["Mã", "Bậc", "Token", "Hạn mức", "Đã dùng", "Yêu cầu", "Bị chặn"], [[u["id"], u["tier"], format(u["tokens"], ",").replace(",", "."), "không giới hạn" if u["limit"] is None else format(u["limit"], ",").replace(",", "."),
                                                                                              "—" if u["pct"] is None else "%s%%" % u["pct"], u["requests"], u["blocked"]] for u in hot] or [["—", "", "", "", "", "", ""]]))
        o.append('<p class="note"><a href="quota">Xem ai đã hết hạn mức và cấp thêm cho hôm nay →</a></p>')
        o.append('<p class="note">Đổi hạn mức trên máy 220: <code>sudo ~/neu-agent-220/quota/quota.sh show | mode | tier | set</code>. Mặc định sinh viên 5 triệu, giảng viên 10 triệu token/ngày; vượt thêm 10%% để hoàn tất việc đang làm. Tra mã ứng với ai: <code>quota.sh uid &lt;email&gt;</code>.</p>')

    # ---- người dùng
    o.append('<h2 id="nguoi-dung">Người dùng <small>%d người đứng đầu theo số lượt %s · bấm mã để xem chi tiết từng người</small></h2>' % (S["users_listed"], lbl))
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
    o.append(table(["Trạng thái", "Mã", "%d ngày qua" % SPARK_DAYS, "Lần đầu", "Gần nhất (VN)", "Ngày dùng", "Lượt " + lbl, "Tổng lượt", "Lỗi", "Tab chính", "Nền tảng", "Phiên bản", "Mô hình"], rows, "u sortable", raw=(0, 1, 2), row_cls=rc))
    o.append("</div>")
    o.append('<p class="note">Mã = 8 ký tự đầu của HMAC(bí mật máy chủ, email). Tra mã ứng với ai: <code>sudo ~/neu-agent-220/quota/quota.sh uid &lt;email&gt;</code> trên máy 220. Trang này không lưu và không hiển thị email. Xem tất cả người dùng và tải CSV ở <a href="data.html">Dữ liệu &amp; CSV</a>.</p>')

    # ---- báo lỗi do người dùng gửi
    if info["reports"]:
        o.append('<h2 id="bao-loi">Báo lỗi do người dùng gửi <small>ghi chú tự gõ khi bấm "Báo lỗi"</small></h2>')
        o.append(pages_reports(info["reports"][:15]))

    # ---- hệ thống & dữ liệu
    o.append('<h2 id="he-thong">Hệ thống &amp; dữ liệu</h2><div class="grid">')
    if checks:
        o.append('<div class="card"><h3>Kiểm tra sức khoẻ (5 phút/lần)</h3>%s</div>' % table(["Thành phần", "Tình trạng", "ms", "Chi tiết"], [[nm, ("⚠ cảnh báo" if v.get("warn") else "✓ tốt") if v["ok"] else "✗ lỗi", v["ms"] if v["ms"] is not None else "—", v["detail"]] for nm, v in checks.items()]))
    if sysinfo:
        fresh = sysinfo["newest_event_age_s"]
        o.append('<div class="card"><h3>Dữ liệu chẩn đoán</h3>%s</div>' % table(["Chỉ số", "Giá trị"], [
            ["Sự kiện mới nhất", "chưa có" if fresh is None else ("%d phút trước" % (fresh // 60) if fresh >= 120 else "%d giây trước" % fresh)], ["Số tệp ngày / từ ngày", "%d / %s" % (sysinfo["diag_files"], sysinfo["diag_oldest"] or "—")],
            ["Dung lượng chẩn đoán", _mb(sysinfo["diag_bytes"])], ["Dung lượng báo cáo và trang quản trị", _mb(sysinfo["reports_bytes"])], ["Thời hạn giữ", "%d ngày (xoá tự động)" % HIST_DAYS]]))
    o.append("</div>")
    nd = ser[-24:] if hourly else ser[-7:]
    st_rows = []
    for x in reversed(nd):
        cs, ds = x.get("chat_st") or {}, x.get("diag_st") or {}
        if not cs and not ds and not x["chat"]:
            continue
        st_rows.append([x["day"], x["chat"], ", ".join("%s: %d" % kv for kv in sorted(cs.items())) or "—", "—" if x["chat_p50"] is None else "%.1f / %.1f s" % (x["chat_p50"], x["chat_p95"]), x.get("diag", 0), ", ".join("%s: %d" % kv for kv in sorted(ds.items())) or "—"])
    if st_rows:
        o.append("<h3>Cổng mô hình và nhận chẩn đoán (nginx, %s)</h3>" % ("24 giờ gần nhất" if hourly else "7 ngày") + table(["Giờ" if hourly else "Ngày", "Lệnh chat", "Mã trạng thái", "p50 / p95", "Gói chẩn đoán", "Mã trạng thái"], st_rows))
    if report_links:
        o.append("<h2>Báo cáo chất lượng các ngày trước</h2><p>" + " · ".join('<a href="%s">%s</a>' % (_e(x), _e(x[:-5])) for x in report_links) + "</p>")
    o.append('</main><script src="admin.js" defer></script></body></html>')
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
    hourly = nginx_daily([r for r in rows if r["_ts"] >= t - 7 * 86400], vn_hour)      # 1d/3d (và kỳ trước của chúng) chia theo giờ; nhật ký nginx giữ 14 ngày là đủ
    quota_fn = (lambda n: read_quota(quota_db, now, n)) if quota_db else None
    allS = compute_all(recs, daily, now, read_findings(out), read_release(dl_dir) if dl_dir else None, quota_fn, hourly)
    S = allS[DEFAULT_RANGE]
    first = S["daily_first"]
    note = "Số liệu nginx (lệnh gọi mô hình, tải bản cài, kiểm tra cập nhật) được cộng dồn theo ngày từ %s; nhật ký gốc chỉ giữ 14 ngày. Ngày trước mốc đó hiện bằng 0. Lượt tải đếm yêu cầu HTTP 200 tới tệp .dmg/.exe (tải lại hoặc tiếp tục tải có thể tính thêm)." % (first or "lần chạy đầu")
    links = sorted((os.path.basename(p) for p in glob.glob(os.path.join(out, "????-??-??.html"))), reverse=True)[:30]
    write_atomic(dpath, json.dumps(daily, ensure_ascii=False, indent=1))
    info = P.write_all(out, S, recs, quota_db, t, write_atomic)          # trang từng người, từng ngày, dữ liệu đầy đủ, CSV
    coh, sysinfo = cohort_table(info["U"], t), system_info(diag_dir, recs, out, t)
    d1 = allS["1d"]["series"] if "1d" in allS else []
    S["cohorts"], S["system"] = coh, sysinfo
    S["recent"] = {"chat_24h": sum(x["chat"] for x in d1), "chat_5xx_24h": sum(x["chat_5xx"] for x in d1), "turns_24h": sum(x["turns"] for x in d1), "errors_24h": sum(x["errors"] for x in d1)}
    write_atomic(os.path.join(out, "stats.json"), json.dumps(S, ensure_ascii=False, indent=1, default=str))
    health = read_health(health_file, t)
    for key, Sr in allS.items():
        write_atomic(os.path.join(out, range_page(key)), render(Sr, health, links, note, info, sysinfo, coh))
        write_atomic(os.path.join(out, "series-%s.csv" % key), P.daily_csv(Sr, "gio_vn" if Sr["range"]["hourly"] else "ngay"))
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
