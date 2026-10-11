"""Trang chi tiết cho quản trị (do stats.py gọi): từng người dùng (u-<mã>.html), từng ngày (d-<ngày>.html), bảng dữ liệu đầy đủ (data.html) và CSV.

Mọi trang là tệp tĩnh (SVG + CSS, không script) cùng thư mục với index.html, chỉ quản trị viên xem được (collector.py /admin/). Người dùng chỉ là MÃ GIẢ DANH.
Không có nội dung hội thoại; ngoại lệ duy nhất là ghi chú "Báo lỗi" mà chính người dùng gõ và tự bấm gửi (đã escape HTML).
"""
import collections
import csv
import datetime
import glob
import io
import os

import charts as C
import report as R
from charts import _e, bars, hbars, heatmap, legend, lines, stack, table

TZ = R.TZ
OUTCOMES = ("ok", "interrupted", "error", "step_limit", "loop")
OUTCOME_VI = {"ok": "Thành công", "interrupted": "Bị ngắt", "error": "Lỗi", "step_limit": "Chạm giới hạn bước", "loop": "Lặp"}
OUT_CLS = ("s2", "s3", "s4", "s5", "s6")
NOT_TOOL_FAULT = ("program", "denied")
ERR_VI = {"not_found": "Không có file/thư mục", "outside_project": "Đường dẫn ngoài dự án", "read_first": "Sửa trước khi đọc", "stale": "File đã đổi sau khi đọc", "binary": "File nhị phân", "bad_args": "Thiếu/sai tham số",
          "no_match": "Không tìm thấy đoạn cần sửa", "ambiguous": "Đoạn cần sửa không duy nhất", "wrong_type": "Nhầm file/thư mục", "sandbox": "Dùng thứ sandbox không có", "program": "Chương trình/test của người dùng lỗi (bình thường)",
          "timeout": "Quá thời gian", "unsupported": "Không hỗ trợ", "denied": "Bị từ chối quyền", "hook": "Bị hook chặn", "unknown_tool": "Công cụ không tồn tại", "bad_json": "Tham số không phải JSON", "internal": "Lỗi nội bộ", "other": "Khác", "unknown": "Chưa rõ (bản cũ)"}
MAX_USER_PAGES = 400


def _day(ts):
    return datetime.datetime.fromtimestamp(ts, TZ).date().isoformat()


def _vn(ts, fmt="%Y-%m-%d %H:%M"):
    return datetime.datetime.fromtimestamp(ts, TZ).strftime(fmt)


def _p(x):
    return "%.1f%%" % (100 * x)


def _num(n):
    return format(int(n), ",").replace(",", ".")


