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

describe("nội dung đa dạng trong câu trả lời", () => {
  it("danh sách lồng nhau, có dòng trống giữa các mục, số bắt đầu, việc cần làm", () => {
    const h = renderMarkdown("1. Một\n\n2. Hai\n   - con a\n   - con b\n3. Ba\n\n- [ ] chưa\n- [x] xong");
    expect(h).toContain("<ol><li>Một</li><li>Hai<ul><li>con a</li><li>con b</li></ul></li><li>Ba</li></ol>");
    expect(h).toContain('<span class="task">☐</span> chưa');
    expect(h).toContain('<span class="task done">☑</span> xong');
    expect(renderMarkdown("3. ba\n4. bốn")).toContain('<ol start="3">');
  });

  it("bảng có canh lề và ô có định dạng, gạch ngang, <br>, thẻ an toàn", () => {
    const h = renderMarkdown("| A | B | C |\n|:--|:-:|--:|\n| **x** | ~~y~~ | a<br>b |");
    expect(h).toContain('<th style="text-align:left">A</th>');
    expect(h).toContain('<th style="text-align:center">B</th>');
    expect(h).toContain('<td style="text-align:right">a<br>b</td>');
    expect(h).toContain("<del>y</del>");
    expect(renderMarkdown("bấm <kbd>Ctrl</kbd>+<kbd>C</kbd>, H<sub>2</sub>O")).toContain("<kbd>Ctrl</kbd>+<kbd>C</kbd>, H<sub>2</sub>O");
    expect(renderMarkdown("<b>mở không đóng")).not.toMatch(/<b>/);
    expect(renderMarkdown('<span style="color:red">x</span>')).not.toMatch(/<span style/);
  });

  it("trích dẫn nhiều dòng và ghi chú [!NOTE]", () => {
    expect(renderMarkdown("> **Lưu ý:** a\n> **Mẹo:** b")).toContain("<blockquote><p><strong>Lưu ý:</strong> a<br><strong>Mẹo:</strong> b</p></blockquote>");
    const h = renderMarkdown("> [!WARNING]\n> Cẩn thận **nhé**\n> - ý 1");
    expect(h).toContain('<div class="callout warning">');
    expect(h).toContain("<strong>nhé</strong>");
    expect(h).toContain("<li>ý 1</li>");
  });

  it("ảnh: ảnh trong dự án hiện tại chỗ; ảnh từ mạng chỉ là liên kết (không tải); đường dẫn lạ bị bỏ", () => {
    expect(renderMarkdown("![Biểu đồ](charts/doanh-thu.png)")).toContain('<img class="md-img" data-path="charts/doanh-thu.png" alt="Biểu đồ">');
    const net = renderMarkdown("![Mẫu](https://example.com/a.png)");
    expect(net).toContain('<a href="https://example.com/a.png"');
    expect(net).not.toContain("<img");
    for (const bad of ["../../etc/x.png", "file:///etc/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.example/x.png"]) expect(renderMarkdown(`![x](${bad})`)).not.toContain("<img");
  });

  it("địa chỉ trần thành liên kết; ngắt trang; mã được tô màu mà vẫn escape", () => {
    expect(renderMarkdown("xem https://neu.edu.vn/a?b=1&c=2, rồi")).toContain('<a href="https://neu.edu.vn/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">https://neu.edu.vn/a?b=1&amp;c=2</a>, rồi');
    expect(renderMarkdown("<<<pagebreak>>>")).toContain('class="pagebreak"');
    const code = renderMarkdown('```js\nconst a = "x<y"; // ghi chú\n```');
    expect(code).toContain('<span class="tk-k">const</span>');
    expect(code).toContain('<span class="tk-s">&quot;x&lt;y&quot;</span>');
    expect(code).toContain('<span class="tk-c">// ghi chú</span>');
    expect(renderMarkdown("```\n<script>alert(1)</script>\n```")).toContain("&lt;script&gt;");
  });
});
