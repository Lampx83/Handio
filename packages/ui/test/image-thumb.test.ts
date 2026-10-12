import { describe, expect, it } from "vitest";
import { mimeOfName, splitPastedRefs } from "../src/image-thumb";

describe("ảnh dán trong tin nhắn", () => {
  it("tách tham chiếu ảnh dán khỏi phần chữ (không hiện tên tệp)", () => {
    expect(splitPastedRefs("@dan/anh-dan-20261012-233712.png giải bài này giúp tôi")).toEqual({ refs: ["dan/anh-dan-20261012-233712.png"], body: "giải bài này giúp tôi" });
    expect(splitPastedRefs("so sánh @dan/a.png với @dan/b.jpg nhé")).toEqual({ refs: ["dan/a.png", "dan/b.jpg"], body: "so sánh với nhé" });
    expect(splitPastedRefs("@.neuagent/pasted/anh-1.webp xem")).toEqual({ refs: [".neuagent/pasted/anh-1.webp"], body: "xem" });
  });
  it("không động tới tệp thường trong dự án hay email", () => {
    expect(splitPastedRefs("đọc @src/logo.png và gửi a@dan/x.png")).toEqual({ refs: [], body: "đọc @src/logo.png và gửi a@dan/x.png" });
    expect(splitPastedRefs("không có ảnh")).toEqual({ refs: [], body: "không có ảnh" });
  });
  it("loại MIME theo đuôi", () => {
    expect(mimeOfName("a.JPG")).toBe("image/jpeg");
    expect(mimeOfName("a.webp")).toBe("image/webp");
    expect(mimeOfName("khong-duoi")).toBe("image/png");
  });
});