# ---------------------------------------------------------------- thu thập một lượt qua dữ liệu
def collect(recs, t, days=30):
    """Gom theo người dùng, theo ngày và danh sách báo lỗi. recs: bản ghi chẩn đoán đã lọc theo thời gian."""
    t30 = t - days * 86400
    U = {}
    D = {}
    reports = []

    def new_u():
        return {"first": 1 << 60, "last": 0, "days": collections.Counter(), "out": collections.Counter(), "tools": collections.defaultdict(lambda: {"calls": 0, "fails": 0, "prog": 0, "errs": collections.Counter()}),
                "hours": [0] * 24, "sigs": collections.Counter(), "llm": collections.Counter(), "ver": collections.Counter(), "plat": collections.Counter(), "prof": collections.Counter(), "model": collections.Counter(),
                "ptok": collections.Counter(), "ctok": collections.Counter(), "turns": [], "reports": [], "turns_n": 0, "errors_n": 0}

    def new_d():
        return {"users": [set() for _ in range(24)], "turns": [0] * 24, "errors": [0] * 24, "ptok": [0] * 24, "ctok": [0] * 24, "out": collections.Counter(), "tools": collections.defaultdict(lambda: {"calls": 0, "fails": 0, "prog": 0}),
                "errs": collections.Counter(), "sigs": collections.Counter(), "llm": collections.Counter(), "by_user": collections.Counter(), "dur": [], "ttft": [], "all_users": set(), "tool_calls": 0}

    for r in recs:
        ts, uid, a, e = r["ts_srv"], r.get("uid") or "?", r.get("a") or {}, r["e"]
        et = e.get("t")
        dt = datetime.datetime.fromtimestamp(ts, TZ)
        day, hr = dt.date().isoformat(), dt.hour
        u = U.setdefault(uid, new_u())
        u["first"], u["last"] = min(u["first"], ts), max(u["last"], ts)
        d = D.setdefault(day, new_d()) if ts >= t30 else None
        if d is not None:
            d["users"][hr].add(uid)
            d["all_users"].add(uid)
        if et == "turn":
            end = e.get("end", "?")
            u["turns_n"] += 1
            u["errors_n"] += end == "error"
            u["days"][day] += 1
            u["out"][end] += 1
            u["hours"][hr] += 1 if ts >= t30 else 0
            for key, bucket in (("version", "ver"), ("platform", "plat"), ("profile", "prof"), ("model", "model")):
                u[bucket][str(a.get(key, "?"))] += 1
            u["ptok"][day] += e.get("prompt_tok", 0)
            u["ctok"][day] += e.get("completion_tok", 0)
            u["turns"].append((ts, end, e.get("dur_s"), e.get("ttft_ms"), e.get("steps"), e.get("tools"), e.get("prompt_tok", 0) + e.get("completion_tok", 0), e.get("ctx_pct")))
            if len(u["turns"]) > 400:
                u["turns"] = u["turns"][-200:]
            if d is not None:
                d["turns"][hr] += 1
                d["errors"][hr] += end == "error"
                d["ptok"][hr] += e.get("prompt_tok", 0)
                d["ctok"][hr] += e.get("completion_tok", 0)
                d["out"][end] += 1
                d["by_user"][uid] += 1
                if "dur_s" in e:
                    d["dur"].append(e["dur_s"])
                if "ttft_ms" in e:
                    d["ttft"].append(e["ttft_ms"])
        elif et == "tool":
            nm = e.get("name", "other")
            failed = e.get("ok") is False
            real = failed and e.get("err") not in NOT_TOOL_FAULT
            x = u["tools"][nm]
            x["calls"] += 1
            x["fails"] += real
            x["prog"] += failed and not real
            if failed:
                x["errs"][e.get("err") or "unknown"] += 1
            if d is not None:
                y = d["tools"][nm]
                y["calls"] += 1
                y["fails"] += real
                y["prog"] += failed and not real
                d["tool_calls"] += 1
                if failed:
                    d["errs"][e.get("err") or "unknown"] += 1
        elif et == "signal":
            u["sigs"][e.get("code", "?")] += 1
            if d is not None:
                d["sigs"][e.get("code", "?")] += 1
        elif et == "llm_error":
            u["llm"][e.get("kind", "?")] += 1
            if d is not None:
                d["llm"][e.get("kind", "?")] += 1
        elif et == "report":
            note = str(e.get("note", ""))[:500]
            rep = {"ts": ts, "uid": uid, "note": note, "version": str(a.get("version", "")), "platform": str(a.get("platform", "")), "profile": str(a.get("profile", ""))}
            reports.append(rep)
            u["reports"].append(rep)
    reports.sort(key=lambda x: -x["ts"])
    return U, D, reports


def read_quota_users(db_path, days=30):
    """{uid_đầy_đủ: {"tier","limit","today","by_day":{ngày: token},"blocked"}} từ CSDL của cổng hạn mức; {} nếu chưa có."""
    import sqlite3
    out = {}
    try:
        db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True, timeout=3)
    except sqlite3.Error:
        return out
    try:
        since = _day(datetime.datetime.now(TZ).timestamp() - days * 86400)
        for day, uid, tier, lim, tokens, req, blocked in db.execute("SELECT day,uid,tier,lim,tokens,requests,blocked FROM usage WHERE day>=?", (since,)):
            x = out.setdefault(uid, {"tier": tier, "limit": None if lim < 0 else lim, "by_day": {}, "blocked": 0, "requests": 0})
            x["by_day"][day] = x["by_day"].get(day, 0) + tokens
            x["blocked"] += blocked
            x["requests"] += req
            x["tier"], x["limit"] = tier, (None if lim < 0 else lim)
    except sqlite3.Error:
        pass
    finally:
        db.close()
    return out


