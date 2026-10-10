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


if __name__ == "__main__":
    unittest.main()
