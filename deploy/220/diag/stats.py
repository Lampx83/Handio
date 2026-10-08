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
DAYS = 30            # số ngày trong biểu đồ và bảng người dùng
HIST_DAYS = 90       # khớp thời hạn giữ dữ liệu của bộ thu
TOP_USERS = 100
DAILY_KEEP = 400


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
def compute(recs, daily, now):
    t = now.timestamp()
    today = vn_day(t)
    days = [(datetime.date.fromisoformat(today) - datetime.timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
    U = {}
    per_day = collections.defaultdict(lambda: {"users": set(), "installs": set(), "turns": 0, "errors": 0})
    hours = [0] * 24
    dist = {k: collections.defaultdict(lambda: {"users": set(), "installs": set(), "turns": 0}) for k in ("version", "platform", "profile", "model")}
    for r in recs:
        ts, uid, a, e = r["ts_srv"], r.get("uid") or "?", r.get("a") or {}, r["e"]
        u = U.setdefault(uid, {"first": ts, "last": ts, "days": set(), "turns": 0, "turns30": 0, "prof": collections.Counter(), "plat": collections.Counter(), "ver": "", "model": "", "ver_ts": 0})
        u["first"], u["last"] = min(u["first"], ts), max(u["last"], ts)
        day = vn_day(ts)
        u["days"].add(day)
        pd = per_day[day]
        pd["users"].add(uid)
        pd["installs"].add(a.get("install"))
        if ts >= u["ver_ts"]:
            u["ver_ts"], u["ver"], u["model"] = ts, str(a.get("version", "")), str(a.get("model", ""))
        is_turn = e.get("t") == "turn"
        in30 = ts >= t - DAYS * 86400
        if is_turn:
            u["turns"] += 1
            pd["turns"] += 1
            pd["errors"] += e.get("end") == "error"
            if in30:
                u["turns30"] += 1
                hours[datetime.datetime.fromtimestamp(ts, TZ).hour] += 1
            u["prof"][str(a.get("profile", "?"))] += 1
            u["plat"][str(a.get("platform", "?"))] += 1
        if in30:
            for k in dist:
                x = dist[k][str(a.get(k, "?"))]
                x["users"].add(uid)
                x["installs"].add(a.get("install"))
                x["turns"] += is_turn

    # tập người dùng/máy/lượt theo cửa sổ (tính trực tiếp từ bản ghi cho chính xác)
    def window(w, lo=0):
        s1, s0 = t - lo, t - w
        us, ins, tn = set(), set(), 0
        for r in recs:
            if s0 <= r["ts_srv"] < s1:
                us.add(r.get("uid"))
                ins.add((r.get("a") or {}).get("install"))
                tn += r["e"].get("t") == "turn"
        return us, ins, tn

    w24, w7, w30, wall = window(86400), window(7 * 86400), window(30 * 86400), window(HIST_DAYS * 86400)
    prev7 = window(14 * 86400, 7 * 86400)
    new7 = {uid for uid, u in U.items() if u["first"] >= t - 7 * 86400}
    new30 = {uid for uid, u in U.items() if u["first"] >= t - 30 * 86400}
    kpi = {
        "users_24h": len(w24[0]), "users_7d": len(w7[0]), "users_30d": len(w30[0]), "users_total": len(wall[0]),
        "installs_24h": len(w24[1]), "installs_7d": len(w7[1]), "installs_30d": len(w30[1]), "installs_total": len(wall[1]),
        "turns_24h": w24[2], "turns_7d": w7[2], "turns_30d": w30[2], "turns_total": wall[2],
        "new_users_7d": len(new7), "new_users_30d": len(new30),
        "returning_7d": R.ratio(len(w7[0] & prev7[0]), len(prev7[0])) if prev7[0] else None,
    }
    series = []
    first_day = min(per_day) if per_day else today
    first_seen_day = {uid: vn_day(u["first"]) for uid, u in U.items()}
    new_by_day = collections.Counter(first_seen_day.values())
    for d in days:
        pd = per_day.get(d)
        n = daily.get(d, {})
        series.append({"day": d, "users": len(pd["users"]) if pd else 0, "installs": len(pd["installs"]) if pd else 0,
                       "new": new_by_day.get(d, 0) if d > first_day else 0, "turns": pd["turns"] if pd else 0, "errors": pd["errors"] if pd else 0,
                       "chat": n.get("chat", 0), "chat_5xx": n.get("chat_5xx", 0), "pkg": n.get("pkg", 0), "update_check": n.get("update_check", 0)})
    users = []
    for uid, u in sorted(U.items(), key=lambda kv: (-kv[1]["turns30"], -kv[1]["last"]))[:TOP_USERS]:
        users.append({"id": uid[:8], "first": vn_day(u["first"]), "last": datetime.datetime.fromtimestamp(u["last"], TZ).strftime("%Y-%m-%d %H:%M"),
                      "days": len(u["days"]), "turns30": u["turns30"], "turns": u["turns"],
                      "profile": (u["prof"].most_common(1) or [("—", 0)])[0][0], "platform": (u["plat"].most_common(1) or [("—", 0)])[0][0], "version": u["ver"], "model": u["model"]})
    dists = {k: [{"value": v, "users": len(x["users"]), "installs": len(x["installs"]), "turns": x["turns"]} for v, x in sorted(d.items(), key=lambda kv: -len(kv[1]["users"]))] for k, d in dist.items()}
    totals_pkg = sum(v.get("pkg", 0) for v in daily.values())
    return {"generated": datetime.datetime.fromtimestamp(t, TZ).strftime("%Y-%m-%d %H:%M"), "today": today, "kpi": kpi, "series": series, "users": users,
            "users_listed": len(users), "dist": dists, "hours": hours, "downloads_total": totals_pkg, "daily_first": min(daily) if daily else None}


# ---------------------------------------------------------------- hiển thị
CSS = R.CSS + """
nav{margin:6px 0 14px}nav a{margin-right:14px}a{color:var(--lo)}
.ch{width:100%;height:auto;display:block}.ch rect{fill:var(--bar)}.ch rect.b2{fill:var(--hi)}.ch text{fill:var(--mut);font-size:9px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.grid.wide{grid-template-columns:repeat(auto-fit,minmax(400px,1fr))}@media (max-width:480px){.grid.wide{grid-template-columns:1fr}}.card h3{margin:0 0 6px;font-size:14px}.ok{color:#2f855a}.bad{color:var(--hi)}small,.note{color:var(--mut);font-size:12.5px}code{font-size:13px}"""


def bars(vals, labels, errs=None, h=70, trim=5):
    n, w = len(vals), 300
    mx = max(vals + (errs or [])) or 1
    bw = w / n
    out = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Biểu đồ cột %d ngày, lớn nhất %d">' % (w, h + 16, n, mx)]
    for i, v in enumerate(vals):
        bh = h * v / mx
        out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1.5"><title>%s: %s</title></rect>' % (i * bw + 1, h - bh, max(bw - 2, 1), max(bh, 0.5 if v else 0), html.escape(labels[i]), v))
        if errs and errs[i]:
            eh = h * errs[i] / mx
            out.append('<rect class="b2" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1.5"><title>%s: lỗi %s</title></rect>' % (i * bw + 1, h - eh, max(bw - 2, 1), max(eh, 0.5), html.escape(labels[i]), errs[i]))
    out.append('<text x="0" y="%d">%s</text><text x="%d" y="%d" text-anchor="end">%s</text><text x="%d" y="10" text-anchor="end">max %d</text></svg>' % (h + 12, html.escape(labels[0][trim:]), w, h + 12, html.escape(labels[-1][trim:]), w, mx))
    return "".join(out)


def table(cols, rows):
    e = html.escape
    return '<div class="wrap"><table><tr>%s</tr>%s</table></div>' % ("".join("<th>%s</th>" % e(c) for c in cols), "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % e(str(c)) for c in r) for r in rows))


def read_health(path, t):
    try:
        with open(path, encoding="utf-8") as f:
            h = json.load(f)
        age = t - os.path.getmtime(path)
        return bool(h.get("ok")) and age < 900, [str(x) for x in h.get("failed", [])][:10], age
    except (OSError, ValueError, AttributeError):
        return None, [], None


def render(S, health, report_links, nginx_note):
    e, k = html.escape, S["kpi"]
    ser = S["series"]
    lab = [x["day"] for x in ser]
    ret = k["returning_7d"]
    kp = [(k["users_24h"], "người dùng 24 giờ"), (k["users_7d"], "người dùng 7 ngày"), (k["users_30d"], "người dùng 30 ngày"), (k["users_total"], "người dùng (cả %d ngày giữ)" % HIST_DAYS),
          (k["new_users_7d"], "người dùng mới 7 ngày"), ("—" if ret is None else R._p(ret), "quay lại (tuần này/tuần trước)"),
          (k["installs_30d"], "máy cài hoạt động 30 ngày"), (k["turns_24h"], "lượt làm việc 24 giờ"), (k["turns_7d"], "lượt 7 ngày"), (k["turns_30d"], "lượt 30 ngày"),
          (sum(x["pkg"] for x in ser), "lượt tải bản cài (30 ngày)"), (sum(x["chat"] for x in ser), "lệnh gọi mô hình (30 ngày)")]
    o = ['<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quản trị NEU Agent</title><style>%s</style></head><body><main>' % CSS]
    o.append('<h1>Quản trị NEU Agent</h1><p class="sub">Cập nhật %s (giờ Việt Nam), tự làm mới mỗi 10 phút. Người dùng chỉ hiện dưới <b>mã giả danh</b>; không có email hay nội dung hội thoại.</p>' % e(S["generated"]))
    ok, failed, age = health
    if ok is None:
        hs = '<span class="bad">chưa có dữ liệu kiểm tra sức khoẻ</span>'
    elif ok:
        hs = '<span class="ok">hoạt động tốt</span> (kiểm tra cách đây %d phút)' % (age // 60)
    else:
        hs = '<span class="bad">có sự cố: %s</span>' % e(", ".join(failed) or "kiểm tra đã cũ")
    o.append('<nav><b>Hệ thống:</b> %s &nbsp;·&nbsp; <a href="latest.html">Báo cáo chất lượng hôm nay</a> · <a href="latest.json">JSON</a> · <a href="stats.json">stats.json</a></nav>' % hs)
    o.append('<div class="kpi">' + "".join("<div><b>%s</b><span>%s</span></div>" % (e(str(a)), e(b)) for a, b in kp) + "</div>")
    o.append('<div class="grid">')
    for title, vals, errs in (("Người dùng hoạt động mỗi ngày", [x["users"] for x in ser], None), ("Người dùng mới mỗi ngày", [x["new"] for x in ser], None),
                              ("Lượt làm việc mỗi ngày (đỏ: kết thúc lỗi)", [x["turns"] for x in ser], [x["errors"] for x in ser]),
                              ("Lệnh gọi mô hình mỗi ngày qua nginx (đỏ: 5xx)", [x["chat"] for x in ser], [x["chat_5xx"] for x in ser]),
                              ("Tải bản cài mỗi ngày", [x["pkg"] for x in ser], None), ("Ứng dụng Desktop kiểm tra cập nhật mỗi ngày", [x["update_check"] for x in ser], None)):
        o.append('<div class="card"><h3>%s</h3>%s</div>' % (e(title), bars(vals, lab, errs)))
    hl = ["%02d:00" % h for h in range(24)]
    o.append('<div class="card"><h3>Lượt làm việc theo giờ trong ngày (30 ngày, giờ VN)</h3>%s</div>' % bars(S["hours"], hl, h=70, trim=0))
    o.append("</div>")
    o.append('<p class="note">%s</p>' % e(nginx_note))
    names = {"version": "Phiên bản", "platform": "Nền tảng", "profile": "Tab (Work/Code/Design)", "model": "Mô hình"}
    o.append("<h2>Cơ cấu sử dụng (30 ngày)</h2><div class=\"grid wide\">")
    for key in ("version", "platform", "profile", "model"):
        o.append('<div class="card"><h3>%s</h3>%s</div>' % (names[key], table([names[key], "Người dùng", "Máy", "Lượt"], [[x["value"], x["users"], x["installs"], x["turns"]] for x in S["dist"][key]] or [["—", 0, 0, 0]])))
    o.append("</div>")
    o.append("<h2>Người dùng (%d người đứng đầu theo số lượt 30 ngày)</h2>" % S["users_listed"])
    o.append(table(["Mã", "Lần đầu", "Gần nhất (VN)", "Số ngày dùng", "Lượt 30 ngày", "Tổng lượt", "Tab chính", "Nền tảng", "Phiên bản", "Mô hình"],
                   [[u["id"], u["first"], u["last"], u["days"], u["turns30"], u["turns"], u["profile"], u["platform"], u["version"], u["model"]] for u in S["users"]]))
    o.append('<p class="note">Mã = 8 ký tự đầu của HMAC(bí mật máy chủ, email). Muốn biết mã ứng với ai: tính HMAC cho email cần tra bằng <code>diag-secret</code> trên máy 220 (xem docs/DIAGNOSTICS.md); trang này không lưu và không hiển thị email.</p>')
    if report_links:
        o.append("<h2>Báo cáo chất lượng các ngày trước</h2><p>" + " · ".join('<a href="%s">%s</a>' % (e(x), e(x[:-5])) for x in report_links) + "</p>")
    o.append("</main></body></html>")
    return "".join(o)


def write_atomic(path, text):
    tmp = os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(tmp, 0o640)
    os.replace(tmp, path)


def run(diag_dir, nginx_log, out, health_file, now):
    t = now.timestamp()
    os.makedirs(out, exist_ok=True)
    recs = R.load_diag(diag_dir, t - HIST_DAYS * 86400, t + 1)
    rows = R.load_nginx(nginx_log, t - 15 * 86400, t + 1) if nginx_log else []
    dpath = os.path.join(out, "nginx-daily.json")
    daily = merge_daily(dpath, nginx_daily(rows), vn_day(t))
    S = compute(recs, daily, now)
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
    ap.add_argument("--now", help="ISO hoặc epoch; mặc định: bây giờ")
    a = ap.parse_args(argv)
    S = run(a.diag_dir, a.nginx_log, a.out, a.health, R.parse_now(a.now))
    print("Đã ghi %s/index.html (%d người dùng 30 ngày, %d lượt 24 giờ)" % (a.out, S["kpi"]["users_30d"], S["kpi"]["turns_24h"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