# ---------------------------------------------------------------- tiện ích hiển thị
def shell(title, body, back="index.html", back_label="← Tổng quan", extra_nav=""):
    return ('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title><style>%s</style></head><body><main>'
            '<nav class="top"><b>Hando</b><a href="%s">%s</a>%s<span style="flex:1"></span><a href="data.html">Dữ liệu &amp; CSV</a></nav>%s</main></body></html>' % (_e(title), C.CSS, _e(back), _e(back_label), extra_nav, body))


def tool_rows(tools):
    rows = []
    for nm, x in sorted(tools.items(), key=lambda kv: -kv[1]["calls"]):
        errs = ", ".join("%s %d" % (ERR_VI.get(k, k), v) for k, v in x.get("errs", collections.Counter()).most_common(3)) if "errs" in x else ""
        rows.append([nm, x["calls"], x["fails"], _p(R.ratio(x["fails"], x["calls"])), x["prog"], errs])
    return rows


def kpi(pairs):
    return '<div class="mini">' + "".join("<div><b>%s</b><span>%s</span></div>" % (_e(a), _e(b)) for a, b in pairs) + "</div>"


def counter_bars(cnt, labels=None, cls=""):
    return hbars([((labels or {}).get(k, k), v, str(v)) for k, v in cnt.most_common(12)], cls)


