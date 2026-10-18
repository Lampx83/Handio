"""Chặn lỗi "thêm tệp mới nhưng quên đưa vào danh sách cài": mọi mã/trang của dịch vụ chẩn đoán phải nằm trong CODE của install-diag.sh,
và mọi mô-đun mà collector.py nhập phải có mặt trong danh sách đó (lần 0.6.0 từng thiếu feedback.py nên dịch vụ không khởi động)."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def code_list():
    s = open(os.path.join(HERE, "install-diag.sh"), encoding="utf-8").read()
    m = re.search(r'^CODE="([^"]+)"', s, re.M)
    assert m, "không thấy CODE= trong install-diag.sh"
    return set(m.group(1).split())


class Manifest(unittest.TestCase):
    def test_every_deployable_file_is_installed(self):
        installed = code_list()
        local = {f for f in os.listdir(HERE) if re.search(r"\.(py|html|js|json)$", f) and not f.startswith("test_")}
        self.assertEqual(sorted(local - installed), [], "có tệp trong diag/ nhưng install-diag.sh không cài")
        self.assertEqual(sorted(installed - local), [], "install-diag.sh cài tệp không tồn tại")

    def test_imports_of_collector_are_installed(self):
        installed = code_list()
        src = open(os.path.join(HERE, "collector.py"), encoding="utf-8").read()
        mods = set(re.findall(r"^(?:import|from)\s+([a-z_][a-z0-9_]*)", src, re.M))
        local_mods = {f[:-3] for f in os.listdir(HERE) if f.endswith(".py") and not f.startswith("test_")}
        for m in mods & local_mods:
            self.assertIn(m + ".py", installed, "collector.py nhập %s nhưng install-diag.sh không cài nó" % m)

    def test_admin_pages_are_installed(self):
        installed = code_list()
        src = open(os.path.join(HERE, "collector.py"), encoding="utf-8").read()
        for f in re.findall(r'\("([a-z_]+\.(?:html|js))"', src):
            self.assertIn(f, installed, f)

    def test_failed_tests_are_named_in_deploy_log(self):
        # máy chủ chạy kiểm thử bằng root với dữ liệu thật: khi đỏ, nhật ký CI phải có tên bài đỏ (không cần vào máy chủ), không có traceback
        s = open(os.path.join(HERE, "install-diag.sh"), encoding="utf-8").read()
        m = re.search(r"(grep -E '\^\(FAIL\|ERROR\)[^\n]*?cut -c1-200)", s)
        self.assertTrue(m, "install-diag.sh không in tên bài thử đỏ")
        log = 'Traceback (most recent call last):\n  File "/opt/x/test_a.py", line 3, in test_b\n    self.assertEqual(1, 2)\nAssertionError: 1 != 2\n\n' \
              "FAIL: test_b (test_a.A.test_b)\nERROR: test_c (test_a.A.test_c)\nPermissionError: [Errno 13] Permission denied\nsqlite3.OperationalError: no such column: model\nRan 3 tests\n"
        import subprocess, tempfile
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, ".unittest.log"), "w", encoding="utf-8").write(log)
            out = subprocess.run(["bash", "-c", m.group(1)], env={"HERE": d, "PATH": os.environ.get("PATH", "")}, capture_output=True, text=True).stdout
        self.assertIn("FAIL: test_b (test_a.A.test_b)", out)
        self.assertIn("ERROR: test_c", out)
        self.assertIn("AssertionError: 1 != 2", out)
        self.assertIn("PermissionError", out)
        self.assertIn("sqlite3.OperationalError: no such column: model", out)   # tên lỗi có chữ số (lần đầu bị bỏ sót)
        self.assertNotIn("File ", out)
        self.assertNotIn("Ran 3", out)


if __name__ == "__main__":
    unittest.main()
