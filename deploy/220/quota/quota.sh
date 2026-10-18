#!/usr/bin/env bash
# Quản lý hạn mức token của NEU Agent (máy 220). Chạy bằng sudo.
#   sudo ./quota.sh show                       cấu hình hiện tại + 15 người dùng nhiều nhất hôm nay (mã giả danh)
#   sudo ./quota.sh mode observe|enforce       observe = chỉ đếm, không chặn | enforce = chặn khi hết
#   sudo ./quota.sh tier <student|staff> <số>  đổi hạn mức mặc định của một bậc (token/ngày)
#   sudo ./quota.sh tabs <student|staff> <work,code,design|all>  tab được dùng theo bậc (= theo miền email); all = bỏ giới hạn (mặc định: mọi tab). Chặn ở cổng, không chỉ ẩn nút
#   sudo ./quota.sh models <student|staff> <tên1,tên2|all>        mô hình được dùng theo bậc (trường "model" của yêu cầu); all = bỏ giới hạn (mặc định)
#   sudo ./quota.sh tablimit <student|staff> <work|code|design> <số|off>   hạn mức token/ngày riêng của một tab (ngoài hạn mức chung); off = bỏ
#   sudo ./quota.sh group <list|show|of|create|delete|add|remove|limit|tabs|models|tablimit> …   NHÓM TUỲ TẠO (ghi đè bậc; áp dụng ngay): sudo ./quota.sh group help
#   sudo ./quota.sh set <email|tên-đăng-nhập> <số|unlimited>   đặt riêng cho một người (vd lớp học đặc biệt)
#   sudo ./quota.sh unset <email|tên-đăng-nhập>                bỏ đặt riêng
#   sudo ./quota.sh usage <email|tên-đăng-nhập>                mức đã dùng hôm nay của một người
#   sudo ./quota.sh uid <email|tên-đăng-nhập>                  mã giả danh (8 ký tự đầu) để đối chiếu trang quản trị
#   sudo ./quota.sh capture add <tên-đăng-nhập|email|tiền-tố*> BẬT ghi nội dung hội thoại (yêu cầu + câu trả lời) vào CSDL; 'test0*' = mọi tài khoản tên bắt đầu bằng test0 (không áp cho email)
#   sudo ./quota.sh capture remove <tên-đăng-nhập|email>       tắt ghi cho tài khoản đó (dữ liệu đã ghi vẫn còn)
#   sudo ./quota.sh capture list                               tài khoản đang được ghi + số dòng đã ghi
#   sudo ./quota.sh capture export [tài-khoản] [ngày]          xuất JSON Lines ra màn hình (> tep.jsonl); ngày = số ngày gần nhất
#   sudo ./quota.sh capture purge <tên-đăng-nhập|email>        XOÁ mọi nội dung đã ghi của tài khoản đó
#   sudo ./quota.sh capture grant <user-linux>                 cho user Linux đó ĐỌC THẲNG captures.db (thêm vào nhóm neu-diag); revoke = thu lại
# Mỗi lệnh đổi cấu hình kiểm tra hợp lệ rồi khởi động lại dịch vụ (cấu hình được nạp lúc khởi động). Bậc theo tên miền: xem "domains" trong /etc/neu-agent/quota.json.
set -euo pipefail
CONF=/etc/neu-agent/quota.json
DB=/var/lib/neu-agent/quota/usage.db
CAPDB=/var/lib/neu-agent/quota/captures.db
GROUPS=/var/lib/neu-agent/quota/groups.json
SECRET=/etc/neu-agent/diag-secret
[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
[ -f "$CONF" ] || { echo "Chưa có $CONF: chạy quota/install-quota.sh trước."; exit 1; }
restart() { systemctl restart neu-agent-quota && sleep 1 && systemctl is-active --quiet neu-agent-quota && echo "Đã áp dụng (khởi động lại cổng hạn mức)." || { echo "Cổng hạn mức không chạy lại được: xem journalctl -u neu-agent-quota"; exit 1; }; }
edit() { python3 - "$CONF" "$@" <<'PY'
import json, re, sys, os, tempfile
path, op, *a = sys.argv[1:]
cfg = json.load(open(path, encoding="utf-8"))
ident = lambda s: s.strip().lower()
num = lambda s: int(s.replace(".", "").replace(",", "")) if re.fullmatch(r"[0-9][0-9.,]*", s) else sys.exit("Số token không hợp lệ: " + s)
if op == "mode":
    if a[0] not in ("observe", "enforce"): sys.exit("mode phải là observe hoặc enforce")
    cfg["mode"] = a[0]
elif op == "tier":
    cfg.setdefault("tiers", {})[a[0]] = num(a[1])
elif op == "tabs":
    t = a[0].strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", t): sys.exit("Tên bậc không hợp lệ")
    if a[1].strip().lower() == "all": cfg.setdefault("tabs", {}).pop(t, None)
    else:
        want = [x for x in a[1].strip().lower().split(",") if x]
        if not want or any(x not in ("work", "code", "design") for x in want): sys.exit("Danh sách tab phải gồm work, code, design (cách nhau bằng dấu phẩy) hoặc all")
        cfg.setdefault("tabs", {})[t] = [x for x in ("work", "code", "design") if x in want]
elif op == "models":
    t = a[0].strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", t): sys.exit("Tên bậc không hợp lệ")
    if a[1].strip().lower() == "all": cfg.setdefault("models", {}).pop(t, None)
    else:
        want = [x.strip() for x in a[1].split(",") if x.strip()]
        if not want or len(want) > 50 or any(not re.fullmatch(r"[A-Za-z0-9._:/-]{1,100}", x) for x in want): sys.exit("Danh sách mô hình: tên cách nhau bằng dấu phẩy (chữ, số, . _ : / -) hoặc all")
        cfg.setdefault("models", {})[t] = list(dict.fromkeys(want))
elif op == "tablimit":
    t, tab = a[0].strip().lower(), a[1].strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", t): sys.exit("Tên bậc không hợp lệ")
    if tab not in ("work", "code", "design"): sys.exit("Tab phải là work, code hoặc design")
    tl = cfg.setdefault("tab_limits", {}).setdefault(t, {})
    if a[2].strip().lower() == "off": tl.pop(tab, None)
    else: tl[tab] = num(a[2])
    if not tl: cfg["tab_limits"].pop(t, None)
elif op == "set":
    i = ident(a[0])
    if not re.fullmatch(r"[a-z0-9._%+'-]{1,64}@[a-z0-9.-]{1,190}|[a-z0-9][a-z0-9._-]{2,31}", i): sys.exit("Email/tên đăng nhập không hợp lệ")
    cfg.setdefault("overrides", {})[i] = "unlimited" if a[1] == "unlimited" else num(a[1])
elif op == "unset":
    cfg.setdefault("overrides", {}).pop(ident(a[0]), None)
elif op in ("capture_add", "capture_remove"):
    i = ident(a[0])
    if not re.fullmatch(r"[a-z0-9._%+'-]{1,64}@[a-z0-9.-]{1,190}|[a-z0-9][a-z0-9._-]{2,31}|[a-z0-9][a-z0-9._-]{2,30}\*", i): sys.exit("Email/tên đăng nhập không hợp lệ (mẫu tiền tố: test0* — tối thiểu 3 ký tự trước dấu *)")
    cap = cfg.setdefault("capture", {"users": [], "keep_days": 90}); cap.setdefault("keep_days", 90)
    users = [u for u in cap.get("users", []) if u != i]
    if op == "capture_add": users.append(i)
    cap["users"] = sorted(users)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path)); os.fchmod(fd, 0o640)
