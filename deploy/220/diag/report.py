#!/usr/bin/env python3
"""NEU Agent - báo cáo chất lượng hằng ngày (máy 220). Chỉ dùng thư viện chuẩn của Python 3.

Đọc (a) JSONL chẩn đoán của bộ thu (collector.py) và (b) nhật ký truy cập JSON của nginx, rồi viết:
  <out>/YYYY-MM-DD.md, <out>/YYYY-MM-DD.html (một tệp tĩnh, không tài nguyên ngoài), <out>/latest.{md,html,json}
Cửa sổ báo cáo = 24 giờ gần nhất; mốc so sánh = 7 ngày trước đó (phát hiện bất thường, "mới xuất hiện").

  python3 report.py [--diag-dir D] [--nginx-log F] [--out DIR] [--now ISO|epoch] [--thresholds file.json] [--llm]

--llm: gửi CHỈ các con số đã tổng hợp (không sự kiện thô, không chuỗi tự do) tới cổng mô hình để nháp gợi ý bằng tiếng Việt.
Thêm quy tắc phát hiện: viết một hàm `rule_xxx(S, T)` trả về `finding(...)` hoặc None rồi thêm vào RULES (xem docs/DIAGNOSTICS.md).
"""
import argparse
import collections
import datetime
import glob
import gzip
import html
import json
import math
import os
import re
import sys
import urllib.request

TZ = datetime.timezone(datetime.timedelta(hours=7))
HERE = os.path.dirname(os.path.abspath(__file__))

THRESHOLDS = {
    "min_turns": 20,  # ít hơn: không kết luận về tỷ lệ
    "turn_error_rate": 0.05, "turn_error_rate_high": 0.15,
    "step_limit_rate": 0.03, "loop_rate": 0.02, "gen_fault_rate": 0.02,
    "tool_fail_rate": 0.25, "tool_min_calls": 10,
    "bad_tool_rate": 0.02,
    "ctx_high_rate": 0.10,
    "early_interrupt_rate": 0.05, "perm_denied_rate": 0.05, "empty_output_rate": 0.01,
    "ttft_p95_ms": 20000, "turn_p95_s": 180, "vllm_p95_s": 90,
    "vllm_min_requests": 30, "vllm_5xx_rate": 0.02, "vllm_429_rate": 0.01, "vllm_401_rate": 0.05,
    "llm_retry_per_turn": 0.20,
    "old_version_share": 0.20,
    "anomaly_factor": 2.0,
    "diag_reject_rate": 0.05,
}

SEV_ORDER = {"cao": 0, "trung bình": 1, "thấp": 2}


# ---------------------------------------------------------------- đọc dữ liệu
def parse_now(s):
    if s is None:
        return datetime.datetime.now(datetime.timezone.utc)
    if re.fullmatch(r"\d+(\.\d+)?", str(s)):
        return datetime.datetime.fromtimestamp(float(s), datetime.timezone.utc)
    d = datetime.datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)


def load_diag(diag_dir, t0, t1):
    """Các bản ghi {ts_srv, uid, a, e} có t0 <= ts_srv < t1."""
    out = []
    d0 = datetime.datetime.fromtimestamp(t0, datetime.timezone.utc).date() - datetime.timedelta(days=1)
    for p in sorted(glob.glob(os.path.join(diag_dir, "????-??-??.jsonl"))):
        try:
            if datetime.date.fromisoformat(os.path.basename(p)[:10]) < d0:
                continue
            with open(p, encoding="utf-8", errors="replace") as f:
                for ln in f:
                    try:
                        r = json.loads(ln)
                    except ValueError:
                        continue
                    if isinstance(r, dict) and isinstance(r.get("e"), dict) and t0 <= r.get("ts_srv", 0) < t1:
                        out.append(r)
        except (OSError, ValueError):
            continue
    return out


def _open_text(p):
    return gzip.open(p, "rt", encoding="utf-8", errors="replace") if p.endswith(".gz") else open(p, encoding="utf-8", errors="replace")


def load_nginx(path, t0, t1):
    rows = []
    for p in sorted(glob.glob(path + "*")):
        if not re.search(r"(\.log|\.json)(\.\d+)?(\.gz)?$", p):
            continue
        try:
            with _open_text(p) as f:
                for ln in f:
                    try:
                        r = json.loads(ln)
                        ts = datetime.datetime.fromisoformat(r["ts"]).timestamp()
                    except (ValueError, KeyError, TypeError):
                        continue
                    if t0 <= ts < t1 and isinstance(r.get("status"), int):
                        r["_ts"] = ts
                        rows.append(r)
        except OSError:
            continue
    return rows


# ---------------------------------------------------------------- thống kê
def pct(vals, p):
    if not vals:
        return None
    v = sorted(vals)
    k = (len(v) - 1) * p / 100.0
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return v[lo] if lo == hi else v[lo] + (v[hi] - v[lo]) * (k - lo)


def ratio(a, b):
    return (a / b) if b else 0.0


def _last_num(s):
    try:
        return float(str(s).split(",")[-1].strip())
    except ValueError:
        return None


WORK_DIMS = ("kind", "stack", "ui", "art")


def work_profile(turns):
    """Hồ sơ công việc của các lượt (trường kind/stack/ui/art/redo/verify do ứng dụng tính cục bộ, chỉ là mã): mỗi nhóm có số lượt, kết quả,
    tỷ lệ người dùng nói chưa đạt (redo), kết quả kiểm chứng. Bản ứng dụng cũ không có các trường này: bỏ qua."""
    out = {}
    for dim in WORK_DIMS:
        g = collections.defaultdict(lambda: {"turns": 0, "ok": 0, "bad": 0, "redo": 0, "v_pass": 0, "v_fail": 0, "steps": 0})
        for t in turns:
            v = t.get(dim)
            if v is None:
                continue
            x = g[str(v)]
            x["turns"] += 1
            x["ok"] += t.get("end") == "ok"
            x["bad"] += t.get("end") in ("error", "step_limit", "loop")
            x["redo"] += bool(t.get("redo"))
            x["v_pass"] += t.get("verify") == "pass"
            x["v_fail"] += t.get("verify") == "fail"
            x["steps"] += t.get("steps", 0)
        out[dim] = dict(g)
    nth = [t["nth"] for t in turns if "nth" in t]
    out["chat_turns"] = {"first": sum(1 for n in nth if n == 1), "later": sum(1 for n in nth if n > 1)}
    out["files"] = {"new": sum(t.get("files_new", 0) for t in turns), "edit": sum(t.get("files_edit", 0) for t in turns)}
    return out