# ---------------------------------------------------------------- trang một người dùng
def user_page(uid, pid, u, qu, days, tierinfo, now_ts):
    lab = days
    # kết quả từng lượt theo ngày: tính từ danh sách lượt gần đây (đủ cho 30 ngày với người dùng bình thường)
    per_day = collections.defaultdict(collections.Counter)
    for ts, end, *_ in u["turns"]:
        per_day[_day(ts)][end] += 1
    out_series = [(OUTCOME_VI[k], [per_day[d].get(k, 0) for d in lab], c) for k, c in zip(OUTCOMES, OUT_CLS)]
    dlinks = ["d-%s.html" % d for d in lab]
    st = "mới" if u["first"] >= now_ts - 7 * 86400 else ("hoạt động" if u["last"] >= now_ts - 7 * 86400 else "ngủ đông")
    body = ['<h1>Người dùng <code>%s</code></h1><p class="sub">Mã giả danh (không có email hay nội dung hội thoại).%s Trạng thái <b>%s</b>.</p>' % (_e(pid), (" Bậc %s ·" % _e(qu["tier"])) if qu else "", _e(st))]
    qt = _num(sum((qu or {}).get("by_day", {}).values())) if qu else "—"
    body.append(kpi([(_vn(u["first"], "%Y-%m-%d"), "lần đầu"), (_vn(u["last"]), "gần nhất (giờ VN)"), (len(u["days"]), "ngày đã dùng"), (u["turns_n"], "lượt làm việc"), (_p(R.ratio(u["errors_n"], u["turns_n"])) if u["turns_n"] else "—", "tỷ lệ lượt lỗi"),
                     (qt, "token 30 ngày (cổng đếm)"), ("—" if not qu else _num(qu["by_day"].get(days[-1], 0)), "token hôm nay"), ("—" if not qu else (qu["blocked"]), "lần bị chặn (hết hạn mức)")]))
    body.append('<h2>Hoạt động 30 ngày</h2><div class="grid">')
    body.append('<div class="card"><h3>Lượt làm việc mỗi ngày</h3><p class="sub">bấm một cột để xem ngày đó</p>%s%s</div>' % (stack(out_series, lab, links=dlinks), legend([(n, c) for n, _, c in out_series])))
    body.append('<div class="card"><h3>Token mỗi ngày (ứng dụng báo)</h3>%s%s</div>' % (stack([("Prompt", [u["ptok"].get(d, 0) for d in lab], "s6"), ("Trả lời", [u["ctok"].get(d, 0) for d in lab], "s5")], lab, links=dlinks), legend([("Prompt", "s6"), ("Trả lời", "s5")])))
    if qu:
        body.append('<div class="card"><h3>Token mỗi ngày (cổng hạn mức đếm)</h3><p class="sub">hạn mức: %s token/ngày</p>%s</div>' % ("không giới hạn" if qu["limit"] is None else _num(qu["limit"]), stack([("Token", [qu["by_day"].get(d, 0) for d in lab], "s1")], lab, links=dlinks)))
    body.append('<div class="card"><h3>Lượt theo giờ trong ngày (giờ VN)</h3>%s</div>' % stack([("Lượt", u["hours"], "s1")], ["%02d:00" % h for h in range(24)], trim=0))
    body.append("</div>")
    body.append('<h2>Cách dùng</h2><div class="grid">')
    for title, key in (("Tab", "prof"), ("Nền tảng", "plat"), ("Phiên bản", "ver"), ("Mô hình", "model")):
        body.append('<div class="card"><h3>%s</h3>%s</div>' % (title, counter_bars(u[key])))
    body.append("</div>")
    body.append("<h2>Công cụ</h2>" + table(["Công cụ", "Gọi", "Lỗi thật", "Tỷ lệ lỗi", "Chương trình lỗi", "Lý do lỗi chính"], tool_rows(u["tools"]) or [["—", 0, 0, "—", 0, ""]]))
    if u["sigs"] or u["llm"]:
        body.append('<h2>Tín hiệu vấn đề</h2><div class="grid"><div class="card"><h3>Tín hiệu</h3>%s</div><div class="card"><h3>Lỗi gọi mô hình</h3>%s</div></div>' % (counter_bars(u["sigs"], cls="bad"), counter_bars(u["llm"], cls="bad")))
    rows = []
    for ts, end, dur, ttft, steps, tools, tok, ctx in sorted(u["turns"], reverse=True)[:30]:
        rows.append([_vn(ts, "%m-%d %H:%M"), OUTCOME_VI.get(end, end), "—" if dur is None else "%ds" % dur, "—" if ttft is None else "%dms" % ttft, "—" if steps is None else steps, "—" if tools is None else tools, _num(tok), "—" if ctx is None else "%d%%" % ctx])
    body.append("<h2>30 lượt gần nhất</h2>" + table(["Lúc (VN)", "Kết quả", "Thời gian", "Token đầu", "Bước", "Công cụ", "Token", "Ngữ cảnh"], rows or [["—"] * 8]))
    if u["reports"]:
        body.append("<h2>Báo lỗi do người này gửi</h2>" + reports_table(u["reports"][:10]))
    return shell("Người dùng " + pid, "".join(body))


def reports_table(reps):
    rows = [[_vn(r["ts"]), r["uid"][:8], "%s · %s · %s" % (r["version"], r["platform"], r["profile"]), r["note"] or "(không có ghi chú)"] for r in reps]
    return '<p class="note">Ghi chú do chính người dùng gõ khi bấm “Báo lỗi” (đã xem trước trước khi gửi). Không chứa nội dung hội thoại tự động.</p>' + table(["Lúc (VN)", "Mã", "Phiên bản · nền tảng · tab", "Ghi chú"], rows)