with os.fdopen(fd, "w", encoding="utf-8") as f: json.dump(cfg, f, ensure_ascii=False, indent=2); f.write("\n")
os.replace(tmp, path)
PY
}
uid_of() { python3 -c 'import hmac,hashlib,sys; s=open(sys.argv[1],"rb").read().strip(); print(hmac.new(s,sys.argv[2].strip().lower().encode(),hashlib.sha256).hexdigest()[:16])' "$SECRET" "$1"; }
case "${1:-}" in
  show)
    python3 - "$CONF" "$DB" <<'PY'
import json, sqlite3, sys, datetime
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
tz = datetime.timezone(datetime.timedelta(hours=7))
print("Chế độ: %s | bậc: %s | vượt thêm %s%% | nhắc từ %s%% | tối đa %s yêu cầu đồng thời/người" % (cfg.get("mode"), cfg.get("tiers"), cfg.get("grace_pct"), cfg.get("warn_pct"), cfg.get("max_concurrent")))
print("Tên miền → bậc:", cfg.get("domains"), "| mặc định:", cfg.get("default_tier"))
print("Tab được dùng theo bậc:", cfg.get("tabs") or "(không giới hạn: mọi bậc dùng cả Work, Code, Design)")
print("Mô hình được dùng theo bậc:", cfg.get("models") or "(không giới hạn)")
print("Hạn mức theo tab:", cfg.get("tab_limits") or "(không có)")
print("Nhóm tuỳ tạo: sudo quota.sh group list")
print("Đặt riêng:", cfg.get("overrides") or "(không có)")
print("Ghi nội dung hội thoại của:", (cfg.get("capture") or {}).get("users") or "(không ai)")
try:
    db = sqlite3.connect("file:%s?mode=ro" % sys.argv[2], uri=True)
    day = datetime.datetime.now(tz).date().isoformat()
    rows = db.execute("select uid,tier,lim,tokens,requests,blocked from usage where day=? order by tokens desc limit 15", (day,)).fetchall()
    tot = db.execute("select count(*),coalesce(sum(tokens),0),coalesce(sum(blocked),0) from usage where day=?", (day,)).fetchone()
    print("\nHôm nay (%s): %d người, %s token, %d yêu cầu bị chặn" % (day, tot[0], format(tot[1], ","), tot[2]))
    for u, t, l, k, r, b in rows:
        print("  %s  %-8s %12s / %-12s %s%s" % (u[:8], t, format(k, ","), "không giới hạn" if l < 0 else format(l, ","), "%d yêu cầu" % r, "  (bị chặn %d)" % b if b else ""))
