import type { ProjectTemplate } from "../learning-types";

/** Dự án mẫu để khởi tạo nhanh ("Dự án mới"). Mã chạy được thật sự, đơn giản, có chú thích tiếng Việt. */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "web-ghi-chu",
    name: "Web ghi chú",
    description: "Trang web ghi chú cá nhân bằng HTML/CSS/JavaScript: thêm, xóa, tìm kiếm ghi chú và tự lưu trong trình duyệt.",
    lang: "mixed",
    files: {
      "README.md": `# Web ghi chú

Trang web ghi chú đơn giản: thêm, xóa, tìm kiếm ghi chú. Dữ liệu lưu trong \`localStorage\` của trình duyệt (tắt trang mở lại vẫn còn, nhưng chỉ trên máy và trình duyệt này).

## Cách chạy
Không cần cài gì. Mở tệp \`index.html\` bằng trình duyệt (bấm đúp, hoặc dùng bản xem trước của Handio).

## Các tệp
- \`index.html\`: khung trang (ô nhập, danh sách).
- \`style.css\`: giao diện.
- \`app.js\`: logic (thêm, xóa, tìm, lưu vào localStorage).

## Gợi ý mở rộng
Sửa ghi chú, gắn màu, ghim ghi chú lên đầu, xuất ra tệp văn bản.
`,
      "AGENTS.md": `# Quy ước cho agent (dự án Web ghi chú)

> Tệp ngữ cảnh dự án: Handio, Codex và Cursor đọc \`AGENTS.md\`; Claude Code đọc \`CLAUDE.md\` (nội dung tương đương, có thể sao chép sang).

- Trả lời bằng tiếng Việt, ngắn gọn, giải thích như cho sinh viên năm 1-2.
- Công nghệ: HTML + CSS + JavaScript thuần chạy trong trình duyệt. KHÔNG thêm thư viện hay công cụ build.
- Phong cách: tên biến/hàm tiếng Việt không dấu (camelCase), chú thích tiếng Việt, hàm ngắn, mỗi hàm một việc.
- Hiển thị nội dung người dùng nhập bằng \`textContent\` (không dùng \`innerHTML\`) để tránh chèn mã độc.
- Cách chạy: mở \`index.html\` bằng trình duyệt. Dữ liệu lưu ở \`localStorage\` với khóa \`ghi-chu-v1\`; nếu đổi cấu trúc dữ liệu, đổi khóa hoặc viết bước chuyển đổi, đừng làm mất ghi chú cũ.
- Trước khi sửa lớn: nêu kế hoạch ngắn. Sau khi sửa: nói rõ cần thao tác gì trên trang để tự kiểm tra.
`,
      "index.html": `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ghi chú của tôi</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Ghi chú của tôi</h1>

      <form id="form-ghi-chu">
        <label for="noi-dung">Viết ghi chú mới</label>
        <textarea id="noi-dung" rows="3" placeholder="Hôm nay mình cần nhớ..." required></textarea>
        <button type="submit">Thêm ghi chú</button>
      </form>

      <label for="o-tim">Tìm kiếm</label>
      <input id="o-tim" type="search" placeholder="Gõ để lọc ghi chú..." />

      <p id="thong-bao" aria-live="polite"></p>
      <ul id="danh-sach"></ul>
    </main>

    <script src="app.js"></script>
  </body>
</html>
`,
      "style.css": `/* Giao diện đơn giản, đọc dễ, dùng được trên điện thoại */
body {
  font-family: system-ui, sans-serif;
  background: #f4f5f7;
  color: #222;
  margin: 0;
}

main {
  max-width: 560px;
  margin: 0 auto;
  padding: 16px;
}

textarea,
input[type="search"] {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  margin: 4px 0 8px;
  font: inherit;
  border: 1px solid #bbb;
  border-radius: 6px;
}

button {
  padding: 8px 14px;
  border: 0;
  border-radius: 6px;
  background: #2f6fed;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

button.xoa {
  background: #d64545;
  padding: 4px 10px;
  font-size: 0.85rem;
}

ul {
  list-style: none;
  padding: 0;
}

li {
  background: #fff;
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.thoi-gian {
  display: block;
  color: #777;
  font-size: 0.8rem;
  margin-bottom: 4px;
}

.noi-dung {
  white-space: pre-wrap; /* giữ xuống dòng người dùng gõ */
  margin: 0 0 8px;
}
`,
      "app.js": `// Ứng dụng ghi chú: dữ liệu lưu trong localStorage của trình duyệt.

const KHOA_LUU = "ghi-chu-v1";

// Danh sách ghi chú, mỗi phần tử: { id, noiDung, thoiGian }
let danhSachGhiChu = taiGhiChu();

const form = document.getElementById("form-ghi-chu");
const oNoiDung = document.getElementById("noi-dung");
const oTim = document.getElementById("o-tim");
const thongBao = document.getElementById("thong-bao");
const ul = document.getElementById("danh-sach");

// Đọc ghi chú đã lưu. Nếu chưa có hoặc dữ liệu hỏng thì bắt đầu với danh sách rỗng.
function taiGhiChu() {
  try {
    const duLieu = JSON.parse(localStorage.getItem(KHOA_LUU) || "[]");
    return Array.isArray(duLieu) ? duLieu : [];
  } catch (loi) {
    return [];
  }
}

// Lưu danh sách hiện tại. Có thể thất bại (ví dụ chế độ riêng tư), nên bắt lỗi.
function luuGhiChu() {
  try {
    localStorage.setItem(KHOA_LUU, JSON.stringify(danhSachGhiChu));
  } catch (loi) {
    thongBao.textContent = "Không lưu được vào trình duyệt, ghi chú sẽ mất khi đóng trang.";
  }
}

function themGhiChu(noiDung) {
  const sach = noiDung.trim();
  if (sach === "") return;
  danhSachGhiChu.unshift({
    id: Date.now(), // dùng thời điểm tạo làm mã định danh
    noiDung: sach,
    thoiGian: new Date().toLocaleString("vi-VN"),
  });
  luuGhiChu();
}

function xoaGhiChu(id) {
  danhSachGhiChu = danhSachGhiChu.filter((g) => g.id !== id);
  luuGhiChu();
}

// Vẽ lại danh sách, chỉ hiện các ghi chú chứa từ khóa tìm kiếm.
function veDanhSach() {
  const tuKhoa = oTim.value.trim().toLowerCase();
  const hienThi = danhSachGhiChu.filter((g) => g.noiDung.toLowerCase().includes(tuKhoa));

  ul.textContent = ""; // xóa danh sách cũ
  for (const g of hienThi) {
    const li = document.createElement("li");

    const thoiGian = document.createElement("span");
    thoiGian.className = "thoi-gian";
    thoiGian.textContent = g.thoiGian;

    const noiDung = document.createElement("p");
    noiDung.className = "noi-dung";
    noiDung.textContent = g.noiDung; // textContent: an toàn, không chạy mã HTML

    const nutXoa = document.createElement("button");
    nutXoa.className = "xoa";
    nutXoa.textContent = "Xóa";
    nutXoa.addEventListener("click", () => {
      xoaGhiChu(g.id);
      veDanhSach();
    });

    li.append(thoiGian, noiDung, nutXoa);
    ul.append(li);
  }

  if (danhSachGhiChu.length === 0) thongBao.textContent = "Chưa có ghi chú nào. Hãy viết ghi chú đầu tiên!";
  else if (hienThi.length === 0) thongBao.textContent = "Không có ghi chú nào khớp từ khóa.";
  else thongBao.textContent = "";
}

form.addEventListener("submit", (e) => {
  e.preventDefault(); // không cho trang tải lại
  themGhiChu(oNoiDung.value);
  oNoiDung.value = "";
  veDanhSach();
});

oTim.addEventListener("input", veDanhSach);

veDanhSach();
`,
    },
    startPrompts: [
      "Đọc code dự án này và giải thích ngắn gọn từng tệp làm gì, cách ghi chú được lưu lại sau khi tắt trình duyệt.",
      "Thêm nút \"Sửa\" cho mỗi ghi chú: bấm vào thì đưa nội dung lên ô nhập để chỉnh và lưu lại. Giữ code đơn giản và có chú thích tiếng Việt.",
      "Thêm ô chọn màu cho mỗi ghi chú (vàng, xanh, hồng) và lưu màu cùng ghi chú. Hãy lập kế hoạch ngắn trước khi sửa.",
    ],
  },
  {
    id: "web-bmi",
    name: "Trang tính BMI",
    description: "Trang web tính chỉ số BMI bằng HTML/JavaScript, có hàm tính tách riêng và bộ kiểm thử chạy bằng Node.",
    lang: "mixed",
    files: {
      "README.md": `# Trang tính BMI

Nhập cân nặng (kg) và chiều cao (m), trang tính chỉ số BMI và cho biết thuộc nhóm nào. Đây chỉ là công cụ tham khảo, không thay thế tư vấn của bác sĩ.

## Cách chạy
- Xem trang: mở \`index.html\` bằng trình duyệt.
- Chạy kiểm thử logic: \`node bmi.test.js\` (cần cài Node.js). In "Tất cả kiểm thử đạt" là ổn.

## Các tệp
- \`index.html\`, \`style.css\`: giao diện.
- \`bmi.js\`: hàm \`tinhBMI\`, \`phanLoai\` và phần gắn vào trang.
- \`bmi.test.js\`: kiểm thử các hàm tính.
`,
      "AGENTS.md": `# Quy ước cho agent (dự án Trang tính BMI)

> Tệp ngữ cảnh dự án: Handio, Codex và Cursor đọc \`AGENTS.md\`; Claude Code đọc \`CLAUDE.md\` (nội dung tương đương, có thể sao chép sang).

- Trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu cho sinh viên năm 1-2.
- Công nghệ: HTML + CSS + JavaScript thuần. KHÔNG thêm thư viện hay công cụ build.
- Tách logic và giao diện: hàm tính (\`tinhBMI\`, \`phanLoai\`) là hàm thuần trong \`bmi.js\`, không đụng tới DOM; phần gắn vào trang nằm trong khối \`if (typeof document !== "undefined")\`.
- Mỗi lần sửa logic: cập nhật \`bmi.test.js\` và chạy \`node bmi.test.js\` để chứng minh kết quả đúng.
- Phong cách: tên biến/hàm tiếng Việt không dấu (camelCase), chú thích tiếng Việt.
- Đây là công cụ tham khảo: giữ dòng lưu ý "không thay thế tư vấn y tế" trên trang.
`,
      "index.html": `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tính BMI</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Tính chỉ số BMI</h1>

      <form id="form-bmi">
        <label for="can-nang">Cân nặng (kg)</label>
        <input id="can-nang" type="number" min="1" step="any" required />

        <label for="chieu-cao">Chiều cao (m)</label>
        <input id="chieu-cao" type="number" min="0.5" max="2.5" step="any" required />

        <button type="submit">Tính BMI</button>
      </form>

      <p id="ket-qua" aria-live="polite"></p>
      <p class="luu-y">Chỉ để tham khảo, không thay thế tư vấn của bác sĩ.</p>
    </main>

    <script src="bmi.js"></script>
  </body>
</html>
`,
      "style.css": `body {
  font-family: system-ui, sans-serif;
  background: #eef3f8;
  color: #1c2733;
  margin: 0;
}

main {
  max-width: 420px;
  margin: 24px auto;
  padding: 16px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

label {
  display: block;
  margin-top: 12px;
}

input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  margin-top: 4px;
  font: inherit;
  border: 1px solid #b6c2cf;
  border-radius: 6px;
}

button {
  margin-top: 16px;
  padding: 10px 16px;
  border: 0;
  border-radius: 6px;
  background: #1f7a5a;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

#ket-qua {
  font-size: 1.2rem;
  font-weight: 600;
  min-height: 1.5em;
}

.luu-y {
  color: #6b7a89;
  font-size: 0.85rem;
}
`,
      "bmi.js": `// Logic tính BMI. Các hàm ở đầu tệp là "hàm thuần": chỉ nhận số và trả về kết quả,
// không đụng tới trang web, nên kiểm thử được bằng Node (xem bmi.test.js).

// BMI = cân nặng (kg) / (chiều cao (m) ^ 2), làm tròn 1 chữ số thập phân.
// Trả về null nếu dữ liệu không hợp lệ (không phải số hoặc không dương).
function tinhBMI(canNangKg, chieuCaoM) {
  if (!(canNangKg > 0) || !(chieuCaoM > 0)) return null;
  const bmi = canNangKg / (chieuCaoM * chieuCaoM);
  return Math.round(bmi * 10) / 10;
}

// Phân loại theo ngưỡng thông dụng của Tổ chức Y tế Thế giới (WHO) cho người lớn.
function phanLoai(bmi) {
  if (bmi < 18.5) return "Gầy";
  if (bmi < 25) return "Bình thường";
  if (bmi < 30) return "Thừa cân";
  return "Béo phì";
}

// Phần gắn vào trang web (chỉ chạy khi có document, tức là trong trình duyệt).
if (typeof document !== "undefined") {
  const form = document.getElementById("form-bmi");
  const ketQua = document.getElementById("ket-qua");

  form.addEventListener("submit", (e) => {
    e.preventDefault(); // không cho trang tải lại
    const canNang = Number(document.getElementById("can-nang").value);
    const chieuCao = Number(document.getElementById("chieu-cao").value);
    const bmi = tinhBMI(canNang, chieuCao);
    if (bmi === null) {
      ketQua.textContent = "Vui lòng nhập số dương cho cả hai ô.";
      return;
    }
    ketQua.textContent = "BMI: " + bmi + " (" + phanLoai(bmi) + ")";
  });
}

// Cho phép Node nạp tệp này để kiểm thử.
if (typeof module !== "undefined") {
  module.exports = { tinhBMI, phanLoai };
}
`,
      "bmi.test.js": `// Kiểm thử logic BMI. Chạy:  node bmi.test.js
const { tinhBMI, phanLoai } = require("./bmi.js");

let loi = 0;
function kiemTra(ten, nhanDuoc, mongDoi) {
  if (nhanDuoc === mongDoi) {
    console.log("OK   " + ten);
  } else {
    console.log("LỖI  " + ten + ": nhận được " + nhanDuoc + ", mong đợi " + mongDoi);
    loi++;
  }
}

kiemTra("60 kg, 1.65 m", tinhBMI(60, 1.65), 22);
kiemTra("45 kg, 1.7 m", tinhBMI(45, 1.7), 15.6);
kiemTra("90 kg, 1.7 m", tinhBMI(90, 1.7), 31.1);
kiemTra("chiều cao bằng 0 là không hợp lệ", tinhBMI(60, 0), null);
kiemTra("cân nặng âm là không hợp lệ", tinhBMI(-5, 1.7), null);
kiemTra("không phải số là không hợp lệ", tinhBMI(NaN, 1.7), null);
kiemTra("BMI 18.4 là Gầy", phanLoai(18.4), "Gầy");
kiemTra("BMI 18.5 là Bình thường", phanLoai(18.5), "Bình thường");
kiemTra("BMI 25 là Thừa cân", phanLoai(25), "Thừa cân");
kiemTra("BMI 30 là Béo phì", phanLoai(30), "Béo phì");

if (loi > 0) {
  console.log(loi + " kiểm thử lỗi");
  process.exit(1);
}
console.log("Tất cả kiểm thử đạt");
`,
    },
    startPrompts: [
      "Giải thích công thức BMI trong bmi.js và vì sao hàm tính được tách khỏi phần giao diện. Sau đó chạy `node bmi.test.js` và cho mình biết kết quả.",
      "Thêm lựa chọn đơn vị: nhập chiều cao bằng cm thay vì mét. Hãy cập nhật cả bài kiểm thử trong bmi.test.js.",
      "Thêm bảng phân loại BMI hiển thị dưới kết quả và tô đậm dòng ứng với kết quả của người dùng. Giữ code đơn giản.",
    ],
  },
  {
    id: "py-doan-so",
    name: "Trò chơi đoán số",
    description: "Trò chơi đoán số trên màn hình dòng lệnh bằng Python: máy nghĩ một số, bạn đoán trong số lần giới hạn.",
    lang: "py",
    files: {
      "README.md": `# Trò chơi đoán số

Máy nghĩ ra một số từ 1 đến 100, bạn có tối đa 7 lần đoán. Mỗi lần đoán, máy cho biết số của bạn "quá cao" hay "quá thấp".

## Cách chạy
Cần Python 3.
\`\`\`
python3 main.py
\`\`\`
(Trên Windows có thể dùng \`python main.py\`.)

Chạy kiểm thử logic:
\`\`\`
python3 -m unittest -v
\`\`\`

## Các tệp
- \`main.py\`: trò chơi (logic ở \`danh_gia\`, phần chơi ở \`choi\`).
- \`test_main.py\`: kiểm thử hàm \`danh_gia\`.
`,
      "AGENTS.md": `# Quy ước cho agent (dự án Trò chơi đoán số)

> Tệp ngữ cảnh dự án: Handio, Codex và Cursor đọc \`AGENTS.md\`; Claude Code đọc \`CLAUDE.md\` (nội dung tương đương, có thể sao chép sang).

- Trả lời bằng tiếng Việt, ngắn gọn, giải thích như cho sinh viên năm 1-2.
- Ngôn ngữ: Python 3, chỉ dùng thư viện chuẩn. KHÔNG thêm thư viện ngoài.
- Phong cách: tên biến/hàm tiếng Việt không dấu theo kiểu snake_case, chú thích/docstring tiếng Việt, theo PEP 8 ở mức cơ bản.
- Tách logic khỏi nhập/xuất: hàm logic (như \`danh_gia\`) không gọi \`input()\`/\`print()\`; chỉ \`choi()\` mới tương tác với người dùng. Nhờ đó kiểm thử được.
- Cách chạy: \`python3 main.py\`. Cách kiểm thử: \`python3 -m unittest -v\`. Sau mỗi thay đổi logic hãy thêm/cập nhật test rồi chạy lại.
- Trước khi sửa lớn: nêu kế hoạch ngắn. Sau khi sửa: nói rõ cách tự kiểm tra.
`,
      "main.py": `"""Trò chơi đoán số trên màn hình dòng lệnh.

Chạy:  python3 main.py
"""

import random

SO_NHO_NHAT = 1
SO_LON_NHAT = 100
SO_LAN_TOI_DA = 7


def danh_gia(doan, bi_mat):
    """So sánh số đoán với số bí mật.

    Trả về "thap" (đoán thấp hơn), "cao" (đoán cao hơn) hoặc "dung".
    Hàm này không in/nhập gì nên dễ kiểm thử.
    """
    if doan < bi_mat:
        return "thap"
    if doan > bi_mat:
        return "cao"
    return "dung"


def doc_so(loi_nhac):
    """Hỏi người chơi cho tới khi nhập được một số nguyên."""
    while True:
        van_ban = input(loi_nhac).strip()
        try:
            return int(van_ban)
        except ValueError:
            print("Hãy nhập một số nguyên, ví dụ 42.")


def choi(bi_mat=None):
    """Chơi một ván. Trả về True nếu người chơi đoán đúng."""
    if bi_mat is None:
        bi_mat = random.randint(SO_NHO_NHAT, SO_LON_NHAT)

    print(f"Tôi đang nghĩ một số từ {SO_NHO_NHAT} đến {SO_LON_NHAT}. Bạn có {SO_LAN_TOI_DA} lần đoán.")
    for lan in range(1, SO_LAN_TOI_DA + 1):
        doan = doc_so(f"Lần {lan}/{SO_LAN_TOI_DA} - số của bạn: ")
        ket_qua = danh_gia(doan, bi_mat)
        if ket_qua == "dung":
            print(f"Chính xác! Bạn đoán đúng sau {lan} lần.")
            return True
        print("Số của bạn quá thấp." if ket_qua == "thap" else "Số của bạn quá cao.")

    print(f"Hết lượt rồi. Số bí mật là {bi_mat}.")
    return False


if __name__ == "__main__":
    while True:
        choi()
        tiep = input("Chơi tiếp không? (c/k): ").strip().lower()
        if tiep != "c":
            print("Hẹn gặp lại!")
            break
`,
      "test_main.py": `"""Kiểm thử logic trò chơi. Chạy:  python3 -m unittest -v"""

import unittest

from main import danh_gia


class TestDanhGia(unittest.TestCase):
    def test_doan_thap(self):
        self.assertEqual(danh_gia(10, 50), "thap")

    def test_doan_cao(self):
        self.assertEqual(danh_gia(90, 50), "cao")

    def test_doan_dung(self):
        self.assertEqual(danh_gia(50, 50), "dung")

    def test_sat_bien(self):
        self.assertEqual(danh_gia(49, 50), "thap")
        self.assertEqual(danh_gia(51, 50), "cao")


if __name__ == "__main__":
    unittest.main()
`,
    },
    startPrompts: [
      "Đọc main.py và giải thích cách trò chơi hoạt động. Hàm nào xử lý logic, hàm nào xử lý nhập/xuất? Vì sao tách như vậy?",
      "Thêm lựa chọn độ khó (dễ: 1-50, thường: 1-100, khó: 1-1000) và số lần đoán tối đa tương ứng. Cập nhật cả bài kiểm thử.",
      "Thêm bảng điểm: lưu số lần đoán ít nhất vào tệp JSON và hiển thị khi bắt đầu trò chơi. Hãy lập kế hoạch ngắn trước khi sửa.",
    ],
  },
  {
    id: "py-so-chi-tieu",
    name: "Sổ chi tiêu",
    description: "Sổ chi tiêu dòng lệnh bằng Python: thêm khoản chi, xem danh sách, thống kê theo danh mục; dữ liệu lưu trong tệp JSON.",
    lang: "py",
    files: {
      "README.md": `# Sổ chi tiêu

Chương trình dòng lệnh ghi lại các khoản chi. Dữ liệu lưu trong tệp \`du_lieu.json\` nằm cùng thư mục với chương trình (tạo tự động khi thêm khoản đầu tiên).

## Cách chạy
Cần Python 3.
\`\`\`
python3 so_chi_tieu.py them 35000 an-uong "bún chả"
python3 so_chi_tieu.py them 120000 hoc-tap "sách lập trình"
python3 so_chi_tieu.py ds
python3 so_chi_tieu.py tong
\`\`\`
Kiểm thử logic: \`python3 -m unittest -v\`

## Các lệnh
- \`them <số tiền> <danh mục> [ghi chú]\`: thêm một khoản chi.
- \`ds\`: liệt kê các khoản chi.
- \`tong\`: tổng chi và tổng theo từng danh mục.
`,
      "AGENTS.md": `# Quy ước cho agent (dự án Sổ chi tiêu)

> Tệp ngữ cảnh dự án: Handio, Codex và Cursor đọc \`AGENTS.md\`; Claude Code đọc \`CLAUDE.md\` (nội dung tương đương, có thể sao chép sang).

- Trả lời bằng tiếng Việt, ngắn gọn, giải thích như cho sinh viên năm 1-2.
- Ngôn ngữ: Python 3, chỉ dùng thư viện chuẩn (argparse, json, pathlib, datetime). KHÔNG thêm thư viện ngoài.
- Phong cách: tên biến/hàm tiếng Việt không dấu theo kiểu snake_case, chú thích/docstring tiếng Việt.
- Tách logic khỏi giao diện dòng lệnh: các hàm (\`them_khoan\`, \`tong_theo_danh_muc\`, \`tai\`, \`luu\`) không in ra màn hình; \`main()\` mới in.
- Dữ liệu người dùng là quan trọng: KHÔNG xóa hay ghi đè \`du_lieu.json\` ngoài các lệnh người dùng yêu cầu; khi tệp hỏng phải báo lỗi rõ ràng, không im lặng bỏ dữ liệu.
- Cách chạy: xem README.md. Kiểm thử: \`python3 -m unittest -v\`; thêm test cho mọi thay đổi logic.
- Trước khi sửa lớn: nêu kế hoạch ngắn.
`,
      "so_chi_tieu.py": `"""Sổ chi tiêu dòng lệnh. Dữ liệu lưu trong du_lieu.json (cùng thư mục).

Ví dụ:
    python3 so_chi_tieu.py them 35000 an-uong "bún chả"
    python3 so_chi_tieu.py ds
    python3 so_chi_tieu.py tong
"""

import argparse
import json
from datetime import date
from pathlib import Path

TEP_DU_LIEU = Path(__file__).with_name("du_lieu.json")


def tai(duong_dan=TEP_DU_LIEU):
    """Đọc danh sách khoản chi từ tệp JSON. Chưa có tệp thì trả về danh sách rỗng."""
    if not Path(duong_dan).exists():
        return []
    with open(duong_dan, encoding="utf-8") as f:
        return json.load(f)


def luu(khoan_chi, duong_dan=TEP_DU_LIEU):
    """Ghi danh sách khoản chi ra tệp JSON."""
    with open(duong_dan, "w", encoding="utf-8") as f:
        json.dump(khoan_chi, f, ensure_ascii=False, indent=2)


def them_khoan(khoan_chi, so_tien, danh_muc, ghi_chu=""):
    """Thêm một khoản chi vào danh sách (không in, không lưu tệp). Số tiền phải > 0."""
    if so_tien <= 0:
        raise ValueError("Số tiền phải lớn hơn 0")
    khoan_chi.append(
        {
            "ngay": date.today().isoformat(),
            "so_tien": so_tien,
            "danh_muc": danh_muc,
            "ghi_chu": ghi_chu,
        }
    )


def tong_theo_danh_muc(khoan_chi):
    """Trả về dict {danh_muc: tổng tiền}."""
    ket_qua = {}
    for k in khoan_chi:
        ket_qua[k["danh_muc"]] = ket_qua.get(k["danh_muc"], 0) + k["so_tien"]
    return ket_qua


def dinh_dang_tien(so_tien):
    """35000 -> '35.000 đ'"""
    return f"{so_tien:,.0f}".replace(",", ".") + " đ"


def tao_parser():
    parser = argparse.ArgumentParser(description="Sổ chi tiêu đơn giản")
    con = parser.add_subparsers(dest="lenh", required=True)

    them = con.add_parser("them", help="thêm một khoản chi")
    them.add_argument("so_tien", type=int, help="số tiền (đồng), phải > 0")
    them.add_argument("danh_muc", help="danh mục, ví dụ an-uong")
    them.add_argument("ghi_chu", nargs="?", default="", help="ghi chú (không bắt buộc)")

    con.add_parser("ds", help="liệt kê các khoản chi")
    con.add_parser("tong", help="tổng chi và tổng theo danh mục")
    return parser


def main(argv=None):
    args = tao_parser().parse_args(argv)
    khoan_chi = tai()

    if args.lenh == "them":
        try:
            them_khoan(khoan_chi, args.so_tien, args.danh_muc, args.ghi_chu)
        except ValueError as loi:
            print("Lỗi:", loi)
            return 1
        luu(khoan_chi)
        print("Đã thêm:", dinh_dang_tien(args.so_tien), "-", args.danh_muc)
    elif args.lenh == "ds":
        if not khoan_chi:
            print("Chưa có khoản chi nào.")
        for stt, k in enumerate(khoan_chi, start=1):
            print(f"{stt:>3}. {k['ngay']}  {dinh_dang_tien(k['so_tien']):>12}  {k['danh_muc']}  {k['ghi_chu']}")
    elif args.lenh == "tong":
        print("Tổng chi:", dinh_dang_tien(sum(k["so_tien"] for k in khoan_chi)))
        for dm, tien in sorted(tong_theo_danh_muc(khoan_chi).items(), key=lambda c: -c[1]):
            print(f"  {dm}: {dinh_dang_tien(tien)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`,
      "test_so_chi_tieu.py": `"""Kiểm thử logic sổ chi tiêu. Chạy:  python3 -m unittest -v"""

import tempfile
import unittest
from pathlib import Path

from so_chi_tieu import dinh_dang_tien, luu, tai, them_khoan, tong_theo_danh_muc


class TestSoChiTieu(unittest.TestCase):
    def test_them_va_tong_theo_danh_muc(self):
        ds = []
        them_khoan(ds, 35000, "an-uong", "bún chả")
        them_khoan(ds, 25000, "an-uong")
        them_khoan(ds, 120000, "hoc-tap")
        self.assertEqual(tong_theo_danh_muc(ds), {"an-uong": 60000, "hoc-tap": 120000})

    def test_so_tien_khong_hop_le(self):
        with self.assertRaises(ValueError):
            them_khoan([], 0, "x")
        with self.assertRaises(ValueError):
            them_khoan([], -10, "x")

    def test_luu_va_tai(self):
        ds = []
        them_khoan(ds, 1000, "khac")
        with tempfile.TemporaryDirectory() as thu_muc:
            tep = Path(thu_muc) / "thu.json"
            luu(ds, tep)
            self.assertEqual(tai(tep), ds)

    def test_tai_khi_chua_co_tep(self):
        with tempfile.TemporaryDirectory() as thu_muc:
            self.assertEqual(tai(Path(thu_muc) / "khong-co.json"), [])

    def test_dinh_dang_tien(self):
        self.assertEqual(dinh_dang_tien(35000), "35.000 đ")
        self.assertEqual(dinh_dang_tien(1200000), "1.200.000 đ")


if __name__ == "__main__":
    unittest.main()
`,
    },
    startPrompts: [
      "Đọc so_chi_tieu.py và giải thích dữ liệu được lưu ở đâu, dưới dạng nào. Chuyện gì xảy ra nếu tệp JSON bị hỏng?",
      "Thêm lệnh `xoa <số thứ tự>` để xóa một khoản chi, kèm kiểm thử. Hỏi lại mình nếu có chỗ chưa rõ yêu cầu.",
      "Thêm lệnh `thang <năm-tháng>` thống kê tổng chi theo từng danh mục trong một tháng. Hãy lập kế hoạch ngắn trước khi sửa.",
    ],
  },
  {
    id: "web-quiz",
    name: "Quiz trắc nghiệm",
    description: "Trang quiz trắc nghiệm bằng HTML/CSS/JavaScript: từng câu một, chấm điểm và xem lại kết quả cuối cùng.",
    lang: "mixed",
    files: {
      "README.md": `# Quiz trắc nghiệm

Quiz nhiều câu, mỗi lần hiện một câu. Chọn đáp án để xem đúng/sai ngay, cuối cùng hiện điểm.

## Cách chạy
Mở \`index.html\` bằng trình duyệt. Không cần cài gì.

## Thêm câu hỏi
Mở \`quiz.js\`, thêm một đối tượng vào mảng \`CAU_HOI\`:
\`\`\`js
{ cauHoi: "Nội dung câu hỏi?", luaChon: ["A", "B", "C", "D"], dapAn: 2, giaiThich: "Vì sao đúng" }
\`\`\`
\`dapAn\` là vị trí (bắt đầu từ 0) của lựa chọn đúng.
`,
      "AGENTS.md": `# Quy ước cho agent (dự án Quiz trắc nghiệm)

> Tệp ngữ cảnh dự án: Handio, Codex và Cursor đọc \`AGENTS.md\`; Claude Code đọc \`CLAUDE.md\` (nội dung tương đương, có thể sao chép sang).

- Trả lời bằng tiếng Việt, ngắn gọn, giải thích như cho sinh viên năm 1-2.
- Công nghệ: HTML + CSS + JavaScript thuần. KHÔNG thêm thư viện hay công cụ build.
- Dữ liệu câu hỏi nằm trong mảng \`CAU_HOI\` ở đầu \`quiz.js\`; mỗi câu có \`cauHoi\`, \`luaChon\`, \`dapAn\` (chỉ số bắt đầu từ 0), \`giaiThich\`. Giữ cấu trúc này khi thêm câu.
- Mọi câu hỏi/đáp án/giải thích mới phải đúng sự thật; nếu không chắc, nói rõ và đề nghị người dùng kiểm chứng.
- Hiển thị bằng \`textContent\`, không dùng \`innerHTML\` với dữ liệu động.
- Phong cách: tên biến/hàm tiếng Việt không dấu (camelCase), chú thích tiếng Việt.
- Cách chạy: mở \`index.html\` bằng trình duyệt. Sau khi sửa, nói rõ cần thao tác gì để tự kiểm tra.
`,
      "index.html": `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quiz trắc nghiệm</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Quiz trắc nghiệm</h1>

      <section id="man-cau-hoi">
        <p id="tien-do"></p>
        <h2 id="cau-hoi"></h2>
        <div id="lua-chon"></div>
        <p id="phan-hoi" aria-live="polite"></p>
        <button id="nut-tiep" hidden>Câu tiếp theo</button>
      </section>

      <section id="man-ket-qua" hidden>
        <h2>Kết quả</h2>
        <p id="diem"></p>
        <button id="nut-lam-lai">Làm lại</button>
      </section>
    </main>

    <script src="quiz.js"></script>
  </body>
</html>
`,
      "style.css": `body {
  font-family: system-ui, sans-serif;
  background: #f3f0fa;
  color: #20182e;
  margin: 0;
}

main {
  max-width: 520px;
  margin: 24px auto;
  padding: 16px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

#tien-do {
  color: #6b5f82;
  margin: 0;
}

#lua-chon button {
  display: block;
  width: 100%;
  text-align: left;
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid #c9bfe0;
  border-radius: 8px;
  background: #faf8ff;
  font: inherit;
  cursor: pointer;
}

#lua-chon button:disabled {
  cursor: default;
}

#lua-chon button.dung {
  background: #d9f2e1;
  border-color: #2e9e5b;
}

#lua-chon button.sai {
  background: #fbdcdc;
  border-color: #d64545;
}

#nut-tiep,
#nut-lam-lai {
  margin-top: 12px;
  padding: 10px 16px;
  border: 0;
  border-radius: 6px;
  background: #6c4fd1;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

[hidden] {
  display: none !important;
}
`,
      "quiz.js": `// Quiz trắc nghiệm. Thêm câu hỏi bằng cách thêm một đối tượng vào mảng CAU_HOI.
// dapAn là vị trí (bắt đầu từ 0) của lựa chọn đúng.

const CAU_HOI = [
  {
    cauHoi: "Trong JavaScript, từ khóa nào khai báo biến có thể gán lại giá trị?",
    luaChon: ["const", "let", "static", "final"],
    dapAn: 1,
    giaiThich: "let khai báo biến gán lại được; const khai báo hằng (không gán lại).",
  },
  {
    cauHoi: "Kết quả của 2 + \\"2\\" trong JavaScript là gì?",
    luaChon: ["4", "\\"22\\"", "NaN", "Báo lỗi"],
    dapAn: 1,
    giaiThich: "Cộng số với chuỗi thì số được nối thành chuỗi, nên kết quả là chuỗi \\"22\\".",
  },
  {
    cauHoi: "Thẻ HTML nào dùng để tạo liên kết?",
    luaChon: ["<link>", "<a>", "<href>", "<url>"],
    dapAn: 1,
    giaiThich: "Thẻ <a> kèm thuộc tính href tạo liên kết.",
  },
  {
    cauHoi: "Trong Python, kiểu dữ liệu nào lưu cặp khóa - giá trị?",
    luaChon: ["list", "tuple", "dict", "set"],
    dapAn: 2,
    giaiThich: "dict (từ điển) lưu các cặp khóa - giá trị.",
  },
  {
    cauHoi: "Khi AI viết code cho bạn, việc nào sau đây nên làm trước khi tin dùng?",
    luaChon: ["Chạy và kiểm tra kết quả", "Chép nguyên vào bài nộp", "Xóa hết các chú thích", "Không cần làm gì"],
    dapAn: 0,
    giaiThich: "AI có thể sai. Luôn chạy, thử các trường hợp biên và đọc hiểu trước khi dùng.",
  },
];

let viTri = 0; // câu hiện tại
let diem = 0; // số câu đúng
let daTraLoi = false; // đã chọn đáp án cho câu này chưa

const manCauHoi = document.getElementById("man-cau-hoi");
const manKetQua = document.getElementById("man-ket-qua");
const tienDo = document.getElementById("tien-do");
const cauHoiEl = document.getElementById("cau-hoi");
const luaChonEl = document.getElementById("lua-chon");
const phanHoi = document.getElementById("phan-hoi");
const nutTiep = document.getElementById("nut-tiep");
const diemEl = document.getElementById("diem");
const nutLamLai = document.getElementById("nut-lam-lai");

function hienCauHoi() {
  const cau = CAU_HOI[viTri];
  daTraLoi = false;
  tienDo.textContent = "Câu " + (viTri + 1) + "/" + CAU_HOI.length;
  cauHoiEl.textContent = cau.cauHoi;
  phanHoi.textContent = "";
  nutTiep.hidden = true;
  nutTiep.textContent = viTri === CAU_HOI.length - 1 ? "Xem kết quả" : "Câu tiếp theo";

  luaChonEl.textContent = "";
  cau.luaChon.forEach((chu, i) => {
    const nut = document.createElement("button");
    nut.textContent = chu;
    nut.addEventListener("click", () => chon(i));
    luaChonEl.append(nut);
  });
}

function chon(i) {
  if (daTraLoi) return; // mỗi câu chỉ chọn một lần
  daTraLoi = true;
  const cau = CAU_HOI[viTri];
  const cacNut = luaChonEl.querySelectorAll("button");
  cacNut.forEach((nut) => (nut.disabled = true));
  cacNut[cau.dapAn].classList.add("dung");

  if (i === cau.dapAn) {
    diem++;
    phanHoi.textContent = "Chính xác! " + cau.giaiThich;
  } else {
    cacNut[i].classList.add("sai");
    phanHoi.textContent = "Chưa đúng. " + cau.giaiThich;
  }
  nutTiep.hidden = false;
}

function hienKetQua() {
  manCauHoi.hidden = true;
  manKetQua.hidden = false;
  diemEl.textContent = "Bạn đúng " + diem + "/" + CAU_HOI.length + " câu.";
}

nutTiep.addEventListener("click", () => {
  viTri++;
  if (viTri >= CAU_HOI.length) hienKetQua();
  else hienCauHoi();
});

nutLamLai.addEventListener("click", () => {
  viTri = 0;
  diem = 0;
  manKetQua.hidden = true;
  manCauHoi.hidden = false;
  hienCauHoi();
});

hienCauHoi();
`,
    },
    startPrompts: [
      "Giải thích cách dữ liệu câu hỏi được lưu trong quiz.js và cách trang chuyển từ câu này sang câu khác.",
      "Thêm 5 câu hỏi mới về chủ đề Python cơ bản vào danh sách. Với mỗi câu, hãy nói rõ vì sao đáp án đúng là đúng để mình tự kiểm chứng.",
      "Thêm bộ đếm giờ 20 giây cho mỗi câu; hết giờ thì tự chuyển câu và tính là sai. Hãy lập kế hoạch ngắn trước khi sửa.",
    ],
  },
  {
    id: "py-thong-ke-diem",
    name: "Thống kê điểm từ CSV",
    description: "Chương trình Python đọc bảng điểm CSV, tính trung bình từng sinh viên, thống kê lớp và vẽ biểu đồ cột bằng chữ.",
    lang: "py",
    files: {
      "README.md": `# Thống kê điểm từ CSV

Đọc tệp \`diem.csv\` (cột đầu là tên, các cột sau là điểm từng môn), in điểm trung bình mỗi sinh viên, thống kê của cả lớp và một biểu đồ cột bằng chữ.

## Cách chạy
Cần Python 3.
\`\`\`
python3 thong_ke.py
\`\`\`
Kiểm thử: \`python3 -m unittest -v\`

## Các tệp
- \`diem.csv\`: dữ liệu mẫu (dữ liệu giả). Hãy thay bằng dữ liệu của bạn, giữ dòng tiêu đề.
- \`thong_ke.py\`: chương trình chính.
- \`test_thong_ke.py\`: kiểm thử các hàm tính.

Lưu ý: không đưa dữ liệu cá nhân thật của người khác vào dự án nếu bạn chưa được phép.
`,
      "AGENTS.md": `# Quy ước cho agent (dự án Thống kê điểm từ CSV)

> Tệp ngữ cảnh dự án: Handio, Codex và Cursor đọc \`AGENTS.md\`; Claude Code đọc \`CLAUDE.md\` (nội dung tương đương, có thể sao chép sang).

- Trả lời bằng tiếng Việt, ngắn gọn, giải thích như cho sinh viên năm 1-2.
- Ngôn ngữ: Python 3, chỉ dùng thư viện chuẩn (csv, statistics, pathlib...). KHÔNG thêm pandas hay thư viện ngoài.
- Phong cách: tên biến/hàm tiếng Việt không dấu theo kiểu snake_case, chú thích/docstring tiếng Việt.
- Tách logic khỏi in ấn: các hàm tính toán (\`doc_diem\`, \`trung_binh\`, \`thong_ke_lop\`, \`ve_bieu_do\`) không gọi \`print()\`; \`main()\` mới in.
- Dữ liệu \`diem.csv\` là dữ liệu giả để học; không xóa hay ghi đè tệp người dùng khi không được yêu cầu.
- Xử lý dữ liệu bẩn một cách tường minh (ô trống, ô không phải số): báo rõ dòng nào có vấn đề, đừng im lặng bỏ qua.
- Cách chạy: \`python3 thong_ke.py\`. Kiểm thử: \`python3 -m unittest -v\`; cập nhật test khi đổi logic.
`,
      "diem.csv": `ten,toan,van,anh
An,8,7,9
Binh,5,6,4
Chi,10,9,9
Dung,6.5,7,5
Em,9,8.5,7
Giang,4,5,6
Hoa,7,7,8
Khoa,3,4.5,5
`,
      "thong_ke.py": `"""Đọc bảng điểm CSV, thống kê và vẽ biểu đồ cột bằng chữ.

Chạy:  python3 thong_ke.py
"""

import csv
from pathlib import Path

TEP_DIEM = Path(__file__).with_name("diem.csv")


def doc_diem(duong_dan=TEP_DIEM):
    """Đọc CSV thành list các dict: {"ten": "An", "diem": {"toan": 8.0, ...}}."""
    danh_sach = []
    with open(duong_dan, encoding="utf-8", newline="") as f:
        for so_dong, dong in enumerate(csv.DictReader(f), start=2):  # dòng 1 là tiêu đề
            ten = (dong.get("ten") or "").strip()
            diem = {}
            for mon, gia_tri in dong.items():
                if mon == "ten":
                    continue
                try:
                    diem[mon] = float(gia_tri)
                except (TypeError, ValueError):
                    raise ValueError(f"Dòng {so_dong}: điểm môn '{mon}' của '{ten}' không phải số: {gia_tri!r}")
            danh_sach.append({"ten": ten, "diem": diem})
    return danh_sach


def trung_binh(diem):
    """Trung bình cộng các môn (dict môn -> điểm), làm tròn 2 chữ số; rỗng -> 0."""
    if not diem:
        return 0
    return round(sum(diem.values()) / len(diem), 2)


def thong_ke_lop(danh_sach):
    """Trả về dict gồm trung bình lớp, người cao nhất và thấp nhất."""
    if not danh_sach:
        return {"trung_binh_lop": 0, "cao_nhat": None, "thap_nhat": None}
    tb = {sv["ten"]: trung_binh(sv["diem"]) for sv in danh_sach}
    return {
        "trung_binh_lop": round(sum(tb.values()) / len(tb), 2),
        "cao_nhat": max(tb, key=tb.get),
        "thap_nhat": min(tb, key=tb.get),
    }


def ve_bieu_do(du_lieu, chieu_rong_toi_da=30, diem_toi_da=10):
    """Vẽ biểu đồ cột ngang bằng chữ. du_lieu: dict tên -> điểm. Trả về chuỗi nhiều dòng."""
    dong = []
    do_dai_ten = max((len(t) for t in du_lieu), default=0)
    for ten, gia_tri in du_lieu.items():
        so_o = round(gia_tri / diem_toi_da * chieu_rong_toi_da)
        dong.append(f"{ten:<{do_dai_ten}} | {'#' * so_o} {gia_tri}")
    return "\\n".join(dong)


def main():
    try:
        danh_sach = doc_diem()
    except FileNotFoundError:
        print(f"Không tìm thấy tệp {TEP_DIEM.name}.")
        return 1
    except ValueError as loi:
        print("Dữ liệu có vấn đề:", loi)
        return 1

    tb = {sv["ten"]: trung_binh(sv["diem"]) for sv in danh_sach}
    print("Điểm trung bình từng sinh viên")
    print(ve_bieu_do(tb))

    ket_qua = thong_ke_lop(danh_sach)
    print()
    print("Trung bình lớp:", ket_qua["trung_binh_lop"])
    print("Cao nhất:", ket_qua["cao_nhat"], "-", tb.get(ket_qua["cao_nhat"]))
    print("Thấp nhất:", ket_qua["thap_nhat"], "-", tb.get(ket_qua["thap_nhat"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`,
      "test_thong_ke.py": `"""Kiểm thử các hàm tính. Chạy:  python3 -m unittest -v"""

import tempfile
import unittest
from pathlib import Path

from thong_ke import doc_diem, thong_ke_lop, trung_binh, ve_bieu_do


class TestThongKe(unittest.TestCase):
    def test_trung_binh(self):
        self.assertEqual(trung_binh({"toan": 8, "van": 7, "anh": 9}), 8.0)
        self.assertEqual(trung_binh({"toan": 10, "van": 9, "anh": 9}), 9.33)
        self.assertEqual(trung_binh({}), 0)

    def test_thong_ke_lop(self):
        ds = [
            {"ten": "An", "diem": {"toan": 8, "van": 6}},
            {"ten": "Binh", "diem": {"toan": 4, "van": 6}},
        ]
        kq = thong_ke_lop(ds)
        self.assertEqual(kq["trung_binh_lop"], 6.0)
        self.assertEqual(kq["cao_nhat"], "An")
        self.assertEqual(kq["thap_nhat"], "Binh")

    def test_thong_ke_lop_rong(self):
        self.assertEqual(thong_ke_lop([]), {"trung_binh_lop": 0, "cao_nhat": None, "thap_nhat": None})

    def test_ve_bieu_do(self):
        hinh = ve_bieu_do({"An": 10, "Binh": 5}, chieu_rong_toi_da=10)
        dong = hinh.splitlines()
        self.assertEqual(len(dong), 2)
        self.assertIn("#" * 10, dong[0])
        self.assertIn("#" * 5, dong[1])

    def test_doc_diem_va_loi_du_lieu(self):
        with tempfile.TemporaryDirectory() as thu_muc:
            tep = Path(thu_muc) / "diem.csv"
            tep.write_text("ten,toan\\nAn,8\\nBinh,abc\\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                doc_diem(tep)
            tep.write_text("ten,toan\\nAn,8\\n", encoding="utf-8")
            self.assertEqual(doc_diem(tep), [{"ten": "An", "diem": {"toan": 8.0}}])


if __name__ == "__main__":
    unittest.main()
`,
    },
    startPrompts: [
      "Chạy `python3 thong_ke.py` và giải thích từng phần của kết quả in ra. Hàm nào làm việc gì?",
      "Thêm xếp loại (Giỏi/Khá/Trung bình/Yếu) cho mỗi sinh viên và thống kê số lượng theo loại. Thêm kiểm thử cho phần xếp loại.",
      "Cho phép truyền tên tệp CSV qua dòng lệnh (ví dụ `python3 thong_ke.py diem.csv`) và báo lỗi thân thiện nếu tệp không có hoặc có ô điểm không phải số.",
    ],
  },
  {
    id: "chatbot-streamlit",
    name: "Chatbot Streamlit (Gemini)",
    description: "Chatbot hội thoại có nhớ ngữ cảnh bằng Python: giao diện Streamlit, mô hình Gemini qua thư viện google-genai, khóa API đọc từ biến môi trường hoặc tệp .env.",
    lang: "py",
    files: {
      "README.md": `# Chatbot Streamlit (Gemini)

Chatbot hội thoại có nhớ ngữ cảnh trong cùng một phiên. Giao diện bằng Streamlit, gọi mô hình Gemini qua thư viện \`google-genai\`.

## Chuẩn bị
Cần Python 3.10 trở lên và một khóa API Gemini (tạo trong Google AI Studio; xem tài liệu chính thức của Gemini API để biết cách và hạn mức hiện hành).

1. Tạo môi trường ảo và kích hoạt:
   \`\`\`
   python3 -m venv .venv
   source .venv/bin/activate        # Windows: .venv\\Scripts\\activate
   \`\`\`
2. Cài thư viện:
   \`\`\`
   pip install -r requirements.txt
   \`\`\`
3. Tạo tệp \`.env\` từ mẫu rồi điền khóa của bạn:
   \`\`\`
   cp .env.example .env             # Windows: copy .env.example .env
   \`\`\`
   Mở \`.env\` và thay \`dien-khoa-cua-ban-vao-day\` bằng khóa thật. **Không chia sẻ tệp \`.env\`, không đưa nó lên Git** (đã có sẵn trong \`.gitignore\`). Chỉ chia sẻ \`.env.example\`.

## Chạy
\`\`\`
streamlit run app.py
\`\`\`
Trình duyệt sẽ mở trang (thường là http://localhost:8501). Kiểm tra trí nhớ: nhắn "Tên tôi là Lan", rồi hỏi "Tên tôi là gì?".

## Khi gặp lỗi
- Thiếu khóa: trang sẽ hướng dẫn bạn tạo \`.env\`.
- Lỗi 404 khi gọi mô hình: tên mô hình có thể đã đổi. Tra tài liệu chính thức và sửa hằng \`TEN_MO_HINH\` trong \`app.py\`.
- Mọi lỗi khác: copy nguyên văn thông báo lỗi để hỏi agent hoặc giảng viên.
`,
      "AGENTS.md": `# Quy ước cho agent (dự án Chatbot Streamlit)

> Tệp ngữ cảnh dự án: Handio, Codex và Cursor đọc \`AGENTS.md\`; Claude Code đọc \`CLAUDE.md\` (nội dung tương đương, có thể sao chép sang).

- Trả lời bằng tiếng Việt, ngắn gọn, giải thích như cho sinh viên năm 1-2.
- Ngôn ngữ: Python 3. Thư viện cho phép: \`streamlit\`, \`google-genai\`, \`python-dotenv\` (đã có trong \`requirements.txt\`). KHÔNG thêm thư viện khác khi chưa hỏi; kiểm tra thư viện có thật trước khi đề xuất.
- Cách chạy: kích hoạt \`.venv\`, \`pip install -r requirements.txt\`, \`streamlit run app.py\`.
- **Bảo mật**: KHÔNG bao giờ ghi khóa API vào mã, prompt, README hay lịch sử Git. Khóa chỉ nằm trong \`.env\` (đã bị \`.gitignore\` chặn). KHÔNG đọc hay in nội dung \`.env\`. Khi thêm biến môi trường mới, cập nhật \`.env.example\` bằng giá trị giả.
- Giữ nguyên cách đọc khóa trong \`lay_khoa_api()\` trừ khi được yêu cầu rõ.
- Chỉ làm đúng điều được yêu cầu. Ý tưởng thêm (streaming, nút xóa hội thoại...) thì đề xuất, đừng tự làm.
- Hội thoại nằm trong \`st.session_state.lich_su\` (list các dict \`vai\`, \`noi_dung\`). Hiển thị bằng \`st.markdown\`/\`st.chat_message\`.
- Tên mô hình Gemini thay đổi theo thời gian: lỗi 404 thì tra tài liệu chính thức, đừng đoán.
- Sau mỗi thay đổi, tự chạy kiểm tra cú pháp (\`python3 -m py_compile app.py\`) và nói rõ cần thao tác gì trên trang để kiểm chứng.
- Trước khi sửa lớn: nêu kế hoạch ngắn và chờ xác nhận.
`,
      "requirements.txt": `streamlit>=1.35
google-genai>=1.0
python-dotenv>=1.0
`,
      ".env.example": `# Sao chép tệp này thành .env rồi điền khóa của bạn.
# KHÔNG chia sẻ tệp .env và KHÔNG đưa nó lên Git.
GEMINI_API_KEY=dien-khoa-cua-ban-vao-day
`,
      ".gitignore": `# Bí mật và môi trường cục bộ: không đưa lên Git
.env
.venv/
__pycache__/
*.pyc
`,
      "app.py": `"""Chatbot có nhớ ngữ cảnh (Streamlit + Gemini).

Chạy:  streamlit run app.py
Khóa API được đọc từ biến môi trường GEMINI_API_KEY hoặc tệp .env (không ghi khóa vào mã).
"""

import os

import streamlit as st
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()  # nạp tệp .env (nếu có) vào biến môi trường

# Tên mô hình thay đổi theo thời gian. Nếu gặp lỗi 404, hãy tra tài liệu chính thức và sửa ở đây.
TEN_MO_HINH = "gemini-3.8-flash"

HUONG_DAN_HE_THONG = "Bạn là trợ lý thân thiện, luôn trả lời bằng tiếng Việt, ngắn gọn và rõ ràng."


def lay_khoa_api():
    """Đọc khóa API từ biến môi trường. Trả về chuỗi rỗng nếu chưa có."""
    return os.getenv("GEMINI_API_KEY", "").strip()


@st.cache_resource
def tao_client(khoa):
    """Tạo (và dùng lại) đối tượng kết nối tới Gemini."""
    return genai.Client(api_key=khoa)


def hoi_gemini(client, lich_su):
    """Gửi toàn bộ lịch sử cho mô hình và trả về câu trả lời.

    lich_su là list các dict: {"vai": "user" hoặc "model", "noi_dung": "..."}.
    Gửi cả lịch sử mỗi lần chính là cách chatbot "nhớ" ngữ cảnh.
    """
    noi_dung = [types.Content(role=m["vai"], parts=[types.Part(text=m["noi_dung"])]) for m in lich_su]
    phan_hoi = client.models.generate_content(
        model=TEN_MO_HINH,
        contents=noi_dung,
        config=types.GenerateContentConfig(system_instruction=HUONG_DAN_HE_THONG),
    )
    return phan_hoi.text or ""


def hien_huong_dan_thieu_khoa():
    st.error("Chưa tìm thấy GEMINI_API_KEY.")
    st.markdown(
        "1. Sao chép \`.env.example\` thành \`.env\`.\\n"
        "2. Mở \`.env\`, thay \`dien-khoa-cua-ban-vao-day\` bằng khóa Gemini của bạn.\\n"
        "3. Lưu tệp rồi tải lại trang (hoặc khởi động lại \`streamlit run app.py\`).\\n\\n"
        "Không chia sẻ tệp \`.env\` và không đưa nó lên Git."
    )


def main():
    st.set_page_config(page_title="Chatbot", layout="centered")
    st.title("Chatbot có nhớ ngữ cảnh")

    khoa = lay_khoa_api()
    if not khoa:
        hien_huong_dan_thieu_khoa()
        st.stop()

    # Lịch sử hội thoại nằm trong session_state: còn nguyên khi trang chạy lại sau mỗi lần nhắn.
    if "lich_su" not in st.session_state:
        st.session_state.lich_su = []

    for m in st.session_state.lich_su:
        with st.chat_message("user" if m["vai"] == "user" else "assistant"):
            st.markdown(m["noi_dung"])

    cau_hoi = st.chat_input("Nhập tin nhắn...")
    if not cau_hoi:
        return

    st.session_state.lich_su.append({"vai": "user", "noi_dung": cau_hoi})
    with st.chat_message("user"):
        st.markdown(cau_hoi)

    with st.chat_message("assistant"):
        try:
            tra_loi = hoi_gemini(tao_client(khoa), st.session_state.lich_su)
        except Exception as loi:  # hiện nguyên văn lỗi để người dùng sao chép khi hỏi nhờ
            st.session_state.lich_su.pop()  # bỏ câu hỏi chưa được trả lời
            st.error(f"Lỗi khi gọi Gemini: {loi}")
            return
        st.markdown(tra_loi)
    st.session_state.lich_su.append({"vai": "model", "noi_dung": tra_loi})


main()
`,
    },
    startPrompts: [
      "Trong @app.py, thêm ô chọn vai trò ở thanh bên với 3 vai trò: Trợ lý học lập trình, Gia sư tiếng Anh, Người phỏng vấn tuyển dụng. Mỗi vai trò có system instruction riêng, luôn trả lời bằng tiếng Việt; đổi vai trò thì xóa hội thoại. Không thay đổi cách đọc API key. Lập kế hoạch trước và dừng lại trước khi sửa mã để mình rà soát.",
      "Đọc @app.py và @AGENTS.md rồi giải thích: lịch sử hội thoại được lưu ở đâu, khóa API được đọc thế nào, và nếu thiếu khóa thì người dùng thấy gì. Chưa sửa gì cả.",
      "(Dùng trong thư mục trống) Tạo chatbot hội thoại bằng Streamlit và thư viện google-genai (mô hình Gemini). Yêu cầu: (1) mã trong app.py; (2) đọc GEMINI_API_KEY từ biến môi trường hoặc tệp .env, nếu thiếu thì hiện hướng dẫn trên giao diện, KHÔNG ghi khóa vào mã; (3) chatbot nhớ ngữ cảnh, lưu lịch sử trong st.session_state; (4) tạo requirements.txt và .env.example (không chứa khóa thật); (5) cuối cùng cho mình biết các lệnh để chạy thử. Chỉ làm đúng các việc trên.",
    ],
  },
];
