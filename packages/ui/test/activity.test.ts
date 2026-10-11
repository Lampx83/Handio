import { describe, expect, it } from "vitest";
import type { HistoryItem } from "@neu/agent-core";
import { activityLabel, changedFiles, chipSplit, countsAsError, countsAsStep, durationText, groupHistory, headline, headlineText, isDocViewable, isQuiet, keepsPrecedingText } from "../src/activity";

describe("chế độ yên lặng: bật khi nào", () => {
  it("chỉ tab Work và khi chưa bật 'hiện từng bước'", () => {
    expect(isQuiet("work", false)).toBe(true);
    expect(isQuiet("work", true)).toBe(false);
    expect(isQuiet("code", false)).toBe(false);
    expect(isQuiet("design", false)).toBe(false);
    expect(isQuiet(undefined, false)).toBe(false);
  });
});

describe("nhãn thân thiện theo công cụ", () => {
  it("ánh xạ tiếng Việt cho công cụ văn phòng", () => {
    expect(activityLabel("create_pptx")).toBe("Đang tạo bài trình chiếu");
    expect(activityLabel("pptx_edit")).toBe("Đang chỉnh bài trình chiếu");
    expect(activityLabel("create_docx")).toBe("Đang soạn văn bản Word");
    expect(activityLabel("docx_edit")).toBe("Đang chỉnh văn bản Word");
    expect(activityLabel("docx_replace")).toBe("Đang chỉnh văn bản Word");
    expect(activityLabel("create_xlsx")).toBe("Đang làm bảng tính");
    expect(activityLabel("xlsx_edit")).toBe("Đang làm bảng tính");
    expect(activityLabel("xlsx_pivot")).toBe("Đang làm bảng tính");
    expect(activityLabel("read_document")).toBe("Đang đọc tài liệu");
    expect(activityLabel("read_file")).toBe("Đang đọc tài liệu");
    expect(activityLabel("web_fetch")).toBe("Đang tra cứu");
    expect(activityLabel("convert_to_pdf")).toBe("Đang làm PDF");
    expect(activityLabel("create_pdf")).toBe("Đang làm PDF");
    expect(activityLabel("pdf_merge")).toBe("Đang làm PDF");
    expect(activityLabel("list_dir")).toBe("Đang xem thư mục");
    expect(activityLabel("grep")).toBe("Đang xem thư mục");
  });
  it("công cụ lạ hoặc chưa có công cụ thì 'Đang làm việc'", () => {
    expect(activityLabel("bash")).toBe("Đang làm việc");
    expect(activityLabel(null)).toBe("Đang làm việc");
    expect(activityLabel(undefined)).toBe("Đang làm việc");
  });
});

describe("đếm bước và lỗi", () => {
  it("công cụ nội bộ và công cụ của subagent không tính là bước", () => {
    expect(countsAsStep("pptx_edit")).toBe(true);
    expect(countsAsStep("todo_write")).toBe(false);
    expect(countsAsStep("ask_user")).toBe(false);
    expect(countsAsStep("exit_plan_mode")).toBe(false);
    expect(countsAsStep("read_file", 1)).toBe(false);
  });
  it("người dùng tự từ chối không tính là lỗi cần tự xử lý", () => {
    expect(countsAsError(true)).toBe(false);
    expect(countsAsError(false, "denied")).toBe(false);
    expect(countsAsError(false, "bad_args")).toBe(true);
    expect(countsAsError(false)).toBe(true);
  });
  it("lời dẫn ngay trước câu hỏi/kế hoạch được giữ ở dòng chính", () => {
    expect(keepsPrecedingText("ask_user")).toBe(true);
    expect(keepsPrecedingText("exit_plan_mode")).toBe(true);
    expect(keepsPrecedingText("create_pptx")).toBe(false);
  });
});

describe("tiêu đề khối gập", () => {
  const base = { steps: 0, errors: 0, tool: null as string | null, ms: 0 };
  it("đang chạy: nhãn theo công cụ + số bước, chưa có thời gian", () => {
    expect(headlineText({ ...base, phase: "running", tool: "create_pptx", steps: 3 })).toBe("Đang tạo bài trình chiếu · 3 bước");
    expect(headlineText({ ...base, phase: "running" })).toBe("Đang làm việc");
  });
  it("đang chờ người dùng", () => {
    expect(headlineText({ ...base, phase: "waiting", tool: "pptx_edit", steps: 2 })).toBe("Đang chờ bạn… · 2 bước");
  });
  it("xong: hoàn tất · bước · thời gian; lỗi tự xử lý hiện nhẹ", () => {
    expect(headlineText({ ...base, phase: "done", steps: 5, ms: 12_000 })).toBe("✓ Hoàn tất · 5 bước · 12 giây");
    const hl = headline({ ...base, phase: "done", steps: 14, errors: 2, ms: 95_000 });
    expect(hl.title).toBe("✓ Hoàn tất");
    expect(hl.meta).toEqual(["14 bước", "1 phút 35 giây"]);
    expect(hl.note).toBe("đã tự xử lý 2 lỗi");
  });
  it("dừng giữa chừng / chưa hoàn tất nói đúng, không giả vờ 'hoàn tất'", () => {
    expect(headlineText({ ...base, phase: "stopped", steps: 1, ms: 3000 })).toBe("Đã dừng · 1 bước · 3 giây");
    expect(headlineText({ ...base, phase: "unfinished", steps: 4, errors: 1, ms: 8000 })).toBe("Chưa hoàn tất · 4 bước · 8 giây · 1 lỗi");
  });
  it("thời gian: tối thiểu 1 giây; tròn phút", () => {
    expect(durationText(0)).toBe("1 giây");
    expect(durationText(400)).toBe("1 giây");
    expect(durationText(59_400)).toBe("59 giây");
    expect(durationText(120_000)).toBe("2 phút");
  });
});