except sqlite3.Error as e:
    print("\n(chưa có dữ liệu sử dụng:", e, ")")
PY
    ;;
  capture)
    case "${2:-}" in
      add)    [ "${3:-}" ] || { sed -n 2,21p "$0"; exit 1; }; edit capture_add "$3"; restart
              echo "ĐÃ BẬT ghi nội dung hội thoại của '$3' vào $CAPDB (quyền 640 nhóm neu-diag, giữ 90 ngày; cho user Linux đọc: capture grant <user>). Hãy báo cho người dùng tài khoản này." ;;
      remove) [ "${3:-}" ] || { sed -n 2,21p "$0"; exit 1; }; edit capture_remove "$3"; restart ;;
      list)
        python3 - "$CONF" "$CAPDB" <<'PY'
import json, sqlite3, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
cap = cfg.get("capture") or {}
print("Đang ghi nội dung:", cap.get("users") or "(không tài khoản nào)", "| giữ", cap.get("keep_days", 90), "ngày")
try:
    db = sqlite3.connect("file:%s?mode=ro" % sys.argv[2], uri=True)
    for u, n, a, b in db.execute("select user,count(*),min(ts),max(ts) from captures group by user"):
        import datetime
        f = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone(datetime.timedelta(hours=7))).strftime("%Y-%m-%d %H:%M")
        print("  %-24s %6d dòng  %s → %s" % (u, n, f(a), f(b)))
except sqlite3.Error as e:
    print("(chưa có dữ liệu:", e, ")")
PY
        ;;
      export)
        python3 - "$CAPDB" "${3:-}" "${4:-}" <<'PY'
import json, sqlite3, sys, time
try:
    db = sqlite3.connect("file:%s?mode=ro" % sys.argv[1], uri=True); db.row_factory = sqlite3.Row
    db.execute("select 1 from captures limit 1")
except sqlite3.Error:
    sys.exit("Chưa có dữ liệu: CSDL chỉ được tạo khi tài khoản đang được ghi gửi yêu cầu đầu tiên (sau lệnh capture add).")
