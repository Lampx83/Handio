import { describe, expect, it } from "vitest";
import { chatTitle } from "../src/projects";

const user = (content: string) => [{ role: "user" as const, content }];

describe("tiêu đề cuộc trò chuyện có ảnh dán", () => {
  it("không để tên tệp ảnh dán làm tiêu đề", () => {
    expect(chatTitle(user("@dan/anh-dan-20261012-233712.png giải bài toán trong ảnh giúp tôi"))).toBe("giải bài toán trong ảnh giúp tôi");
    expect(chatTitle(user("@.neuagent/pasted/anh-dan-1.png @.neuagent/pasted/anh-dan-2.jpg so sánh hai ảnh")).toString()).toBe("so sánh hai ảnh");
  });
  it("chỉ có ảnh thì đặt tên theo ảnh; tin thường không đổi", () => {
    expect(chatTitle(user("@dan/anh-dan-1.png"))).toBe("Ảnh đính kèm");
    expect(chatTitle(user("đọc @src/logo.png giúp"))).toBe("đọc @src/logo.png giúp");
    expect(chatTitle(user(""))).toBe("Cuộc trò chuyện mới");
  });
});