describe("chip tệp cuối lượt", () => {
  it("giữ tệp Office/PDF/văn bản; bỏ tệp tạm ~$, tệp/thư mục ẩn, thư mục, loại khác; mỗi tệp một lần", () => {
    const got = changedFiles([
      "bai-giang.pptx", "~$bai-giang.pptx", "sub/~$x.docx", ".neuagent/commands/a.md", "docs/.cache/b.docx", "thu-muc/", "anh.png", "main.js",
      "bao-cao.docx", "bai-giang.pptx", "so-lieu.xlsx", "ghi-chu.txt", "", "./tong-hop.pdf", "a\\b\\c.csv",
    ]);
    expect(got).toEqual(["bai-giang.pptx", "bao-cao.docx", "so-lieu.xlsx", "ghi-chu.txt", "tong-hop.pdf", "a/b/c.csv"]);
  });
  it("tối đa 4 chip, phần còn lại là '+N tệp'", () => {
    expect(chipSplit(["a.docx", "b.docx"])).toEqual({ shown: ["a.docx", "b.docx"], more: 0 });
    const r = chipSplit(["1.docx", "2.docx", "3.docx", "4.docx", "5.docx", "6.docx"]);
    expect(r.shown).toHaveLength(4);
    expect(r.more).toBe(2);
  });
  it("chỉ Word/Excel/PowerPoint/PDF mở được trong khung xem", () => {
    expect(isDocViewable("a/b.PPTX")).toBe(true);
    expect(isDocViewable("x.pdf")).toBe(true);
    expect(isDocViewable("x.txt")).toBe(false);
    expect(isDocViewable("x.csv")).toBe(false);
  });
});

describe("gom lịch sử đã lưu", () => {
  const u = (text: string): HistoryItem => ({ kind: "user", text });
  const a = (text: string): HistoryItem => ({ kind: "assistant", text });
  const t = (name: string, text = ""): HistoryItem => ({ kind: "tool", text, name });

  it("lượt chỉ có chữ giữ nguyên", () => {
    expect(groupHistory([u("chào"), a("Xin chào!")])).toEqual([{ kind: "user", text: "chào" }, { kind: "assistant", text: "Xin chào!" }]);
  });
  it("lệnh công cụ liên tiếp và lời dẫn trung gian vào một khối; chữ cuối ở dòng chính", () => {
    const hist = [u("làm slide"), a("Tôi sẽ đọc tài liệu."), t("read_document"), a("Vẫn còn 14 slide…"), t("create_pptx"), t("pptx_edit"), t("pptx_edit"), a("Xong, 14 slide.")];
    const out = groupHistory(hist);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: "user", text: "làm slide" });
    const b = out[1];
    expect(b.kind).toBe("activity");
    if (b.kind === "activity") {
      expect(b.steps).toBe(4);
      expect(b.hasFinal).toBe(true);
      expect(b.items.map((x) => x.kind)).toEqual(["assistant", "tool", "assistant", "tool", "tool", "tool"]);
    }
    expect(out[2]).toEqual({ kind: "assistant", text: "Xong, 14 slide." });
  });
  it("nhiều lượt: mỗi lượt một khối riêng; lượt kết thúc bằng công cụ vẫn gom, không có chữ cuối", () => {
    const out = groupHistory([u("a"), t("read_file"), a("ok"), u("b"), t("grep"), t("glob")]);
    expect(out.map((x) => x.kind)).toEqual(["user", "activity", "assistant", "user", "activity"]);
    const last = out[4];
    if (last.kind === "activity") {
      expect(last.steps).toBe(2);
      expect(last.hasFinal).toBe(false);
    }
  });
  it("lời dẫn ngay trước câu hỏi ask_user ở lại dòng chính; todo_write không tính bước", () => {
    const out = groupHistory([u("x"), a("Cần hỏi bạn một điều."), t("ask_user"), t("todo_write"), t("create_docx"), a("Đã soạn.")]);
    expect(out.map((x) => x.kind)).toEqual(["user", "activity", "assistant", "assistant"]);
    const b = out[1];
    if (b.kind === "activity") expect(b.steps).toBe(1);
    expect(out[2]).toEqual({ kind: "assistant", text: "Cần hỏi bạn một điều." });
    expect(out[3]).toEqual({ kind: "assistant", text: "Đã soạn." });
  });
  it("lịch sử rỗng", () => {
    expect(groupHistory([])).toEqual([]);
  });
});