# ---------------------------------------------------------------- trang một ngày
def day_page(day, d, pids, quota_day, reports, prev_day, next_day, new_users):
    hours = ["%02d:00" % h for h in range(24)]
    turns = sum(d["turns"])
    errs = sum(d["errors"])
    ptok, ctok = sum(d["ptok"]), sum(d["ctok"])
    body = ['<h1>Ngày %s</h1><p class="sub">%s · giờ Việt Nam.</p>' % (_e(day), " · ".join(x for x in ['<a href="d-%s.html">← %s</a>' % (prev_day, prev_day) if prev_day else "", '<a href="d-%s.html">%s →</a>' % (next_day, next_day) if next_day else ""] if x))]
    body.append(kpi([(len(d["all_users"]), "người dùng"), (new_users, "người dùng mới"), (turns, "lượt làm việc"), (_p(R.ratio(errs, turns)) if turns else "—", "lượt lỗi"), (_num(ptok + ctok), "token (ứng dụng báo)"),
                     ("—" if quota_day is None else _num(quota_day), "token (cổng đếm)"), (d["tool_calls"], "lần gọi công cụ"), ("—" if not d["dur"] else "%.0f s" % R.pct(d["dur"], 50), "thời gian một lượt p50"),
                     ("—" if not d["dur"] else "%.0f s" % R.pct(d["dur"], 95), "p95"), ("—" if not d["ttft"] else "%.0f ms" % R.pct(d["ttft"], 95), "token đầu p95")]))
    body.append('<h2>Theo giờ</h2><div class="grid">')
    body.append('<div class="card"><h3>Lượt làm việc theo giờ (đỏ: lỗi)</h3>%s</div>' % bars(d["turns"], hours, d["errors"], trim=0))
    body.append('<div class="card"><h3>Người dùng hoạt động theo giờ</h3>%s</div>' % bars([len(s) for s in d["users"]], hours, trim=0))
    body.append('<div class="card"><h3>Token theo giờ</h3>%s%s</div>' % (stack([("Prompt", d["ptok"], "s6"), ("Trả lời", d["ctok"], "s5")], hours, trim=0), legend([("Prompt", "s6"), ("Trả lời", "s5")])))
    body.append('<div class="card"><h3>Kết quả các lượt</h3>%s</div>' % hbars([(OUTCOME_VI.get(k, k), v, "%d · %s" % (v, _p(R.ratio(v, turns)))) for k, v in d["out"].most_common()]))
    body.append("</div>")
    body.append("<h2>Công cụ</h2>" + table(["Công cụ", "Gọi", "Lỗi thật", "Tỷ lệ lỗi", "Chương trình lỗi"], [r[:5] for r in tool_rows(d["tools"])] or [["—", 0, 0, "—", 0]]))
    body.append('<div class="grid" style="margin-top:14px"><div class="card"><h3>Vì sao công cụ thất bại</h3>%s</div><div class="card"><h3>Tín hiệu vấn đề</h3>%s</div><div class="card"><h3>Lỗi gọi mô hình</h3>%s</div></div>' % (
        hbars([(ERR_VI.get(k, k), v, str(v)) for k, v in d["errs"].most_common(10)], "bad"), counter_bars(d["sigs"], cls="bad"), counter_bars(d["llm"], cls="bad")))
    rows = []
    for uid, n in d["by_user"].most_common(20):
        pid = pids.get(uid)
        rows.append(['<a href="u-%s.html"><code>%s</code></a>' % (_e(pid), _e(pid)) if pid else "<code>%s</code>" % _e(uid[:8]), n])
    body.append("<h2>Người dùng nhiều lượt nhất trong ngày</h2>" + table(["Mã", "Lượt"], rows or [["—", 0]], raw=(0,)))
    drep = [r for r in reports if _day(r["ts"]) == day]
    if drep:
        body.append("<h2>Báo lỗi trong ngày</h2>" + reports_table(drep[:20]))
    return shell("Ngày " + day, "".join(body))