def summarize(recs, rows):
    """Tổng hợp một khoảng thời gian."""
    S = {"events": len(recs), "lost_events": 0}
    turns = [r["e"] for r in recs if r["e"].get("t") == "turn"]
    S["turns"] = len(turns)
    S["users"] = len({r.get("uid") for r in recs})
    S["installs"] = len({(r.get("a") or {}).get("install") for r in recs})
    S["lost_events"] = sum(int(r.get("lost", 0)) for r in recs if isinstance(r.get("lost"), int))
    S["outcomes"] = dict(collections.Counter(t.get("end", "?") for t in turns))
    S["rates"] = {k: ratio(S["outcomes"].get(k, 0), S["turns"]) for k in ("error", "step_limit", "loop", "interrupted")}
    durs = [t["dur_s"] for t in turns if "dur_s" in t]
    ttft = [t["ttft_ms"] for t in turns if "ttft_ms" in t]
    S["dur_s"] = {"p50": pct(durs, 50), "p95": pct(durs, 95)}
    S["ttft_ms"] = {"p50": pct(ttft, 50), "p95": pct(ttft, 95)}
    S["tokens"] = {"prompt_avg": ratio(sum(t.get("prompt_tok", 0) for t in turns), len(turns)), "completion_avg": ratio(sum(t.get("completion_tok", 0) for t in turns), len(turns))}
    S["llm_errors_by_kind"] = dict(collections.Counter(r["e"].get("kind", "?") for r in recs if r["e"].get("t") == "llm_error"))
    S["llm_errors_by_status"] = {str(k): v for k, v in collections.Counter(r["e"].get("status", 0) for r in recs if r["e"].get("t") == "llm_error").items()}
    S["llm_retries"] = dict(collections.Counter(r["e"].get("kind", "?") for r in recs if r["e"].get("t") == "llm_retry"))
    tools = collections.defaultdict(lambda: {"calls": 0, "fails": 0})
    for r in recs:
        e = r["e"]
        if e.get("t") == "tool":
            tools[e.get("name", "other")]["calls"] += 1
            # chương trình/test của người dùng chạy hỏng ("program") hoặc bị từ chối quyền không tính là công cụ lỗi (bản cũ không có mã: tính như lỗi)
            if e.get("ok") is False and e.get("err") not in ("program", "denied"):
                tools[e.get("name", "other")]["fails"] += 1
    S["tools"] = dict(tools)
    sig = collections.Counter(r["e"].get("code", "?") for r in recs if r["e"].get("t") == "signal")
    S["signals"] = dict(sig)
    sig_tool = collections.Counter((r["e"].get("code", "?"), r["e"].get("tool", "")) for r in recs if r["e"].get("t") == "signal" and r["e"].get("tool"))
    S["signals_by_tool"] = {"%s:%s" % k: v for k, v in sig_tool.items()}
    S["reports"] = sum(1 for r in recs if r["e"].get("t") == "report")
    S["perm"] = {"allow": sum(t.get("perm_allow", 0) for t in turns), "deny": sum(t.get("perm_deny", 0) for t in turns)}
    S["ctx_high_turns"] = sum(1 for t in turns if t.get("ctx_pct", 0) >= 85)
    S["work"] = work_profile(turns)

    def split(key):
        inst = collections.defaultdict(set)
        tn = collections.Counter()
        for r in recs:
            v = str((r.get("a") or {}).get(key, "?"))
            inst[v].add((r.get("a") or {}).get("install"))
            if r["e"].get("t") == "turn":
                tn[v] += 1
        return {v: {"installs": len(inst[v]), "turns": tn.get(v, 0)} for v in inst}

    S["versions"], S["platforms"], S["profiles"], S["models"] = split("version"), split("platform"), split("profile"), split("model")
    # máy Desktop theo phiên bản (bản web luôn mới nhất nên không tính vào "máy chạy bản cũ")
    dv = collections.defaultdict(lambda: {"installs": set(), "turns": 0})
    for r in recs:
        a_ = r.get("a") or {}
        if str(a_.get("platform", "?")) == "web":
            continue
        x = dv[str(a_.get("version", "?"))]
        x["installs"].add(a_.get("install"))
        x["turns"] += r["e"].get("t") == "turn"
    S["versions_desktop"] = {v: {"installs": len(x["installs"]), "turns": x["turns"]} for v, x in dv.items()}

    # nginx
    N = {"requests": len(rows), "by_route": dict(collections.Counter(r.get("route", "other") for r in rows))}
    chat = [r for r in rows if r.get("route") == "vllm_chat"]
    st = collections.Counter(r["status"] for r in chat)
    rt = [r["rt"] for r in chat if isinstance(r.get("rt"), (int, float)) and r["status"] == 200]
    urt = [v for v in (_last_num(r.get("urt")) for r in chat if r["status"] == 200) if v is not None]
    N["vllm"] = {
        "n": len(chat), "status": {str(k): v for k, v in st.items()},
        "rate_5xx": ratio(sum(v for k, v in st.items() if k >= 500), len(chat)),
        "rate_429": ratio(st.get(429, 0), len(chat)),
        "rate_401": ratio(st.get(401, 0), len(chat)),
        "rt_s": {"p50": pct(rt, 50), "p95": pct(rt, 95)}, "urt_s": {"p50": pct(urt, 50), "p95": pct(urt, 95)},
    }
    diag = [r for r in rows if r.get("route") == "diag"]
    N["diag"] = {"n": len(diag), "rate_rejected": ratio(sum(1 for r in diag if r["status"] >= 400), len(diag))}
    N["status_classes"] = dict(collections.Counter("%dxx" % (r["status"] // 100) for r in rows))
    S["nginx"] = N
    return S


# ---------------------------------------------------------------- quy tắc phát hiện
def finding(fid, sev, title, evidence, suggestion):
    return {"id": fid, "sev": sev, "title": title, "evidence": evidence, "suggestion": suggestion}


def _p(x):
    return "%.1f%%" % (100 * x)


def _enough(S, T):
    return S["turns"] >= T["min_turns"]


def rule_no_data(S, T, B=None):
    if S["events"] == 0:
        return finding("no_data", "trung bình", "Không nhận được dữ liệu chẩn đoán nào trong 24 giờ", "0 sự kiện",
                       "Kiểm tra: dịch vụ neu-agent-diag đang chạy? nginx có route /agent/diag? Ứng dụng đã bật chẩn đoán (và chưa bị chính sách tắt)? Có thể chưa ai dùng.")


def rule_turn_errors(S, T, B=None):
    if _enough(S, T) and S["rates"]["error"] >= T["turn_error_rate"]:
        kinds = ", ".join("%s=%d" % kv for kv in sorted(S["llm_errors_by_kind"].items(), key=lambda kv: -kv[1])) or "không rõ"
        return finding("turn_errors", "cao" if S["rates"]["error"] >= T["turn_error_rate_high"] else "trung bình", "Tỷ lệ lượt làm việc kết thúc bằng lỗi cao",
                       "%s trên %d lượt (ngưỡng %s); loại lỗi: %s" % (_p(S["rates"]["error"]), S["turns"], _p(T["turn_error_rate"]), kinds),
                       "Xem các mục dưới về từng loại lỗi (máy chủ/giới hạn/xác thực/ngữ cảnh). Lỗi 'unexpected' là lỗi chương trình: lấy bản 'Báo lỗi' của người dùng để tái hiện.")


def rule_unexpected(S, T, B=None):
    n = S["llm_errors_by_kind"].get("unexpected", 0)
    if n >= 3:
        return finding("unexpected", "cao", "Có lỗi không mong muốn trong chương trình", "%d lần" % n, "Đây là ngoại lệ không lường trước (không phải lỗi mô hình/mạng). Tìm ở các báo lỗi gần đây và xem phiên bản/nền tảng bị ảnh hưởng.")


def rule_gateway_5xx(S, T, B=None):
    v = S["nginx"]["vllm"]
    if v["n"] >= T["vllm_min_requests"] and v["rate_5xx"] >= T["vllm_5xx_rate"]:
        return finding("gateway_5xx", "cao", "Cổng mô hình trả lỗi 5xx nhiều", "%s trên %d lệnh gọi (%s)" % (_p(v["rate_5xx"]), v["n"], ", ".join("%s=%d" % kv for kv in sorted(v["status"].items()) if int(kv[0]) >= 500)),
                       "Kiểm tra Kong/vLLM (đang khởi động lại? hết VRAM? hàng đợi dài?), cân nhắc tăng số bản sao hoặc giảm max_tokens/ngữ cảnh. 502/504 từ nginx: kiểm tra proxy_read_timeout và máy chạy gateway mô hình.")


def rule_rate_limit(S, T, B=None):
    v = S["nginx"]["vllm"]
    by_kind = S["llm_errors_by_kind"].get("rate", 0) + S["llm_retries"].get("rate", 0)
    if (v["n"] >= T["vllm_min_requests"] and v["rate_429"] >= T["vllm_429_rate"]) or (_enough(S, T) and ratio(by_kind, S["turns"]) >= T["vllm_429_rate"]):
        return finding("rate_limit", "trung bình", "Chạm giới hạn tốc độ (429)", "nginx: %s trên %d lệnh; phía ứng dụng: %d lần lỗi/thử lại" % (_p(v["rate_429"]), v["n"], by_kind),
                       "Tăng limit_req/burst của vùng neu-agent trong neu-agent.http.conf hoặc hạn mức của key ở Kong; xem có người/tiến trình gọi dồn dập (vòng lặp) không.")


def rule_auth(S, T, B=None):
    v = S["nginx"]["vllm"]
    a = S["llm_errors_by_kind"].get("auth", 0)
    if (v["n"] >= T["vllm_min_requests"] and v["rate_401"] >= T["vllm_401_rate"]) or a >= 5:
        return finding("auth", "trung bình", "Nhiều lỗi xác thực (401/403)", "nginx 401: %s; lỗi 'auth' phía ứng dụng: %d" % (_p(v["rate_401"]), a),
                       "Phiên SSO hết hạn mà ứng dụng chưa làm mới token (đặc biệt Desktop), hoặc key sai. Kiểm tra thời hạn token oauth2-proxy và cách Desktop gắn Authorization.")


def rule_context(S, T, B=None):
    n_ctx = S["llm_errors_by_kind"].get("context", 0) + S["signals"].get("context_overflow", 0)
    rate = ratio(max(S["signals"].get("ctx_high", 0), S["ctx_high_turns"]), S["turns"])
    if _enough(S, T) and (rate >= T["ctx_high_rate"] or ratio(n_ctx, S["turns"]) >= 0.02):
        return finding("context", "trung bình", "Ngữ cảnh thường xuyên gần đầy/tràn", "ctx>=85%%: %s lượt; tràn/rút gọn khẩn cấp: %d" % (_p(rate), n_ctx),
                       "Tăng contextTokens nếu mô hình cho phép; nén sớm hơn (hạ ngưỡng tự tóm tắt); cắt kết quả công cụ dài; nhắc người dùng bấm 'Mới' khi đổi chủ đề.")


def rule_step_limit(S, T, B=None):
    if _enough(S, T) and S["rates"]["step_limit"] >= T["step_limit_rate"]:
        tools = ", ".join(k.split(":", 1)[1] for k in sorted(S["signals_by_tool"]) if k.startswith("loop:"))
        return finding("step_limit", "trung bình", "Nhiều lượt chạm giới hạn số bước", "%s trên %d lượt (ngưỡng %s)" % (_p(S["rates"]["step_limit"]), S["turns"], _p(T["step_limit_rate"])),
                       "Việc quá lớn cho một lượt hoặc agent loay hoay: xem công cụ hay lặp (%s); cân nhắc tăng maxSteps, bổ sung gợi ý chia nhỏ việc, cải thiện mô tả công cụ." % (tools or "không rõ"))


def rule_loop(S, T, B=None):
    if _enough(S, T) and S["rates"]["loop"] + ratio(S["signals"].get("loop", 0), S["turns"]) >= T["loop_rate"] and S["signals"].get("loop", 0) >= 2:
        which = ", ".join("%s=%d" % (k.split(":", 1)[1], v) for k, v in sorted(S["signals_by_tool"].items(), key=lambda kv: -kv[1]) if k.startswith("loop:"))
        return finding("loop", "cao", "Agent lặp lại cùng một thao tác", "%d lần phát hiện lặp (%s) trên %d lượt" % (S["signals"].get("loop", 0), which or "không rõ công cụ", S["turns"]),
                       "Công cụ trả lỗi/kết quả khó hiểu khiến mô hình thử lại y hệt. Làm rõ thông điệp lỗi của công cụ đó, thêm gợi ý hướng khác vào kết quả, hoặc hạ ngưỡng dừng.")


def rule_generation_faults(S, T, B=None):
    cut, rep = S["signals"].get("args_truncated", 0), S["signals"].get("text_repeat", 0)
    if _enough(S, T) and ratio(cut + rep, S["turns"]) >= T["gen_fault_rate"] and cut + rep >= 2:
        return finding("generation_faults", "trung bình", "Mô hình sinh nội dung bị cắt hoặc lặp", "lời gọi công cụ bị cắt vì quá dài: %d; lặp một đoạn văn: %d (trên %d lượt)" % (cut, rep, S["turns"]),
                       "Tạo tệp dài trong một lần gọi bị cắt ở giới hạn đầu ra, hoặc mô hình rơi vào vòng lặp văn bản. Kiểm tra maxOutputTokens/ngân sách đầu ra, nhắc agent chia nhỏ nội dung, hạ temperature; xem công cụ nào hay bị cắt (write_file/create_xlsx).")


def rule_tool_fail(S, T, B=None):
    out = []
    for name, t in sorted(S["tools"].items()):
        if t["calls"] >= T["tool_min_calls"] and ratio(t["fails"], t["calls"]) >= T["tool_fail_rate"]:
            out.append("%s: %s (%d/%d)" % (name, _p(ratio(t["fails"], t["calls"])), t["fails"], t["calls"]))
    if out:
        return finding("tool_fail", "trung bình", "Có công cụ thất bại với tỷ lệ cao", "; ".join(out),
                       "Xem mô tả/tham số của công cụ (mô hình hay gọi sai?), quyền bị từ chối, hoặc lỗi môi trường (mạng, đường dẫn). 'other' là công cụ lạ/bịa tên; 'mcp' là công cụ MCP.")


def rule_bad_tool_calls(S, T, B=None):
    n = S["signals"].get("invalid_tool_args", 0) + S["signals"].get("unknown_tool", 0)
    if _enough(S, T) and ratio(n, S["turns"]) >= T["bad_tool_rate"]:
        return finding("bad_tool_calls", "trung bình", "Mô hình gọi công cụ sai (tên không có / tham số không phải JSON)", "%d lần (%s lượt)" % (n, _p(ratio(n, S["turns"]))),
                       "Thử hạ temperature, rút gọn danh sách công cụ cho từng tab, viết mô tả công cụ rõ hơn, hoặc đổi mô hình biết gọi hàm tốt hơn.")


def rule_latency(S, T, B=None):
    bad = []
    if S["ttft_ms"]["p95"] and S["ttft_ms"]["p95"] >= T["ttft_p95_ms"]:
        bad.append("token đầu tiên p95=%.1fs (ngưỡng %.0fs)" % (S["ttft_ms"]["p95"] / 1000, T["ttft_p95_ms"] / 1000))
    if S["dur_s"]["p95"] and S["dur_s"]["p95"] >= T["turn_p95_s"]:
        bad.append("lượt p95=%.0fs (ngưỡng %ds)" % (S["dur_s"]["p95"], T["turn_p95_s"]))
    v = S["nginx"]["vllm"]
    if v["n"] >= T["vllm_min_requests"] and v["rt_s"]["p95"] and v["rt_s"]["p95"] >= T["vllm_p95_s"]:
        bad.append("lệnh gọi /vllm p95=%.0fs (ngưỡng %ds)" % (v["rt_s"]["p95"], T["vllm_p95_s"]))
    if bad:
        return finding("latency", "trung bình", "Phản hồi chậm", "; ".join(bad), "Kiểm tra tải GPU/hàng đợi của vLLM, kích thước ngữ cảnh gửi lên (prompt quá dài làm chậm token đầu), số người dùng đồng thời. $request_time của luồng streaming gồm cả thời gian sinh văn bản.")


def rule_early_interrupt(S, T, B=None):
    if _enough(S, T) and ratio(S["signals"].get("early_interrupt", 0), S["turns"]) >= T["early_interrupt_rate"]:
        return finding("early_interrupt", "thấp", "Người dùng hay bấm Dừng ngay sau khi gửi", "%s lượt" % _p(ratio(S["signals"]["early_interrupt"], S["turns"])), "Thường do phản hồi chậm hoặc hướng đi sai ngay từ đầu. Đối chiếu với độ chậm token đầu tiên và các gợi ý/prompt mẫu.")


def rule_perm_denied(S, T, B=None):
    tot = S["perm"]["allow"] + S["perm"]["deny"]
    if tot >= 20 and ratio(S["perm"]["deny"], tot) >= T["perm_denied_rate"] * 4:
        return finding("perm_denied", "thấp", "Người dùng từ chối nhiều yêu cầu quyền", "%s trên %d yêu cầu" % (_p(ratio(S["perm"]["deny"], tot)), tot), "Agent xin quyền không phù hợp (đụng tệp ngoài ý muốn?). Xem công cụ bị từ chối nhiều (tín hiệu perm_denied) và chỉnh prompt/quy tắc mặc định.")


def rule_empty(S, T, B=None):
    if _enough(S, T) and ratio(S["signals"].get("empty_output", 0), S["turns"]) >= T["empty_output_rate"]:
        return finding("empty_output", "trung bình", "Mô hình trả về rỗng", "%d lượt (%s)" % (S["signals"]["empty_output"], _p(ratio(S["signals"]["empty_output"], S["turns"]))), "Thường do hết token/thinking quá dài hoặc lỗi định dạng gọi hàm. Kiểm tra max_tokens, chế độ thinking, mẫu chat của mô hình.")


def rule_retry(S, T, B=None):
    n = sum(S["llm_retries"].values())
    if _enough(S, T) and ratio(n, S["turns"]) >= T["llm_retry_per_turn"]:
        return finding("llm_retry", "trung bình", "Ứng dụng phải thử lại nhiều lần khi gọi mô hình", "%d lần thử lại (%s) trên %d lượt" % (n, ", ".join("%s=%d" % kv for kv in S["llm_retries"].items()), S["turns"]), "Mạng/cổng không ổn định dù cuối cùng thành công — người dùng thấy chậm. Xem log healthz và Kong.")


def rule_old_versions(S, T, B=None):
    vs = S.get("versions_desktop", S["versions"])
    if len(vs) < 2:
        return None

    def key(v):
        m = re.match(r"^(\d+)\.(\d+)\.(\d+)", v)
        return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)

    newest = max(vs, key=key)
    inst = sum(x["installs"] for x in vs.values())
    old = sum(x["installs"] for k, x in vs.items() if key(k) < key(newest))
    if inst >= 5 and ratio(old, inst) >= T["old_version_share"]:
        return finding("old_versions", "thấp", "Nhiều máy đang chạy bản cũ", "%d/%d máy (%s) chưa dùng bản %s" % (old, inst, _p(ratio(old, inst)), newest), "Nhắc cập nhật Desktop (xem latest.json). Khi sửa lỗi, kiểm tra xem lỗi còn ở bản mới không trước khi kết luận.")


def rule_intake(S, T, B=None):
    d = S["nginx"]["diag"]
    ev = []
    if d["n"] >= 10 and d["rate_rejected"] >= T["diag_reject_rate"]:
        ev.append("%s yêu cầu gửi chẩn đoán bị từ chối (4xx/5xx)" % _p(d["rate_rejected"]))
    if S["lost_events"] >= 100:
        ev.append("%d sự kiện bị bỏ ở máy khách vì mạng/bộ đệm" % S["lost_events"])
    if ev:
        return finding("intake", "thấp", "Đường thu thập chẩn đoán có vấn đề", "; ".join(ev), "Xem log collector (journalctl -u neu-agent-diag); 429 = giới hạn tốc độ, 401 = phiên SSO hết hạn, 400 = lược đồ lệch giữa máy khách và schema.json.")


def rule_rework(S, T, B=None):
    """Người dùng phải nói lại/sửa lại kết quả: dấu hiệu rõ nhất của việc agent làm chưa đạt (chỉ tính từ lượt thứ hai của cuộc trò chuyện)."""
    W = S.get("work") or {}
    later = (W.get("chat_turns") or {}).get("later", 0)
    redo = sum(x["redo"] for x in (W.get("kind") or {}).values())
    if later >= 10 and redo / later >= 0.25:
        by = sorted(((v["redo"], k) for k, v in (W.get("kind") or {}).items() if v["redo"]), reverse=True)[:3]
        return finding("rework", "trung bình", "Người dùng thường phải yêu cầu làm lại", "%d/%d lượt nối tiếp (%s) có lời báo chưa đạt; nhiều nhất ở loại việc: %s" % (redo, later, _p(redo / later), ", ".join("%s=%d" % (k, n) for n, k in by) or "—"),
                       "Xem các cuộc trò chuyện có nhiều lượt làm lại: agent có kiểm chứng kết quả (dựng/chạy/check_page) trước khi báo xong không? Thêm kiểm tra tự động hoặc quy tắc trong hồ sơ tab cho loại việc/bộ khung đó.")


def rule_verify_fail(S, T, B=None):
    """Bộ khung/thư viện mà lần kiểm chứng cuối của lượt thường hỏng: chỗ cần thêm công thức (profiles.ts) hoặc bẫy phiên bản (pitfalls.ts)."""
    W = S.get("work") or {}
    bad = []
    for dim in ("stack", "ui"):
        for k, v in (W.get(dim) or {}).items():
            n = v["v_pass"] + v["v_fail"]
            if n >= 5 and v["v_fail"] / n >= 0.4:
                bad.append("%s %s: %d/%d lần kiểm chứng cuối hỏng" % (dim, k, v["v_fail"], n))
    if bad:
        return finding("verify_fail", "trung bình", "Có bộ khung/thư viện mà kiểm chứng cuối thường hỏng", "; ".join(bad[:4]),
                       "Đối chiếu với bài thử labs/code-bench: thêm công thức hoặc bẫy phiên bản cho bộ khung đó (profiles.ts / pitfalls.ts) rồi đo lại ở báo cáo sau.")


RULES = [rule_no_data, rule_turn_errors, rule_unexpected, rule_gateway_5xx, rule_rate_limit, rule_auth, rule_context, rule_step_limit, rule_loop, rule_generation_faults, rule_tool_fail, rule_bad_tool_calls, rule_latency, rule_early_interrupt, rule_perm_denied, rule_empty, rule_retry, rule_old_versions, rule_rework, rule_verify_fail, rule_intake]


def anomalies(W, B, T):
    """So cửa sổ 24h với mốc 7 ngày: đột biến (>= factor lần) và thứ mới xuất hiện."""
    out = []
    f = T["anomaly_factor"]
    have_base = B["turns"] >= T["min_turns"]

    def spike(name, w, b, n_w, floor):
        if n_w >= T["min_turns"] and w >= floor and w >= f * max(b, floor / 2.0):
            out.append({"what": name, "kind": "tăng đột biến", "window": w, "baseline": b})

    if have_base and W["turns"] >= T["min_turns"]:
        for k, label in (("error", "tỷ lệ lượt lỗi"), ("step_limit", "tỷ lệ chạm giới hạn bước"), ("loop", "tỷ lệ lặp"), ("interrupted", "tỷ lệ bị dừng")):
            spike(label, W["rates"][k], B["rates"][k], W["turns"], 0.02)
        spike("p95 thời gian lượt (s)", W["dur_s"]["p95"] or 0, B["dur_s"]["p95"] or 0, W["turns"], 30)
        spike("p95 token đầu tiên (ms)", W["ttft_ms"]["p95"] or 0, B["ttft_ms"]["p95"] or 0, W["turns"], 5000)
        for name, t in W["tools"].items():
            if t["calls"] >= T["tool_min_calls"]:
                bt = B["tools"].get(name, {"calls": 0, "fails": 0})
                spike("tỷ lệ lỗi công cụ %s" % name, ratio(t["fails"], t["calls"]), ratio(bt["fails"], bt["calls"]), W["turns"], 0.1)
    bv, wv = B["nginx"]["vllm"], W["nginx"]["vllm"]
    if bv["n"] >= T["vllm_min_requests"] and wv["n"] >= T["vllm_min_requests"]:
        for key, label, floor in (("rate_5xx", "tỷ lệ 5xx của /vllm", 0.01), ("rate_429", "tỷ lệ 429 của /vllm", 0.01)):
            if wv[key] >= floor and wv[key] >= f * max(bv[key], floor / 2.0):
                out.append({"what": label, "kind": "tăng đột biến", "window": wv[key], "baseline": bv[key]})
        if wv["rt_s"]["p95"] and bv["rt_s"]["p95"] and wv["rt_s"]["p95"] >= 30 and wv["rt_s"]["p95"] >= f * bv["rt_s"]["p95"]:
            out.append({"what": "p95 thời gian /vllm (s)", "kind": "tăng đột biến", "window": wv["rt_s"]["p95"], "baseline": bv["rt_s"]["p95"]})
    if B["events"] > 0:
        def new(label, wset, bset, minn=3):
            for k, n in sorted(wset.items()):
                if n >= minn and k not in bset:
                    out.append({"what": "%s %s" % (label, k), "kind": "mới xuất hiện", "window": n, "baseline": 0})
        new("loại lỗi LLM", W["llm_errors_by_kind"], B["llm_errors_by_kind"], 1)
        new("mã HTTP lỗi từ ứng dụng", {k: v for k, v in W["llm_errors_by_status"].items() if k != "0"}, B["llm_errors_by_status"], 1)
        new("tín hiệu", W["signals"], B["signals"])
        new("phiên bản", {k: v["installs"] for k, v in W["versions"].items()}, B["versions"], 1)
        new("mô hình", {k: v["installs"] for k, v in W["models"].items()}, B["models"], 1)
        new("công cụ thất bại", {k: v["fails"] for k, v in W["tools"].items()}, {k: v["fails"] for k, v in B["tools"].items() if v["fails"]}, 3)
    return out


def run_rules(W, B, T):
    fs = []
    for r in RULES:
        try:
            x = r(W, T, B)
        except Exception as e:  # một quy tắc lỗi không được làm hỏng cả báo cáo
            x = finding("rule_error", "thấp", "Quy tắc %s bị lỗi" % r.__name__, type(e).__name__, "Sửa quy tắc trong report.py")
        if x:
            fs.append(x)
    return sorted(fs, key=lambda x: SEV_ORDER[x["sev"]])


# ---------------------------------------------------------------- LLM (tuỳ chọn): chỉ gửi số liệu tổng hợp
_KEY_OK = re.compile(r"^[A-Za-z0-9_.:-]{1,48}$")


def numeric_only(o, depth=0):
    """Giữ lại cấu trúc + SỐ/bool; bỏ mọi chuỗi giá trị; khoá phải là định danh ngắn an toàn (tên công cụ, mã, phiên bản)."""
    if depth > 6:
        return None
    if isinstance(o, bool) or isinstance(o, (int, float)):
        return round(o, 4) if isinstance(o, float) else o
    if isinstance(o, dict):
        return {k: v2 for k, v in o.items() if isinstance(k, str) and _KEY_OK.match(k) for v2 in [numeric_only(v, depth + 1)] if v2 is not None}
    if isinstance(o, list):
        return [v2 for v in o[:30] for v2 in [numeric_only(v, depth + 1)] if v2 is not None]
    return None


def _tool_keys(d, tools):
    return {k: v for k, v in d.items() if k.split(":")[-1] in tools}


def llm_input(W, B, fs, an):
    S = {k: W[k] for k in ("turns", "users", "installs", "outcomes", "rates", "dur_s", "ttft_ms", "tokens", "llm_errors_by_kind", "llm_errors_by_status", "llm_retries", "tools", "signals", "signals_by_tool", "perm", "versions", "platforms", "profiles", "nginx")}
    try:
        with open(os.path.join(HERE, "schema.json"), encoding="utf-8") as f:
            tools = set(json.load(f)["tools"])
    except (OSError, ValueError, KeyError):
        tools = {"other"}
    S["tools"], S["signals_by_tool"] = _tool_keys(S["tools"], tools), _tool_keys(S["signals_by_tool"], tools)  # tên lạ không được đi ra ngoài
    S["versions"] = {k: v for k, v in S["versions"].items() if re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?", k)}
    return numeric_only({"window_24h": S, "baseline_7d_rates": B["rates"], "findings": {f["id"]: {"severity_" + f["sev"].replace(" ", "_"): 1} for f in fs}, "anomalies": {a["what"].replace(" ", "_")[:48]: a["window"] for a in an if isinstance(a["window"], (int, float))}})


def call_llm(data, url, model, key, timeout=90):
    prompt = ("Bạn là kỹ sư vận hành hệ thống 'NEU Agent' (trợ lý AI cho tab Work/Code/Design). Dưới đây là SỐ LIỆU TỔNG HỢP 24 giờ (không có nội dung người dùng) dạng JSON. "
              "Viết tối đa 8 gạch đầu dòng bằng TIẾNG VIỆT: vấn đề đáng chú ý nhất, nguyên nhân khả dĩ, và đề xuất cải tiến cụ thể, ưu tiên theo mức ảnh hưởng. Không bịa số liệu ngoài JSON.\n\n" + json.dumps(data, ensure_ascii=False))
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2, "max_tokens": 900, "chat_template_kwargs": {"enable_thinking": False}}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "x-ollama-seckey": key})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (địa chỉ do quản trị đặt)
        j = json.loads(r.read().decode("utf-8", "replace"))
    return (j["choices"][0]["message"]["content"] or "").strip()[:4000]


