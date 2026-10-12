import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown";
import { findMath } from "../src/math";

describe("công thức toán trong câu trả lời", () => {
  it("nhận $…$ trong dòng, không nhầm tiền", () => {
    expect(findMath("Với $k=1$ và $x<0$").map((m) => m.tex)).toEqual(["k=1", "x<0"]);
    expect(findMath("giá $5 và $10 hôm nay")).toEqual([]);
    expect(findMath("tốn 5$ rồi 10$ nữa")).toEqual([]);
    expect(findMath("\\(a+b\\) và \\[c\\]").map((m) => [m.tex, m.display])).toEqual([["a+b", false], ["c", true]]);
    expect(findMath("\\$ là ký tự đô la, $x$ mới là công thức").map((m) => m.tex)).toEqual(["x"]);
  });

  it("dựng MathML cho công thức trong dòng; chữ thường quanh nó vẫn được định dạng", () => {
    const h = renderMarkdown("**Câu a)** Với $k \\ge 2$ và $k \\ne 3$: hệ vô nghiệm");
    expect(h).toContain("<strong>Câu a)</strong>");
    expect(h).toContain("<math");
    expect(h).not.toMatch(/\$k/);
    expect(h).toContain("≥");
  });

  it("công thức khối nhiều dòng $$ … $$ với \\begin{cases}", () => {
    const h = renderMarkdown("Hệ trở thành:\n$$\n\\begin{cases}\n\\frac{1}{b} + a = 1 \\\\\n\\frac{1}{c} + b = 1\n\\end{cases}\n$$\nVậy a = b.");
    expect(h).toContain('<div class="math-block">');
    expect(h).toContain("<mfrac");
    expect(h).toContain("<p>Hệ trở thành:</p>");
    expect(h).toContain("Vậy a = b.");
    expect(h.replace(/<annotation[\s\S]*?<\/annotation>/g, "")).not.toContain("\\begin");
  });

  it("$$…$$ trong một dòng, \\[ … \\], và * _ trong công thức không bị hiểu thành in nghiêng", () => {
    expect(renderMarkdown("$$x^2 + y^2 = z^2$$")).toContain("math-block");
    expect(renderMarkdown("\\[\n\\sqrt{a_1 * a_2}\n\\]")).toContain("<msqrt");
    const h = renderMarkdown("Đặt $a_1 * b_2$ rồi *nhấn mạnh*");
    expect(h).toContain("<em>nhấn mạnh</em>");
    expect(h).not.toContain("<em>b_");
  });

  it("an toàn: lệnh nguy hiểm không sinh liên kết/ảnh; không có $ đóng thì để nguyên; mã trong ``` không bị đụng", () => {
    const h = renderMarkdown("$\\href{https://evil.example}{bấm}$ và $\\includegraphics{x.png}$");
    expect(h).not.toMatch(/<a [^>]*href|<img/i);
    expect(renderMarkdown("chi phí $5 mỗi tháng")).toBe("<p>chi phí $5 mỗi tháng</p>");
    expect(renderMarkdown("```\n$$x$$\n```")).toContain("$$x$$");
    expect(renderMarkdown("$$ chưa đóng\nvà tiếp")).not.toContain("math-block");
    expect(renderMarkdown("<script>alert(1)</script> $x$")).not.toContain("<script>");
  });
});