# ---------------------------------------------------------------- CSV
def _csv(header, rows):
    b = io.StringIO()
    w = csv.writer(b, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    return "﻿" + b.getvalue()  # BOM để Excel đọc đúng tiếng Việt


def users_csv(S, U, pids, quota):
    rows = []
    for uid, u in sorted(U.items(), key=lambda kv: -kv[1]["turns_n"]):
        q = quota.get(uid) or {}
        top = lambda c: (c.most_common(1) or [("", 0)])[0][0]
        rows.append([pids.get(uid, uid[:8]), q.get("tier", ""), _vn(u["first"], "%Y-%m-%d"), _vn(u["last"]), len(u["days"]), u["turns_n"], u["errors_n"], top(u["prof"]), top(u["plat"]), top(u["ver"]), top(u["model"]),
                     sum(q.get("by_day", {}).values()) if q else "", "" if q.get("limit") is None else q.get("limit", ""), q.get("blocked", "")])
    return _csv(["ma", "bac", "lan_dau", "gan_nhat_vn", "so_ngay_dung", "luot", "luot_loi", "tab_chinh", "nen_tang", "phien_ban", "mo_hinh", "token_30_ngay", "han_muc_ngay", "bi_chan"], rows)


def daily_csv(S):
    rows = [[x["day"], x["users"], x["new"], x["installs"], x["turns"], x["errors"], "" if x["error_rate"] is None else round(x["error_rate"], 4), x["dur_p50"] or "", x["dur_p95"] or "", x["ttft_p50"] or "", x["ttft_p95"] or "", x["ptok"], x["ctok"],
             x["tool_calls"], x["tool_fails"], x["signals"], x["llm_errors"], x["chat"], x["chat_5xx"], x["pkg"], x["update_check"]] for x in S["series"]]
    return _csv(["ngay", "nguoi_dung", "nguoi_dung_moi", "may", "luot", "luot_loi", "ty_le_loi", "thoi_gian_p50_s", "thoi_gian_p95_s", "token_dau_p50_ms", "token_dau_p95_ms", "token_prompt", "token_tra_loi", "goi_cong_cu", "cong_cu_loi", "tin_hieu", "loi_mo_hinh", "goi_mo_hinh_nginx", "5xx", "tai_ban_cai", "kiem_tra_cap_nhat"], rows)


def tools_csv(S):
    return _csv(["cong_cu", "goi", "loi_that", "chuong_trinh_loi"], [[x["name"], x["calls"], x["fails"], x.get("prog", 0)] for x in S["tools"]])


# ---------------------------------------------------------------- trang dữ liệu đầy đủ
def data_page(S, U, pids, quota):
    ser = S["series"]
    rows = [[x["day"], x["users"], x["new"], x["turns"], x["errors"], "—" if x["error_rate"] is None else _p(x["error_rate"]), "—" if x["dur_p50"] is None else "%.0f/%.0f" % (x["dur_p50"], x["dur_p95"]),
             _num(x["ptok"]), _num(x["ctok"]), x["tool_calls"], x["tool_fails"], x["chat"], x["chat_5xx"], x["pkg"], x["update_check"]] for x in reversed(ser)]
    body = ['<h1>Dữ liệu đầy đủ</h1><p class="sub">Bảng chi tiết để đối chiếu; tải CSV (mở được bằng Excel) ở cuối trang.</p>']
    body.append("<h2>Theo ngày (30 ngày)</h2>" + table(["Ngày", "Người dùng", "Mới", "Lượt", "Lỗi", "Tỷ lệ lỗi", "Thời gian p50/p95 (s)", "Token vào", "Token ra", "Gọi công cụ", "Công cụ lỗi", "Gọi mô hình (nginx)", "5xx", "Tải bản cài", "Kiểm tra cập nhật"],
                                                       [[('<a href="d-%s.html">%s</a>' % (r[0], r[0]))] + r[1:] for r in rows], raw=(0,)))
    body.append("<h2>Công cụ (30 ngày)</h2>" + table(["Công cụ", "Gọi", "Lỗi thật", "Tỷ lệ lỗi", "Chương trình lỗi (bình thường)"], [[x["name"], x["calls"], x["fails"], _p(R.ratio(x["fails"], x["calls"])), x.get("prog", 0)] for x in S["tools"]] or [["—", 0, 0, "—", 0]]))
    body.append("<h2>Phiên bản, nền tảng, tab, mô hình (30 ngày)</h2>")
    for key, nm in (("version", "Phiên bản"), ("platform", "Nền tảng"), ("profile", "Tab"), ("model", "Mô hình")):
        body.append(table([nm, "Người dùng", "Máy", "Lượt"], [[x["value"], x["users"], x["installs"], x["turns"]] for x in S["dist"][key]] or [["—", 0, 0, 0]]))
    rows = []
    for uid, u in sorted(U.items(), key=lambda kv: -kv[1]["turns_n"]):
        pid = pids.get(uid)
        q = quota.get(uid) or {}
        rows.append(['<a href="u-%s.html"><code>%s</code></a>' % (_e(pid), _e(pid)) if pid else "<code>%s</code>" % _e(uid[:8]), q.get("tier", "—"), _vn(u["first"], "%Y-%m-%d"), _vn(u["last"]), len(u["days"]), u["turns_n"],
                     _p(R.ratio(u["errors_n"], u["turns_n"])) if u["turns_n"] else "—", _num(sum(q.get("by_day", {}).values())) if q else "—"])
    body.append("<h2>Tất cả người dùng (%d)</h2>" % len(U) + table(["Mã", "Bậc", "Lần đầu", "Gần nhất (VN)", "Ngày dùng", "Lượt", "Lỗi", "Token 30 ngày"], rows or [["—"] * 8], "u", raw=(0,)))
    body.append('<h2>Tải CSV</h2><ul><li><a href="users.csv">users.csv</a> — mọi người dùng (mã giả danh)</li><li><a href="daily.csv">daily.csv</a> — số liệu theo ngày</li><li><a href="tools.csv">tools.csv</a> — công cụ</li></ul>')
    return shell("Dữ liệu đầy đủ", "".join(body))


# ---------------------------------------------------------------- ghi tất cả
def write_all(out, S, recs, quota_db, now_ts, atomic):
    """Sinh u-*.html, d-*.html, data.html, *.csv; xoá các trang u-/d- không còn dữ liệu. Trả {"pids": {uid: mã}, "pages": số trang}."""
    U, D, reports = collect(recs, now_ts)
    quota = read_quota_users(quota_db) if quota_db else {}
    days = [x["day"] for x in S["series"]]
    # mã 8 ký tự; nếu trùng (rất hiếm) thì kéo dài
    pids, seen = {}, {}
    for uid in sorted(U):
        for n in range(8, 17):
            if uid[:n] not in seen:
                seen[uid[:n]] = uid
                pids[uid] = uid[:n]
                break
    active = [uid for uid, u in sorted(U.items(), key=lambda kv: -kv[1]["turns_n"]) if u["last"] >= now_ts - 30 * 86400][:MAX_USER_PAGES]
    written = set()
    for uid in active:
        name = "u-%s.html" % pids[uid]
        atomic(os.path.join(out, name), user_page(uid, pids[uid], U[uid], quota.get(uid), days, None, now_ts))
        written.add(name)
    first_day = {}
    for uid, u in U.items():
        first_day[uid] = _day(u["first"])
    dnew = collections.Counter(first_day.values())
    avail = [d for d in days if d in D]
    qday = {}
    for q in quota.values():
        for dd, tk in q["by_day"].items():
            qday[dd] = qday.get(dd, 0) + tk
    for i, day in enumerate(avail):
        name = "d-%s.html" % day
        atomic(os.path.join(out, name), day_page(day, D[day], pids, qday.get(day) if quota else None, reports, avail[i - 1] if i else None, avail[i + 1] if i + 1 < len(avail) else None, dnew.get(day, 0)))
        written.add(name)
    atomic(os.path.join(out, "data.html"), data_page(S, U, pids, quota))
    atomic(os.path.join(out, "users.csv"), users_csv(S, U, pids, quota))
    atomic(os.path.join(out, "daily.csv"), daily_csv(S))
    atomic(os.path.join(out, "tools.csv"), tools_csv(S))
    for p in glob.glob(os.path.join(out, "u-*.html")) + glob.glob(os.path.join(out, "d-*.html")):
        if os.path.basename(p) not in written:
            os.unlink(p)
    return {"pids": pids, "linked": {pids[u] for u in active}, "days": set(avail), "reports": reports[:30], "U": U, "D": D}