# ---------------------------------------------------------------- kết xuất
def fmt(v, unit="", nd=1):
    if v is None:
        return "—"
    return ("%d" % v if float(v).is_integer() and nd == 0 else ("%." + str(nd) + "f") % v) + unit


def tables(W):
    """Các bảng dùng chung cho Markdown/HTML: [(tiêu đề, [cột], [hàng])]."""
    T = []
    T.append(("Kết quả các lượt", ["Kết quả", "Số lượt", "Tỷ lệ"], [[k, v, _p(ratio(v, W["turns"]))] for k, v in sorted(W["outcomes"].items(), key=lambda kv: -kv[1])]))
    T.append(("Lỗi gọi mô hình (phía ứng dụng)", ["Loại", "Số lần"], [[k, v] for k, v in sorted(W["llm_errors_by_kind"].items(), key=lambda kv: -kv[1])] + [["thử lại: " + k, v] for k, v in sorted(W["llm_retries"].items())]))
    T.append(("Công cụ (nhiều lỗi nhất trước)", ["Công cụ", "Lần gọi", "Lỗi", "Tỷ lệ lỗi"], [[k, v["calls"], v["fails"], _p(ratio(v["fails"], v["calls"]))] for k, v in sorted(W["tools"].items(), key=lambda kv: (-kv[1]["fails"], -kv[1]["calls"]))[:15]]))
    T.append(("Tín hiệu vấn đề", ["Mã", "Số lần", "Trên mỗi lượt"], [[k, v, _p(ratio(v, W["turns"]))] for k, v in sorted(W["signals"].items(), key=lambda kv: -kv[1])]))
    v = W["nginx"]["vllm"]
    T.append(("Cổng mô hình /agent/vllm (nginx)", ["Chỉ số", "Giá trị"], [["Số lệnh gọi chat", v["n"]], ["Mã trạng thái", ", ".join("%s=%d" % kv for kv in sorted(v["status"].items())) or "—"], ["Tỷ lệ 5xx / 429 / 401", "%s / %s / %s" % (_p(v["rate_5xx"]), _p(v["rate_429"]), _p(v["rate_401"]))],
                                                  ["Thời gian cả yêu cầu p50 / p95", "%s / %s" % (fmt(v["rt_s"]["p50"], "s"), fmt(v["rt_s"]["p95"], "s"))], ["Thời gian upstream p50 / p95", "%s / %s" % (fmt(v["urt_s"]["p50"], "s"), fmt(v["urt_s"]["p95"], "s"))]]))
    T.append(("Độ trễ phía ứng dụng", ["Chỉ số", "p50", "p95"], [["Token đầu tiên", fmt(W["ttft_ms"]["p50"], " ms", 0), fmt(W["ttft_ms"]["p95"], " ms", 0)], ["Cả lượt", fmt(W["dur_s"]["p50"], " s", 0), fmt(W["dur_s"]["p95"], " s", 0)]]))
    T.append(("Phiên bản", ["Phiên bản", "Máy", "Lượt"], [[k, x["installs"], x["turns"]] for k, x in sorted(W["versions"].items(), reverse=True)]))
    T.append(("Nền tảng / tab / mô hình", ["Nhóm", "Giá trị", "Máy", "Lượt"], [[g, k, x["installs"], x["turns"]] for g, d in (("nền tảng", W["platforms"]), ("tab", W["profiles"]), ("mô hình", W["models"])) for k, x in sorted(d.items())]))
    W_ = W.get("work") or {}
    rows = []
    for dim, label in (("kind", "loại việc"), ("art", "sản phẩm"), ("stack", "bộ khung"), ("ui", "thư viện giao diện")):
        for k, x in sorted((W_.get(dim) or {}).items(), key=lambda kv: -kv[1]["turns"]):
            n = x["v_pass"] + x["v_fail"]
            rows.append([label, k, x["turns"], _p(ratio(x["ok"], x["turns"])), _p(ratio(x["redo"], x["turns"])), (_p(ratio(x["v_fail"], n)) if n else "—")])
    if rows:
        T.append(("Công việc người dùng làm (chỉ mã, không nội dung)", ["Nhóm", "Giá trị", "Lượt", "Xong tốt", "Nói chưa đạt", "Kiểm chứng hỏng"], rows))
    return T