q, args = "select * from captures", []
w = []
if sys.argv[2].endswith("*"): w.append("user like ? escape '\\'"); args.append(sys.argv[2].strip().lower()[:-1].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")   # tiền tố: test0*
elif sys.argv[2]: w.append("user=?"); args.append(sys.argv[2].strip().lower())
if sys.argv[3].isdigit(): w.append("ts>=?"); args.append(int(time.time()) - int(sys.argv[3]) * 86400)
if w: q += " where " + " and ".join(w)
for r in db.execute(q + " order by ts, id", args):
    d = dict(r)
    for k in ("new_messages", "tool_calls"):
        try: d[k] = json.loads(d[k]) if d[k] else None
        except ValueError: pass
    print(json.dumps(d, ensure_ascii=False))
PY
        ;;
      grant)  [ "${3:-}" ] || { sed -n 2,21p "$0"; exit 1; }
              id -u "$3" >/dev/null 2>&1 || { echo "Không có user Linux '$3'."; exit 1; }
              usermod -aG neu-diag "$3" && echo "Đã thêm '$3' vào nhóm neu-diag: từ phiên SSH MỚI, user này đọc được $CAPDB (chỉ đọc). Hãy báo người dùng tài khoản được ghi." ;;
      revoke) [ "${3:-}" ] || { sed -n 2,21p "$0"; exit 1; }
              gpasswd -d "$3" neu-diag && echo "Đã thu quyền đọc của '$3'." ;;
      purge)  [ "${3:-}" ] || { sed -n 2,21p "$0"; exit 1; }
              python3 -c 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); n=db.execute("delete from captures where user=?",(sys.argv[2].strip().lower(),)).rowcount; db.commit(); print("Đã xoá",n,"dòng")' "$CAPDB" "$3" ;;
      *) sed -n 2,21p "$0" | sed 's/^# \{0,1\}//'; exit 1;;
    esac
    ;;
  mode)  [ "${2:-}" ] || { sed -n 2,16p "$0"; exit 1; }; edit mode "$2"; restart;;
  tier)  [ "${3:-}" ] || { sed -n 2,16p "$0"; exit 1; }; edit tier "$2" "$3"; restart;;
  tabs)  [ "${3:-}" ] || { sed -n 2,16p "$0"; exit 1; }; edit tabs "$2" "$3"; restart;;
  models) [ "${3:-}" ] || { sed -n 2,16p "$0"; exit 1; }; edit models "$2" "$3"; restart;;
  tablimit) [ "${4:-}" ] || { sed -n 2,16p "$0"; exit 1; }; edit tablimit "$2" "$3" "$4"; restart;;
  group)
    # nhóm tuỳ tạo nằm ở $GROUPS (thư mục của neu-diag), cổng nạp lại khi tệp đổi: KHÔNG cần khởi động lại. Cùng mã ghi với trang quản trị (quota_admin.py).
    QA=/usr/local/lib/neu-agent-diag/quota_admin.py
    [ -f "$QA" ] || QA="$(cd "$(dirname "$0")/.." && pwd)/diag/quota_admin.py"
    [ -f "$QA" ] || { echo "Không thấy quota_admin.py: chạy ./diag/install-diag.sh trước."; exit 1; }
    [ -d "$(dirname "$GROUPS")" ] || { echo "Chưa có $(dirname "$GROUPS"): chạy quota/install-quota.sh trước."; exit 1; }
    shift; NEU_QUOTA_GROUPS="$GROUPS" python3 -I "$QA" group "$@";;
  set)   [ "${3:-}" ] || { sed -n 2,16p "$0"; exit 1; }; edit set "$2" "$3"; restart;;
  unset) [ "${2:-}" ] || { sed -n 2,16p "$0"; exit 1; }; edit unset "$2"; restart;;
  uid)   [ "${2:-}" ] || { sed -n 2,16p "$0"; exit 1; }; uid_of "$2" | cut -c1-8;;
  usage)
    [ "${2:-}" ] || { sed -n 2,16p "$0"; exit 1; }
    U=$(uid_of "$2")
    python3 - "$DB" "$U" <<'PY'
import sqlite3, sys, datetime
tz = datetime.timezone(datetime.timedelta(hours=7)); day = datetime.datetime.now(tz).date().isoformat()
r = sqlite3.connect("file:%s?mode=ro" % sys.argv[1], uri=True).execute("select tier,lim,tokens,prompt,completion,requests,blocked from usage where day=? and uid=?", (day, sys.argv[2])).fetchone()
print("Hôm nay chưa dùng gì." if not r else "Bậc %s | hạn mức %s | đã dùng %s (vào %s, ra %s) | %d yêu cầu | bị chặn %d" % (r[0], "không giới hạn" if r[1] < 0 else format(r[1], ","), format(r[2], ","), format(r[3], ","), format(r[4], ","), r[5], r[6]))
PY
    ;;
  *) sed -n 2,16p "$0" | sed 's/^# \{0,1\}//'; exit 1;;
esac
