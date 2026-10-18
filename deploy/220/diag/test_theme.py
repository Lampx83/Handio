"""Giao diện chung của các trang quản trị: trang .html tĩnh phải chép đúng report.THEME_CSS và thanh điều hướng report.appbar()
(CSP chỉ cho style nhúng nên không dùng được tệp .css chung); bảng sinh từ charts.table có tiêu đề, cột số căn phải, trạng thái rỗng."""
import os
import re
import unittest

import charts as C
import report as R

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = ("accounts", "quota", "feedback", "shares")


def slurp(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


class Theme(unittest.TestCase):
    def test_static_pages_copy_theme_and_appbar(self):
        for n in PAGES:
            s = slurp(n + ".html")
            m = re.search(r"/\* theme:start[^*]*\*/\n(.*?)\n/\* theme:end \*/", s, re.S)
            self.assertTrue(m, n)
            self.assertEqual(m.group(1), R.THEME_CSS, "%s.html: khối theme lệch report.THEME_CSS — chép lại nguyên khối" % n)
            self.assertIn(R.appbar(n), s, "%s.html: thanh điều hướng lệch report.appbar(%r)" % (n, n))
            self.assertEqual(s.count('aria-current="page"'), 1, n)

    def test_static_pages_have_no_external_or_inline_script(self):
        for n in PAGES:
            s = slurp(n + ".html")
            self.assertEqual(re.findall(r"<script[^>]*>", s), ['<script src="%s.js">' % n], n)
            self.assertNotIn("<link", s)
            self.assertNotIn("http://", s.replace('xmlns="http://www.w3.org/2000/svg"', ""))
            self.assertNotIn("https://", s)

    def test_theme_has_light_and_dark_tokens(self):
        for tok in ("--bg:#f7f8fa", "--accent:#0b4a9e", "--bg:#0f1115", "--accent:#5b9bff", "prefers-color-scheme:dark", "tabular-nums", "position:sticky"):
            self.assertIn(tok, R.THEME_CSS)
        self.assertNotIn("@import", C.CSS)
        self.assertNotIn("url(http", C.CSS)

    def test_table_numeric_columns_and_empty_state(self):
        h = C.table(["Phiên bản", "Lượt", "Lỗi", "Thời gian p50 / p95 (s)"], [["0.7.1", 12, "4.5%", "3 / 9"], ["0.7.0", 3, "—", "—"]])
        self.assertIn("<thead><tr><th>Phiên bản</th><th class=\"num\">Lượt</th><th class=\"num\">Lỗi</th><th class=\"num\">", h)
        self.assertIn("<td>0.7.1</td>", h)                     # phiên bản không phải số
        self.assertIn('<td class="num">4.5%</td>', h)
        self.assertIn('<td class="num">—</td>', h)
        e = C.table(["Mã", "Lượt"], [])
        self.assertIn('<td class="empty" colspan="2">Chưa có dữ liệu.</td>', e)
        self.assertNotIn("<b>", C.table(["x"], [["<b>"]]))  # vẫn thoát HTML


if __name__ == "__main__":
    unittest.main()