def render_md(day, W, B, fs, an, llm_text, llm_err, links):
    L = ["# Báo cáo chất lượng NEU Agent — %s" % day, "", "_Cửa sổ: 24 giờ gần nhất; mốc so sánh: 7 ngày trước đó. Số liệu giả danh, **không chứa nội dung** người dùng._", ""]
    L += ["- Lượt làm việc: **%d** · người dùng (giả danh): **%d** · máy cài: **%d** · sự kiện: %d · báo lỗi thủ công: %d" % (W["turns"], W["users"], W["installs"], W["events"], W["reports"]),
          "- Lệnh gọi mô hình qua nginx: **%d** · 5xx %s · p95 %s" % (W["nginx"]["vllm"]["n"], _p(W["nginx"]["vllm"]["rate_5xx"]), fmt(W["nginx"]["vllm"]["rt_s"]["p95"], "s")), ""]
    L += ["## Phát hiện & đề xuất cải tiến", ""]
    if not fs:
        L += ["Không có phát hiện nào vượt ngưỡng.", ""]
    for f in fs:
        L += ["### [%s] %s" % (f["sev"].upper(), f["title"]), "- Bằng chứng: %s" % f["evidence"], "- Đề xuất: %s" % f["suggestion"], ""]
    if llm_text:
        L += ["## Gợi ý của mô hình (bản nháp — cần người kiểm tra)", "", llm_text, ""]
    elif llm_err:
        L += ["_Không tạo được gợi ý bằng mô hình: %s_" % llm_err, ""]
    L += ["## Bất thường so với 7 ngày trước", ""]
    L += ["- %s **%s**: %s (mốc: %s)" % (a["kind"], a["what"], _fmtnum(a["window"], a["what"]), _fmtnum(a["baseline"], a["what"])) for a in an] or ["Không có."]
    L += [""]
    for title, cols, rows in tables(W):
        L += ["## " + title, "", "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows] + [""]
    if links:
        L += ["## Báo cáo các ngày trước", ""] + ["- [%s](%s)" % (x, x) for x in links] + [""]
    return "\n".join(L)


def _fmtnum(x, what=""):
    if isinstance(x, float) and what.startswith(("tỷ lệ", "Tỷ lệ")):
        return _p(x)
    return ("%.3g" % x) if isinstance(x, float) else str(x)


CSS = """:root{--bg:#fff;--fg:#1c2330;--mut:#5b6678;--card:#f4f6fa;--line:#dde2ea;--hi:#c0362c;--mid:#b7791f;--lo:#2b6cb0;--bar:#4a7bd0}
@media (prefers-color-scheme:dark){:root{--bg:#10141b;--fg:#e4e8ef;--mut:#9aa6b8;--card:#1a212c;--line:#2a3342;--hi:#ff7b72;--mid:#e3b341;--lo:#79b8ff;--bar:#5b8def}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}p.sub{color:var(--mut);margin:0 0 16px}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.kpi div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.kpi b{display:block;font-size:22px}.kpi span{color:var(--mut);font-size:12px}
.f{border:1px solid var(--line);border-left-width:5px;border-radius:8px;background:var(--card);padding:10px 12px;margin:8px 0}.f.cao{border-left-color:var(--hi)}.f.tb{border-left-color:var(--mid)}.f.thap{border-left-color:var(--lo)}
.f h3{margin:0 0 4px;font-size:15px}.f p{margin:2px 0;color:var(--mut)}.f p b{color:var(--fg)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-weight:600}.wrap{overflow-x:auto}
.bar{display:inline-block;height:8px;background:var(--bar);border-radius:4px;vertical-align:middle}pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px}"""


def render_html(day, W, B, fs, an, llm_text, llm_err, links):
    e = html.escape
    sevc = {"cao": "cao", "trung bình": "tb", "thấp": "thap"}
    o = ["<!doctype html><html lang=\"vi\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Báo cáo chất lượng NEU Agent %s</title><style>%s</style></head><body><main>" % (e(day), CSS)]
    o.append("<h1>Báo cáo chất lượng NEU Agent — %s</h1><p class=\"sub\">24 giờ gần nhất, so với 7 ngày trước đó. Số liệu giả danh, không chứa nội dung người dùng.</p>" % e(day))
    v = W["nginx"]["vllm"]
    kp = [(W["turns"], "lượt làm việc"), (W["users"], "người dùng (giả danh)"), (_p(W["rates"]["error"]), "lượt kết thúc bằng lỗi"), (_p(W["rates"]["step_limit"] + W["rates"]["loop"]), "chạm giới hạn/lặp"), (v["n"], "lệnh gọi mô hình (nginx)"), (_p(v["rate_5xx"]), "5xx của cổng mô hình"), (fmt(v["rt_s"]["p95"], " s", 0), "p95 /vllm"), (W["reports"], "báo lỗi thủ công")]
    o.append("<div class=\"kpi\">" + "".join("<div><b>%s</b><span>%s</span></div>" % (e(str(a)), e(b)) for a, b in kp) + "</div>")
    o.append("<h2>Phát hiện &amp; đề xuất cải tiến</h2>")
    if not fs:
        o.append("<p>Không có phát hiện nào vượt ngưỡng.</p>")
    for f in fs:
        o.append("<div class=\"f %s\"><h3>[%s] %s</h3><p><b>Bằng chứng:</b> %s</p><p><b>Đề xuất:</b> %s</p></div>" % (sevc[f["sev"]], e(f["sev"].upper()), e(f["title"]), e(f["evidence"]), e(f["suggestion"])))
    if llm_text:
        o.append("<h2>Gợi ý của mô hình (bản nháp — cần người kiểm tra)</h2><pre>%s</pre>" % e(llm_text))
    elif llm_err:
        o.append("<p class=\"sub\">Không tạo được gợi ý bằng mô hình: %s</p>" % e(llm_err))
    o.append("<h2>Bất thường so với 7 ngày trước</h2>")
    o.append("<ul>" + "".join("<li>%s <b>%s</b>: %s (mốc: %s)</li>" % (e(a["kind"]), e(a["what"]), e(_fmtnum(a["window"], a["what"])), e(_fmtnum(a["baseline"], a["what"]))) for a in an) + "</ul>" if an else "<p>Không có.</p>")
    for title, cols, rows in tables(W):
        o.append("<h2>%s</h2><div class=\"wrap\"><table><tr>%s</tr>%s</table></div>" % (e(title), "".join("<th>%s</th>" % e(c) for c in cols), "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % e(str(c)) for c in r) for r in rows)))
    if links:
        o.append("<h2>Báo cáo các ngày trước</h2><ul>" + "".join("<li><a href=\"%s\">%s</a></li>" % (e(x), e(x)) for x in links) + "</ul>")
    o.append("</main></body></html>")
    return "".join(o)


# ---------------------------------------------------------------- chạy
def build(diag_dir, nginx_log, now, T, llm=None):
    t1 = now.timestamp()
    t0 = t1 - 86400
    tb = t0 - 7 * 86400
    recs = load_diag(diag_dir, tb, t1)
    rows = load_nginx(nginx_log, tb, t1) if nginx_log else []
    W = summarize([r for r in recs if r["ts_srv"] >= t0], [r for r in rows if r["_ts"] >= t0])
    B = summarize([r for r in recs if r["ts_srv"] < t0], [r for r in rows if r["_ts"] < t0])
    an = anomalies(W, B, T)
    fs = run_rules(W, B, T)
    llm_text = llm_err = None
    if llm:
        try:
            llm_text = call_llm(llm_input(W, B, fs, an), llm["url"], llm["model"], llm["key"])
        except Exception as ex:  # không có mạng/cổng lỗi: vẫn có báo cáo theo quy tắc
            llm_err = type(ex).__name__
    return W, B, fs, an, llm_text, llm_err


def write_reports(out_dir, day, W, B, fs, an, llm_text, llm_err, keep_days=90):
    os.makedirs(out_dir, exist_ok=True)
    existing = sorted(os.path.basename(p) for p in glob.glob(os.path.join(out_dir, "????-??-??.html")))
    links = sorted(set(existing + ["%s.html" % day]), reverse=True)[:60]
    md = render_md(day, W, B, fs, an, llm_text, llm_err, links)
    ht = render_html(day, W, B, fs, an, llm_text, llm_err, links)
    js = json.dumps({"day": day, "window": W, "baseline": B, "findings": fs, "anomalies": an}, ensure_ascii=False, indent=1, default=str)
    for name, text in ((day + ".md", md), (day + ".html", ht), ("latest.md", md), ("latest.html", ht), ("latest.json", js)):
        tmp = os.path.join(out_dir, "." + name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(tmp, 0o640)
        os.replace(tmp, os.path.join(out_dir, name))
    cutoff = (datetime.date.fromisoformat(day) - datetime.timedelta(days=keep_days)).isoformat()
    for p in glob.glob(os.path.join(out_dir, "????-??-??.*")):
        if os.path.basename(p)[:10] < cutoff:
            os.unlink(p)
    return os.path.join(out_dir, day + ".html")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--diag-dir", default=os.environ.get("NEU_DIAG_DIR", "/var/lib/neu-agent/diag"))
    ap.add_argument("--nginx-log", default=os.environ.get("NEU_DIAG_NGINX_LOG", "/var/log/nginx/neu-agent-access.json.log"))
    ap.add_argument("--out", default=os.environ.get("NEU_DIAG_REPORTS", "/var/lib/neu-agent/reports"))
    ap.add_argument("--now", help="mốc kết thúc cửa sổ (ISO hoặc epoch); mặc định: bây giờ")
    ap.add_argument("--thresholds", help="JSON ghi đè ngưỡng")
    ap.add_argument("--llm", action="store_true", help="nhờ mô hình nháp gợi ý (chỉ gửi số liệu tổng hợp)")
    ap.add_argument("--llm-url", default=os.environ.get("NEU_AGENT_LLM_URL", "http://127.0.0.1:8037/vllm/v1/chat/completions"))
    ap.add_argument("--llm-model", default=os.environ.get("NEU_AGENT_LLM_MODEL", "qwen3.5-35b-a3b-int4"))
    ap.add_argument("--llm-key-file", default=None)
    ap.add_argument("--print", action="store_true", help="in báo cáo Markdown ra màn hình")
    a = ap.parse_args(argv)
    T = dict(THRESHOLDS)
    if a.thresholds:
        with open(a.thresholds, encoding="utf-8") as f:
            T.update({k: v for k, v in json.load(f).items() if k in T and isinstance(v, (int, float))})
    now = parse_now(a.now)
    llm = None
    if a.llm:
        key = os.environ.get("NEU_AGENT_LLM_KEY", "")
        kf = a.llm_key_file or os.path.join(os.environ.get("CREDENTIALS_DIRECTORY", ""), "llm-key")
        if not key and os.path.isfile(kf):
            with open(kf, encoding="utf-8") as f:
                key = f.read().strip()
        llm = {"url": a.llm_url, "model": a.llm_model, "key": key}
    W, B, fs, an, lt, le = build(a.diag_dir, a.nginx_log, now, T, llm)
    day = now.astimezone(TZ).date().isoformat()
    path = write_reports(a.out, day, W, B, fs, an, lt, le)
    if a.print:
        print(render_md(day, W, B, fs, an, lt, le, []))
    print("Đã ghi %s (%d phát hiện, %d bất thường)" % (path, len(fs), len(an)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
