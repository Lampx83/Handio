import type { Exercise } from "../learning-types";

/** Phần mở đầu dùng chung của các tệp chấm (giao thức PASS/FAIL: xem learning-types.ts). */
const PRELUDE_JS = `// ====== Phần chấm tự động (bạn không cần sửa tệp này) ======
// Chạy:  node check.js
// Mỗi bài kiểm tra in "PASS <tên>" hoặc "FAIL <tên>: <lý do>"; thoát mã 1 nếu còn bài chưa đạt.
let coLoi = false;

function hienThi(v) {
  if (v === undefined) return "undefined";
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function bangNhau(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && bangNhau(a[k], b[k]));
  }
  return false;
}

function motDong(s) {
  return String(s).replace(/\\s+/g, " ").trim();
}

function baoLoi(ten, lyDo) {
  console.log("FAIL " + ten + ": " + motDong(lyDo));
  coLoi = true;
}

function loiCuaNgoaiLe(e) {
  return e && e.message ? e.message : String(e);
}

// kiemTra(tên, () => giá trị nhận được, giá trị mong đợi)
function kiemTra(ten, chay, mongDoi) {
  try {
    const nhan = chay();
    if (bangNhau(nhan, mongDoi)) console.log("PASS " + ten);
    else baoLoi(ten, "nhận được " + hienThi(nhan) + ", mong đợi " + hienThi(mongDoi));
  } catch (e) {
    baoLoi(ten, "gặp lỗi khi chạy - " + loiCuaNgoaiLe(e));
  }
}

// Báo PASS nếu dieuKien() trả về true; ngược lại FAIL với lý do.
function kiemTraDieuKien(ten, dieuKien, lyDoNeuSai) {
  try {
    if (dieuKien()) console.log("PASS " + ten);
    else baoLoi(ten, lyDoNeuSai);
  } catch (e) {
    baoLoi(ten, "gặp lỗi khi chạy - " + loiCuaNgoaiLe(e));
  }
}

function ketThuc() {
  process.exit(coLoi ? 1 : 0);
}

// Nạp một tệp của bạn (vd "./main.js"); nếu tệp bị lỗi cú pháp thì báo FAIL và dừng.
function napTep(tep) {
  try {
    return require(tep);
  } catch (e) {
    baoLoi("tải " + tep, tep + " bị lỗi - " + loiCuaNgoaiLe(e));
    ketThuc();
  }
}

// Lấy một hàm đã xuất trong module; báo lỗi rõ ràng nếu thiếu.
function lay(mo, ten) {
  if (!mo || typeof mo[ten] !== "function") throw new Error("không thấy hàm " + ten + " (nhớ ghi nó vào module.exports ở cuối tệp)");
  return mo[ten];
}
`;
const PRELUDE_PY = `# ====== Phần chấm tự động (bạn không cần sửa tệp này) ======
# Chạy:  python3 check.py   (trên Windows: python check.py)
# Mỗi bài kiểm tra in "PASS <tên>" hoặc "FAIL <tên>: <lý do>"; thoát mã 1 nếu còn bài chưa đạt.
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

co_loi = False


def mot_dong(s):
    return " ".join(str(s).split())


def bao_loi(ten, ly_do):
    global co_loi
    print("FAIL " + ten + ": " + mot_dong(ly_do))
    co_loi = True


def la_so(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def bang_nhau(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if la_so(a) and la_so(b):
        return abs(a - b) < 1e-9
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(bang_nhau(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a.keys()) == set(b.keys()) and all(bang_nhau(a[k], b[k]) for k in a)
    return a == b


def kiem_tra(ten, chay, mong_doi):
    """kiem_tra(tên, lambda: giá trị nhận được, giá trị mong đợi)"""
    try:
        nhan = chay()
        if bang_nhau(nhan, mong_doi):
            print("PASS " + ten)
        else:
            bao_loi(ten, "nhận được " + repr(nhan) + ", mong đợi " + repr(mong_doi))
    except Exception as e:
        bao_loi(ten, "gặp lỗi khi chạy - " + type(e).__name__ + ": " + str(e))


def kiem_tra_dieu_kien(ten, dieu_kien, ly_do_neu_sai):
    """PASS nếu dieu_kien() trả về True; ngược lại FAIL với lý do."""
    try:
        if dieu_kien():
            print("PASS " + ten)
        else:
            bao_loi(ten, ly_do_neu_sai)
    except Exception as e:
        bao_loi(ten, "gặp lỗi khi chạy - " + type(e).__name__ + ": " + str(e))


try:
    import main
except (Exception, SystemExit) as e:
    bao_loi("tải main.py", "main.py bị lỗi - " + type(e).__name__ + ": " + str(e))
    sys.exit(1)


def lay(ten):
    ham = getattr(main, ten, None)
    if ham is None:
        raise AttributeError("không thấy " + ten + " trong main.py")
    return ham


def ket_thuc():
    sys.exit(1 if co_loi else 0)
`;

/** Bài tập có chấm tự động. */
export const EXERCISES: Exercise[] = [
  {
    id: "js-01-tong-trung-binh",
    lang: "js",
    level: 1,
    title: "Tổng và trung bình của mảng",
    goal: "Duyệt một mảng số bằng vòng lặp để tính tổng và trung bình cộng, kể cả khi mảng rỗng.",
    instructions: `# Tổng và trung bình của mảng

## Bối cảnh
Bạn đang viết phần mềm nhỏ để tính điểm cho một lớp học. Việc đầu tiên: từ một mảng điểm, tính **tổng** và **điểm trung bình**.

## Yêu cầu
Mở \`main.js\` và hoàn thành hai hàm:

- \`tong(mang)\`: trả về tổng các phần tử. Mảng rỗng thì trả về \`0\`.
- \`trungBinh(mang)\`: trả về trung bình cộng. Mảng rỗng thì trả về \`0\` (không được ra \`NaN\`).

## Ví dụ vào/ra
| Gọi hàm | Kết quả |
| --- | --- |
| \`tong([1, 2, 3])\` | \`6\` |
| \`tong([])\` | \`0\` |
| \`trungBinh([2, 4, 6])\` | \`4\` |
| \`trungBinh([1, 2])\` | \`1.5\` |
| \`trungBinh([])\` | \`0\` |

## Ràng buộc
- Không sửa mảng đầu vào (không \`push\`, \`sort\`, \`splice\` lên nó).
- Chỉ dùng JavaScript thuần, không cài thêm thư viện.
- Giữ dòng \`module.exports\` ở cuối \`main.js\`.

## Cách hỏi AI cho tốt
Đừng dán nguyên đề rồi xin "làm giúp". Hãy thử: *"Giải thích cho mình cách duyệt mảng để cộng dồn trong JavaScript, kèm 1 ví dụ nhỏ KHÔNG phải bài này"*, rồi tự viết. Sau khi AI gợi ý, hỏi tiếp: *"Nếu mảng rỗng thì hàm của bạn trả về gì? Vì sao?"*

## Cách tự kiểm tra
Chạy trong thư mục bài: \`node check.js\`. Mỗi dòng \`PASS\` là một ý đã đúng, mỗi dòng \`FAIL\` cho biết bạn nhận được gì và mong đợi gì.`,
    files: {
      "main.js": `// Bài 1: Tổng và trung bình của mảng số.
// Chạy kiểm tra:  node check.js

// Trả về tổng các phần tử của mảng. Mảng rỗng -> 0.
function tong(mang) {
  // TODO: viết code ở đây
}

// Trả về trung bình cộng. Mảng rỗng -> 0 (không để ra NaN).
function trungBinh(mang) {
  // TODO: viết code ở đây (gợi ý: có thể gọi lại hàm tong)
}

module.exports = { tong, trungBinh };
`,
      "check.js": `${PRELUDE_JS}

const main = napTep("./main.js");
const tong = (a) => lay(main, "tong")(a);
const trungBinh = (a) => lay(main, "trungBinh")(a);

kiemTra("tong([1, 2, 3])", () => tong([1, 2, 3]), 6);
kiemTra("tong([]) là 0", () => tong([]), 0);
kiemTra("tong có số âm", () => tong([-5, 5, 10]), 10);
kiemTra("tong có số lẻ", () => tong([0.5, 0.25]), 0.75);
kiemTra("trungBinh([2, 4, 6])", () => trungBinh([2, 4, 6]), 4);
kiemTra("trungBinh([1, 2]) là 1.5", () => trungBinh([1, 2]), 1.5);
kiemTra("trungBinh một phần tử", () => trungBinh([7]), 7);
kiemTra("trungBinh([]) là 0, không phải NaN", () => trungBinh([]), 0);
kiemTraDieuKien(
  "không sửa mảng đầu vào",
  () => {
    const a = [3, 1, 2];
    tong(a);
    trungBinh(a);
    return bangNhau(a, [3, 1, 2]);
  },
  "mảng đầu vào đã bị thay đổi sau khi gọi hàm"
);

ketThuc();
`,
    },
    check: "check.js",
    solution: {
      "main.js": `// Bài 1: Tổng và trung bình của mảng số.

function tong(mang) {
  let ketQua = 0;
  for (const x of mang) {
    ketQua += x;
  }
  return ketQua;
}

function trungBinh(mang) {
  if (mang.length === 0) return 0;
  return tong(mang) / mang.length;
}

module.exports = { tong, trungBinh };
`,
    },
    hints: [
      "Bắt đầu bằng một biến `ketQua = 0`, rồi cộng từng phần tử của mảng vào đó (vòng lặp `for...of` hoặc `reduce`).",
      "Trung bình cộng = tổng chia cho số phần tử. Bạn đã có hàm `tong` rồi, hãy gọi lại nó thay vì viết lại.",
      "Chú ý mảng rỗng: chia cho 0 sẽ ra `NaN`. Hãy kiểm tra `mang.length === 0` trước và trả về 0.",
      "Nếu vẫn lỗi, chạy `node check.js` và đọc dòng FAIL: nó cho biết bạn nhận được gì và đề bài mong đợi gì. Thử tự gọi hàm với mảng đó bằng `console.log`.",
    ],
    concepts: ["mảng","vòng lặp","hàm","trường hợp biên"],
    minutes: 10,
  },
  {
    id: "js-02-dao-chuoi-dem-tu",
    lang: "js",
    level: 1,
    title: "Đảo chuỗi và đếm từ",
    goal: "Xử lý chuỗi: đảo ngược một chuỗi và đếm số từ, kể cả khi có nhiều khoảng trắng thừa.",
    instructions: `# Đảo chuỗi và đếm từ

## Bối cảnh
Bạn làm công cụ nhỏ cho một ứng dụng ghi chú: cần đảo ngược một đoạn chữ (để làm trò chơi mật mã) và đếm số từ của ghi chú.

## Yêu cầu
Trong \`main.js\`, hoàn thành:

- \`daoChuoi(s)\`: trả về chuỗi đảo ngược.
- \`demTu(s)\`: trả về số từ. Từ là các cụm ký tự cách nhau bởi một hay nhiều khoảng trắng (dấu cách, tab, xuống dòng). Khoảng trắng đầu/cuối không tạo ra từ.

## Ví dụ vào/ra
| Gọi hàm | Kết quả |
| --- | --- |
| \`daoChuoi("abc")\` | \`"cba"\` |
| \`daoChuoi("Chào")\` | \`"oàhC"\` |
| \`daoChuoi("")\` | \`""\` |
| \`demTu("xin chào bạn")\` | \`3\` |
| \`demTu("  xin   chào  ")\` | \`2\` |
| \`demTu("")\` | \`0\` |
| \`demTu("   ")\` | \`0\` |

## Ràng buộc
- Chỉ dùng JavaScript thuần.
- Hàm không được in ra màn hình, chỉ \`return\`.
- Giữ \`module.exports\` ở cuối tệp.

## Cách hỏi AI cho tốt
Hãy mô tả cả *trường hợp khó*: "Hàm đếm từ của mình trả về 4 cho chuỗi \`'a  b'\`, mình mong đợi 2. Giải thích vì sao \`split(' ')\` gây ra chuyện này?" Hỏi nguyên nhân sẽ giúp bạn học hơn là xin code mới.

## Cách tự kiểm tra
\`node check.js\`. Tự thử thêm vài chuỗi lạ (chuỗi rỗng, nhiều dấu cách, có xuống dòng) bằng \`console.log(demTu("..."))\`.`,
    files: {
      "main.js": `// Bài 2: Đảo chuỗi và đếm từ.
// Chạy kiểm tra:  node check.js

// Đảo ngược chuỗi: "abc" -> "cba"
function daoChuoi(s) {
  // TODO
}

// Đếm số từ. "  xin   chào  " -> 2 ; "" -> 0
function demTu(s) {
  // TODO
}

module.exports = { daoChuoi, demTu };
`,
      "check.js": `${PRELUDE_JS}

const main = napTep("./main.js");
const daoChuoi = (s) => lay(main, "daoChuoi")(s);
const demTu = (s) => lay(main, "demTu")(s);

kiemTra('daoChuoi("abc")', () => daoChuoi("abc"), "cba");
kiemTra('daoChuoi("Chào")', () => daoChuoi("Chào"), "oàhC");
kiemTra("daoChuoi chuỗi rỗng", () => daoChuoi(""), "");
kiemTra("daoChuoi có dấu cách", () => daoChuoi("a b c"), "c b a");
kiemTra('demTu("xin chào bạn")', () => demTu("xin chào bạn"), 3);
kiemTra("demTu nhiều dấu cách thừa", () => demTu("  xin   chào  "), 2);
kiemTra("demTu chuỗi rỗng là 0", () => demTu(""), 0);
kiemTra("demTu chuỗi chỉ có dấu cách là 0", () => demTu("   "), 0);
kiemTra("demTu với tab và xuống dòng", () => demTu("a\\tb\\nc"), 3);
kiemTra("demTu một từ", () => demTu("lập-trình"), 1);

ketThuc();
`,
    },
    check: "check.js",
    solution: {
      "main.js": `// Bài 2: Đảo chuỗi và đếm từ.

function daoChuoi(s) {
  return s.split("").reverse().join("");
}

function demTu(s) {
  const gon = s.trim();
  if (gon === "") return 0;
  return gon.split(/\\s+/).length;
}

module.exports = { daoChuoi, demTu };
`,
    },
    hints: [
      "Chuỗi trong JavaScript không có hàm đảo trực tiếp. Hãy nghĩ cách biến chuỗi thành mảng ký tự, đảo mảng, rồi ghép lại.",
      "Với `demTu`: `\"a b\".split(\" \")` cho 2 phần tử, nhưng `\"a  b\".split(\" \")` (hai dấu cách) lại cho 3 phần tử, trong đó có chuỗi rỗng. Có cách nào cắt theo *một hoặc nhiều* khoảng trắng không?",
      "Hãy tìm hiểu `trim()` và biểu thức chính quy `/\\s+/` (một hay nhiều khoảng trắng, gồm cả tab và xuống dòng). Nhớ trường hợp chuỗi rỗng hoặc chỉ toàn dấu cách: kết quả phải là 0.",
      "Cấu trúc gợi ý cho `demTu`: cắt bỏ khoảng trắng hai đầu; nếu chuỗi rỗng thì trả 0; nếu không thì tách theo `/\\s+/` và lấy độ dài mảng.",
    ],
    concepts: ["chuỗi","split/join","khoảng trắng","trường hợp biên"],
    minutes: 12,
  },
  {
    id: "js-03-so-nguyen-to",
    lang: "js",
    level: 2,
    title: "Số nguyên tố",
    goal: "Kiểm tra số nguyên tố và liệt kê các số nguyên tố nhỏ hơn hoặc bằng n, chú ý các trường hợp biên (0, 1, số âm, số lẻ thập phân).",
    instructions: `# Số nguyên tố

## Bối cảnh
Bạn viết một mini-thư viện toán cho câu lạc bộ lập trình. Bài này là kinh điển: số nguyên tố, và nó là ví dụ tốt để học cách nghĩ về các **trường hợp biên**.

## Yêu cầu
Trong \`main.js\`:

- \`laSoNguyenTo(n)\`: trả về \`true\` nếu \`n\` là số nguyên tố, ngược lại \`false\`. Số âm, \`0\`, \`1\` và số không nguyên (như \`2.5\`) đều **không** là số nguyên tố.
- \`lietKeNguyenTo(n)\`: trả về mảng tăng dần các số nguyên tố nhỏ hơn hoặc bằng \`n\`. Nếu \`n < 2\` thì trả về mảng rỗng.

## Ví dụ vào/ra
| Gọi hàm | Kết quả |
| --- | --- |
| \`laSoNguyenTo(2)\` | \`true\` |
| \`laSoNguyenTo(17)\` | \`true\` |
| \`laSoNguyenTo(1)\` | \`false\` |
| \`laSoNguyenTo(25)\` | \`false\` |
| \`lietKeNguyenTo(10)\` | \`[2, 3, 5, 7]\` |
| \`lietKeNguyenTo(1)\` | \`[]\` |

## Ràng buộc
- Hàm phải trả lời \`laSoNguyenTo(1000003)\` nhanh (dưới một giây): đừng thử chia tất cả số từ 2 đến n - 1 một cách thừa thãi.
- Chỉ dùng JavaScript thuần.

## Cách hỏi AI cho tốt
Hãy cho AI biết bạn muốn *hiểu* chứ không chỉ lấy code: "Hãy giải thích vì sao khi kiểm tra số nguyên tố chỉ cần thử đến căn bậc hai của n. Dùng n = 36 và n = 37 làm ví dụ." Sau đó **tự đoán** hàm trả về gì với 49, 1, 0 trước khi chạy.

## Cách tự kiểm tra
\`node check.js\`. Tự thử thêm: \`console.log(lietKeNguyenTo(50))\` và đối chiếu với danh sách số nguyên tố bạn biết.`,
    files: {
      "main.js": `// Bài 3: Số nguyên tố.
// Chạy kiểm tra:  node check.js

// true nếu n là số nguyên tố. 0, 1, số âm, số lẻ thập phân -> false.
function laSoNguyenTo(n) {
  // TODO
}

// Mảng các số nguyên tố <= n, tăng dần. n < 2 -> []
function lietKeNguyenTo(n) {
  // TODO
}

module.exports = { laSoNguyenTo, lietKeNguyenTo };
`,
      "check.js": `${PRELUDE_JS}

const main = napTep("./main.js");
const laSoNguyenTo = (n) => lay(main, "laSoNguyenTo")(n);
const lietKe = (n) => lay(main, "lietKeNguyenTo")(n);

kiemTra("laSoNguyenTo(2) là true", () => laSoNguyenTo(2), true);
kiemTra("laSoNguyenTo(17) là true", () => laSoNguyenTo(17), true);
kiemTra("laSoNguyenTo(97) là true", () => laSoNguyenTo(97), true);
kiemTra("laSoNguyenTo(25) là false", () => laSoNguyenTo(25), false);
kiemTra("laSoNguyenTo(49) là false", () => laSoNguyenTo(49), false);
kiemTra("laSoNguyenTo(1) là false", () => laSoNguyenTo(1), false);
kiemTra("laSoNguyenTo(0) là false", () => laSoNguyenTo(0), false);
kiemTra("laSoNguyenTo(-7) là false", () => laSoNguyenTo(-7), false);
kiemTra("laSoNguyenTo(2.5) là false", () => laSoNguyenTo(2.5), false);
kiemTra("lietKeNguyenTo(10)", () => lietKe(10), [2, 3, 5, 7]);
kiemTra("lietKeNguyenTo(2)", () => lietKe(2), [2]);
kiemTra("lietKeNguyenTo(1) là mảng rỗng", () => lietKe(1), []);
kiemTra("lietKeNguyenTo(30)", () => lietKe(30), [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
kiemTra("có 25 số nguyên tố <= 100", () => lietKe(100).length, 25);
kiemTraDieuKien(
  "laSoNguyenTo(1000003) đủ nhanh",
  () => {
    const t = Date.now();
    const kq = laSoNguyenTo(1000003);
    return kq === true && Date.now() - t < 1000;
  },
  "1000003 là số nguyên tố, hàm phải trả true trong dưới 1 giây"
);

ketThuc();
`,
    },
    check: "check.js",
    solution: {
      "main.js": `// Bài 3: Số nguyên tố.

function laSoNguyenTo(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

function lietKeNguyenTo(n) {
  const kq = [];
  for (let i = 2; i <= n; i++) {
    if (laSoNguyenTo(i)) kq.push(i);
  }
  return kq;
}

module.exports = { laSoNguyenTo, lietKeNguyenTo };
`,
    },
    hints: [
      "Số nguyên tố là số nguyên lớn hơn 1, chỉ chia hết cho 1 và chính nó. Hãy xử lý riêng các số nhỏ hơn 2 và số không nguyên (dùng `Number.isInteger`).",
      "Để kiểm tra n, thử chia cho các số từ 2 đến n - 1: nếu có số nào chia hết (`n % i === 0`) thì n không phải số nguyên tố.",
      "Chỉ cần thử các ước đến căn bậc hai của n (`i * i <= n`). Vì sao như vậy? Hãy hỏi AI giải thích bằng ví dụ n = 36.",
      "`lietKeNguyenTo(n)` có thể chạy vòng lặp từ 2 đến n và gọi lại `laSoNguyenTo` cho từng số, đẩy số đạt vào mảng kết quả.",
    ],
    concepts: ["vòng lặp","điều kiện","trường hợp biên","tối ưu căn bậc hai"],
    minutes: 15,
  },
  {
    id: "js-04-xep-loai-diem",
    lang: "js",
    level: 2,
    title: "Xếp loại điểm",
    goal: "Dùng điều kiện nhiều nhánh để xếp loại một điểm, bác bỏ dữ liệu không hợp lệ, rồi thống kê số lượng theo loại.",
    instructions: `# Xếp loại điểm

## Bối cảnh
Giảng viên có một danh sách điểm thang 10 và muốn biết mỗi điểm thuộc loại nào, cũng như lớp có bao nhiêu bạn mỗi loại.

## Yêu cầu
Trong \`main.js\`:

- \`xepLoai(diem)\` trả về một trong các chuỗi:
  - từ 9 đến 10: \`"Xuất sắc"\`
  - từ 8 (gồm 8) đến dưới 9: \`"Giỏi"\`
  - từ 6.5 đến dưới 8: \`"Khá"\`
  - từ 5 đến dưới 6.5: \`"Trung bình"\`
  - từ 0 đến dưới 5: \`"Yếu"\`
  - không phải số, \`NaN\`, nhỏ hơn 0 hoặc lớn hơn 10: \`"Không hợp lệ"\`
- \`thongKeXepLoai(dsDiem)\` trả về đối tượng đếm số điểm theo từng loại. Luôn có đủ 5 khóa \`"Xuất sắc"\`, \`"Giỏi"\`, \`"Khá"\`, \`"Trung bình"\`, \`"Yếu"\`; điểm không hợp lệ **bị bỏ qua**, không đếm.

## Ví dụ vào/ra
\`\`\`js
xepLoai(8.5)    // "Giỏi"
xepLoai(6.4)    // "Trung bình"
xepLoai(11)     // "Không hợp lệ"
thongKeXepLoai([9, 8, 7, 5, 3, 10, -2, "x"])
// { "Xuất sắc": 2, "Giỏi": 1, "Khá": 1, "Trung bình": 1, "Yếu": 1 }
\`\`\`

## Ràng buộc
- Không lặp lại các ngưỡng điểm ở hai nơi: \`thongKeXepLoai\` phải gọi \`xepLoai\`.
- Chỉ dùng JavaScript thuần.

## Cách hỏi AI cho tốt
Đưa cho AI **bảng ngưỡng** như trên thay vì nói "xếp loại điểm". Sau khi có code, hỏi: "Những giá trị nào ở sát ngưỡng (7.99, 8, 8.01, 6.5) sẽ ra loại gì? Hãy liệt kê và giải thích." Rồi tự kiểm lại bằng \`node check.js\`.

## Cách tự kiểm tra
\`node check.js\`. Các điểm sát ngưỡng như 8, 6.5, 5 thường là chỗ sai nhất.`,
    files: {
      "main.js": `// Bài 4: Xếp loại điểm.
// Chạy kiểm tra:  node check.js

// Trả về "Xuất sắc" | "Giỏi" | "Khá" | "Trung bình" | "Yếu" | "Không hợp lệ"
function xepLoai(diem) {
  // TODO
}

// Đếm số điểm theo từng loại; bỏ qua điểm không hợp lệ.
// Kết quả luôn có đủ 5 khóa: "Xuất sắc", "Giỏi", "Khá", "Trung bình", "Yếu"
function thongKeXepLoai(dsDiem) {
  // TODO
}

module.exports = { xepLoai, thongKeXepLoai };
`,
      "check.js": `${PRELUDE_JS}

const main = napTep("./main.js");
const xepLoai = (d) => lay(main, "xepLoai")(d);
const thongKe = (ds) => lay(main, "thongKeXepLoai")(ds);

const bang = [
  [10, "Xuất sắc"],
  [9, "Xuất sắc"],
  [8.9, "Giỏi"],
  [8, "Giỏi"],
  [7.9, "Khá"],
  [6.5, "Khá"],
  [6.4, "Trung bình"],
  [5, "Trung bình"],
  [4.9, "Yếu"],
  [0, "Yếu"],
];
for (const [d, loai] of bang) {
  kiemTra("xepLoai(" + d + ")", () => xepLoai(d), loai);
}
kiemTra("xepLoai(-1) không hợp lệ", () => xepLoai(-1), "Không hợp lệ");
kiemTra("xepLoai(10.5) không hợp lệ", () => xepLoai(10.5), "Không hợp lệ");
kiemTra('xepLoai("abc") không hợp lệ', () => xepLoai("abc"), "Không hợp lệ");
kiemTra("xepLoai(NaN) không hợp lệ", () => xepLoai(NaN), "Không hợp lệ");
kiemTra(
  "thongKeXepLoai mẫu",
  () => thongKe([9, 8, 7, 5, 3, 10, -2, "x"]),
  { "Xuất sắc": 2, "Giỏi": 1, "Khá": 1, "Trung bình": 1, "Yếu": 1 }
);
kiemTra(
  "thongKeXepLoai danh sách rỗng có đủ 5 khóa",
  () => thongKe([]),
  { "Xuất sắc": 0, "Giỏi": 0, "Khá": 0, "Trung bình": 0, "Yếu": 0 }
);

ketThuc();
`,
    },
    check: "check.js",
    solution: {
      "main.js": `// Bài 4: Xếp loại điểm.

function xepLoai(diem) {
  if (typeof diem !== "number" || Number.isNaN(diem) || diem < 0 || diem > 10) {
    return "Không hợp lệ";
  }
  if (diem >= 9) return "Xuất sắc";
  if (diem >= 8) return "Giỏi";
  if (diem >= 6.5) return "Khá";
  if (diem >= 5) return "Trung bình";
  return "Yếu";
}

function thongKeXepLoai(dsDiem) {
  const dem = { "Xuất sắc": 0, "Giỏi": 0, "Khá": 0, "Trung bình": 0, "Yếu": 0 };
  for (const d of dsDiem) {
    const loai = xepLoai(d);
    if (loai !== "Không hợp lệ") dem[loai] += 1;
  }
  return dem;
}

module.exports = { xepLoai, thongKeXepLoai };
`,
    },
    hints: [
      "Xử lý dữ liệu sai trước: nếu `diem` không phải số (`typeof`), là `NaN`, nhỏ hơn 0 hoặc lớn hơn 10 thì trả về \"Không hợp lệ\".",
      "Sau đó xét ngưỡng từ cao xuống thấp: `>= 9`, `>= 8`, `>= 6.5`, `>= 5`, còn lại là \"Yếu\". Thứ tự các nhánh rất quan trọng.",
      "Với `thongKeXepLoai`, tạo sẵn một đối tượng có đủ 5 khóa, giá trị 0. Duyệt từng điểm, gọi `xepLoai`, nếu kết quả không phải \"Không hợp lệ\" thì tăng bộ đếm của loại đó.",
      "Chia nhỏ việc: `thongKeXepLoai` chỉ nên gọi lại `xepLoai`, không lặp lại các ngưỡng điểm lần hai.",
    ],
    concepts: ["if/else nhiều nhánh","kiểm tra dữ liệu vào","đối tượng đếm","chia nhỏ hàm"],
    minutes: 15,
  },
  {
    id: "js-05-loc-sap-xep",
    lang: "js",
    level: 2,
    title: "Lọc và sắp xếp danh sách học viên",
    goal: "Dùng filter, sort và gom nhóm trên mảng đối tượng mà không làm thay đổi dữ liệu gốc.",
    instructions: `# Lọc và sắp xếp danh sách học viên

## Bối cảnh
Bạn có danh sách học viên, mỗi người là một đối tượng \`{ ten, lop, diem }\`:

\`\`\`js
const ds = [
  { ten: "An", lop: "A", diem: 8 },
  { ten: "Binh", lop: "B", diem: 9 },
  { ten: "Chi", lop: "A", diem: 6 },
];
\`\`\`

## Yêu cầu
Trong \`main.js\` hoàn thành 3 hàm:

- \`locDat(ds, nguong = 5)\`: mảng mới gồm các học viên có \`diem >= nguong\`, giữ nguyên thứ tự ban đầu.
- \`sapXepGiamDan(ds)\`: mảng mới sắp theo điểm giảm dần; hai người cùng điểm thì xếp theo tên A-Z.
- \`trungBinhTheoLop(ds)\`: đối tượng ánh xạ tên lớp sang điểm trung bình của lớp đó. Với danh sách trên: \`{ A: 7, B: 9 }\`.

## Ràng buộc
- **Không được làm thay đổi mảng \`ds\` gốc** (đây là lỗi rất hay gặp khi dùng \`sort\`).
- Không sửa các đối tượng học viên.
- Chỉ dùng JavaScript thuần.

## Cách hỏi AI cho tốt
Nói rõ ràng buộc "không sửa mảng gốc" trong yêu cầu. Sau khi AI viết code, hỏi: "Hàm này có làm thay đổi mảng đầu vào không? Chỉ ra dòng nào gây ra hoặc tránh được điều đó." Đây là thói quen *đọc hiểu* quan trọng khi làm việc với AI.

## Cách tự kiểm tra
\`node check.js\`. Bạn có thể in mảng gốc trước và sau khi gọi hàm để xem nó có bị đổi không.`,
    files: {
      "main.js": `// Bài 5: Lọc và sắp xếp danh sách học viên.
// Mỗi học viên: { ten: "An", lop: "A", diem: 8 }
// Chạy kiểm tra:  node check.js

// Học viên có diem >= nguong (mặc định 5), giữ thứ tự cũ. Trả về mảng MỚI.
function locDat(ds, nguong = 5) {
  // TODO
}

// Mảng MỚI, điểm giảm dần; cùng điểm thì theo tên A-Z. Không sửa ds gốc!
function sapXepGiamDan(ds) {
  // TODO
}

// { tenLop: diemTrungBinh } . Ví dụ { A: 7, B: 9 }
function trungBinhTheoLop(ds) {
  // TODO
}

module.exports = { locDat, sapXepGiamDan, trungBinhTheoLop };
`,
      "check.js": `${PRELUDE_JS}

const main = napTep("./main.js");
const locDat = (...a) => lay(main, "locDat")(...a);
const sapXepGiamDan = (ds) => lay(main, "sapXepGiamDan")(ds);
const trungBinhTheoLop = (ds) => lay(main, "trungBinhTheoLop")(ds);

const mau = () => [
  { ten: "An", lop: "A", diem: 8 },
  { ten: "Binh", lop: "B", diem: 9 },
  { ten: "Chi", lop: "A", diem: 6 },
  { ten: "Dung", lop: "B", diem: 4 },
  { ten: "Em", lop: "A", diem: 8 },
];
const ten = (ds) => ds.map((x) => x.ten);

kiemTra("locDat mặc định ngưỡng 5", () => ten(locDat(mau())), ["An", "Binh", "Chi", "Em"]);
kiemTra("locDat với ngưỡng 8 (gồm cả 8)", () => ten(locDat(mau(), 8)), ["An", "Binh", "Em"]);
kiemTra("locDat không ai đạt", () => locDat(mau(), 10), []);
kiemTra("sapXepGiamDan điểm giảm, hòa thì theo tên", () => ten(sapXepGiamDan(mau())), ["Binh", "An", "Em", "Chi", "Dung"]);
kiemTra("sapXepGiamDan danh sách rỗng", () => sapXepGiamDan([]), []);
kiemTraDieuKien(
  "sapXepGiamDan không sửa mảng gốc",
  () => {
    const ds = mau();
    sapXepGiamDan(ds);
    return bangNhau(ds, mau());
  },
  "mảng đầu vào đã bị thay đổi thứ tự (đừng sort trực tiếp lên mảng gốc)"
);
kiemTraDieuKien(
  "locDat không sửa mảng gốc",
  () => {
    const ds = mau();
    locDat(ds, 7);
    return bangNhau(ds, mau());
  },
  "mảng đầu vào đã bị thay đổi"
);
kiemTra("trungBinhTheoLop", () => trungBinhTheoLop(mau()), { A: 22 / 3, B: 6.5 });
kiemTra("trungBinhTheoLop ví dụ trong đề", () => trungBinhTheoLop(mau().slice(0, 3)), { A: 7, B: 9 });
kiemTra("trungBinhTheoLop rỗng", () => trungBinhTheoLop([]), {});

ketThuc();
`,
    },
    check: "check.js",
    solution: {
      "main.js": `// Bài 5: Lọc và sắp xếp danh sách học viên.

function locDat(ds, nguong = 5) {
  return ds.filter((hv) => hv.diem >= nguong);
}

function sapXepGiamDan(ds) {
  return [...ds].sort((a, b) => b.diem - a.diem || a.ten.localeCompare(b.ten));
}

function trungBinhTheoLop(ds) {
  const tong = {};
  const dem = {};
  for (const hv of ds) {
    tong[hv.lop] = (tong[hv.lop] || 0) + hv.diem;
    dem[hv.lop] = (dem[hv.lop] || 0) + 1;
  }
  const kq = {};
  for (const lop of Object.keys(tong)) {
    kq[lop] = tong[lop] / dem[lop];
  }
  return kq;
}

module.exports = { locDat, sapXepGiamDan, trungBinhTheoLop };
`,
    },
    hints: [
      "`mang.filter((x) => điều_kiện)` trả về một mảng MỚI chỉ gồm các phần tử thỏa điều kiện. Dùng nó cho `locDat`.",
      "`sort` làm thay đổi mảng gốc! Hãy sao chép trước: `[...ds].sort(...)` hoặc `ds.slice().sort(...)`.",
      "Hàm so sánh của `sort` nhận hai phần tử a, b và trả về số âm nếu a đứng trước. Điểm giảm dần: `b.diem - a.diem`. Khi hòa điểm, so tên bằng `a.ten.localeCompare(b.ten)`.",
      "Với `trungBinhTheoLop`: duyệt danh sách, với mỗi lớp giữ tổng điểm và số lượng (hai đối tượng hoặc một đối tượng con `{ tong, soLuong }`), cuối cùng chia ra trung bình.",
    ],
    concepts: ["mảng đối tượng","filter","sort","gom nhóm","không sửa dữ liệu gốc"],
    minutes: 20,
  },
  {
    id: "js-06-sua-loi-hoa-don",
    lang: "js",
    level: 3,
    title: "Sửa lỗi: tính tiền hóa đơn",
    goal: "Đọc hàm có sẵn, đối chiếu với đặc tả, tìm và sửa nhiều lỗi logic (vòng lặp, phần trăm, thứ tự tính, làm tròn).",
    instructions: `# Sửa lỗi: tính tiền hóa đơn

## Bối cảnh
Cửa hàng nhỏ của bạn có hàm \`tinhHoaDon\` do một đồng nghiệp viết, nhưng hóa đơn in ra toàn sai. Nhiệm vụ của bạn **không phải viết lại từ đầu** mà là tìm lỗi và sửa tối thiểu.

## Đặc tả (hàm phải làm đúng như sau)
\`tinhHoaDon(items, giamGiaPhanTram = 0, vatPhanTram = 0)\` với \`items\` là mảng \`{ ten, gia, soLuong }\`, trả về đối tượng \`{ tamTinh, giamGia, vat, tong }\`:

1. \`tamTinh\` = tổng của \`gia * soLuong\`.
2. \`giamGia\` = \`tamTinh * giamGiaPhanTram / 100\`, làm tròn bằng \`Math.round\`, **tối đa 100000** (đồng).
3. \`sauGiam\` = \`tamTinh - giamGia\`.
4. \`vat\` = \`sauGiam * vatPhanTram / 100\`, làm tròn bằng \`Math.round\`.
5. \`tong\` = \`sauGiam + vat\`.

Giỏ hàng rỗng thì tất cả bằng 0.

## Ví dụ
\`\`\`js
tinhHoaDon([{ ten: "Bút", gia: 50000, soLuong: 2 }, { ten: "Sổ", gia: 30000, soLuong: 1 }], 10, 8)
// { tamTinh: 130000, giamGia: 13000, vat: 9360, tong: 126360 }
\`\`\`

## Ràng buộc
- Giữ nguyên tên hàm và dạng giá trị trả về.
- Chỉ dùng JavaScript thuần.

## Cách hỏi AI cho tốt
Dán **đặc tả + code + dòng FAIL** vào cho AI, rồi hỏi: "Liệt kê các chỗ code KHÔNG đúng với đặc tả, chưa sửa vội." Sau đó sửa từng chỗ một và chạy lại \`node check.js\`. Cách này tập cho bạn làm chủ quá trình, thay vì xin một đoạn code mới rồi tin tưởng mù quáng.

## Cách tự kiểm tra
\`node check.js\`. Sau mỗi lần sửa, số dòng PASS phải tăng lên; nếu giảm, bạn vừa làm hỏng thứ khác.`,
    files: {
      "main.js": `// Bài 6: Sửa lỗi tính tiền hóa đơn.
// Hàm dưới đây CÓ LỖI. Đọc đặc tả trong DE-BAI.md, tìm và sửa.
// Chạy kiểm tra:  node check.js

function tinhHoaDon(items, giamGiaPhanTram = 0, vatPhanTram = 0) {
  let tamTinh = 0;
  for (let i = 0; i <= items.length; i++) {
    tamTinh += items[i].gia * items[i].soLuong;
  }
  const giamGia = tamTinh * giamGiaPhanTram;
  const vat = (tamTinh * vatPhanTram) / 100;
  const tong = tamTinh - giamGia + vat;
  return { tamTinh, giamGia, vat, tong };
}

module.exports = { tinhHoaDon };
`,
      "check.js": `${PRELUDE_JS}

const main = napTep("./main.js");
const tinh = (...a) => lay(main, "tinhHoaDon")(...a);
const but = { ten: "Bút", gia: 50000, soLuong: 2 };
const so = { ten: "Sổ", gia: 30000, soLuong: 1 };

kiemTra("giỏ hàng rỗng", () => tinh([]), { tamTinh: 0, giamGia: 0, vat: 0, tong: 0 });
kiemTra("không giảm giá, không VAT", () => tinh([but, so]), { tamTinh: 130000, giamGia: 0, vat: 0, tong: 130000 });
kiemTra("giảm 10% và VAT 8%", () => tinh([but, so], 10, 8), { tamTinh: 130000, giamGia: 13000, vat: 9360, tong: 126360 });
kiemTra("VAT tính trên số tiền sau giảm", () => tinh([{ ten: "A", gia: 100000, soLuong: 1 }], 20, 10), { tamTinh: 100000, giamGia: 20000, vat: 8000, tong: 88000 });
kiemTra("làm tròn thành số nguyên đồng", () => tinh([{ ten: "B", gia: 99999, soLuong: 1 }], 15, 10), { tamTinh: 99999, giamGia: 15000, vat: 8500, tong: 93499 });
kiemTra("giảm giá tối đa 100000", () => tinh([{ ten: "C", gia: 2000000, soLuong: 1 }], 20, 8), { tamTinh: 2000000, giamGia: 100000, vat: 152000, tong: 2052000 });
kiemTra("chỉ có VAT", () => tinh([{ ten: "D", gia: 10000, soLuong: 3 }], 0, 10), { tamTinh: 30000, giamGia: 0, vat: 3000, tong: 33000 });

ketThuc();
`,
    },
    check: "check.js",
    solution: {
      "main.js": `// Bài 6: Tính tiền hóa đơn (bản đã sửa).

function tinhHoaDon(items, giamGiaPhanTram = 0, vatPhanTram = 0) {
  let tamTinh = 0;
  for (let i = 0; i < items.length; i++) {
    tamTinh += items[i].gia * items[i].soLuong;
  }
  const giamGia = Math.min(Math.round((tamTinh * giamGiaPhanTram) / 100), 100000);
  const sauGiam = tamTinh - giamGia;
  const vat = Math.round((sauGiam * vatPhanTram) / 100);
  const tong = sauGiam + vat;
  return { tamTinh, giamGia, vat, tong };
}

module.exports = { tinhHoaDon };
`,
    },
    hints: [
      "Đừng đoán mò: chạy `node check.js`, xem các dòng FAIL, rồi thêm `console.log` vào hàm để in các biến trung gian (`tamTinh`, `giamGia`, `vat`).",
      "Một lỗi làm hàm bị ném lỗi ngay cả với hóa đơn bình thường: nhìn kỹ điều kiện dừng của vòng lặp `for`. Một lỗi khác nằm ở đơn vị của phần trăm (giảm 10% nghĩa là nhân với bao nhiêu?).",
      "Đối chiếu từng bước với đặc tả: giảm giá tính trên tạm tính (và có trần), VAT tính trên số tiền SAU giảm, các số tiền là số nguyên đồng (làm tròn `Math.round`).",
      "Có tổng cộng 5 chỗ chưa đúng đặc tả: điều kiện vòng lặp, đơn vị phần trăm, trần giảm giá, nền tính VAT, làm tròn. Sửa lần lượt từng chỗ và chạy lại kiểm tra sau MỖI lần sửa.",
    ],
    concepts: ["gỡ lỗi","đọc code","phần trăm","làm tròn","đặc tả"],
    minutes: 25,
  },
  {
    id: "js-07-viet-test",
    lang: "js",
    level: 3,
    title: "Viết test cho hàm năm nhuận",
    goal: "Thiết kế bộ ca kiểm thử đủ tốt để phát hiện các phiên bản hàm bị sai (kiểm thử biên), thay vì chỉ thử vài giá trị dễ.",
    instructions: `# Viết test cho hàm năm nhuận

## Bối cảnh
Hàm \`laNamNhuan(nam)\` trong \`main.js\` đã có sẵn và đúng. Lần này bạn không viết hàm, bạn **viết bộ test**. Trong dự án thật, AI hay sinh code kèm test "cho có" chỉ thử vài giá trị dễ. Một bộ test tốt phải phát hiện được hàm sai.

## Yêu cầu
Mở \`tests.js\` và điền danh sách các ca kiểm thử dạng \`{ vao: <năm>, ra: <true/false> }\`.

Bộ chấm sẽ kiểm tra:
1. Bạn có ít nhất **6** ca, mỗi ca đúng dạng.
2. Mọi ca đều **đúng** với hàm chuẩn (kỳ vọng của bạn không sai).
3. Bộ test **bắt được** từng phiên bản hàm bị lỗi mà bộ chấm chuẩn bị sẵn (ví dụ quên một quy tắc). Mỗi phiên bản lỗi phải làm ít nhất một ca của bạn thất bại.

## Quy tắc năm nhuận
- Chia hết cho 4 thì là năm nhuận;
- trừ năm chia hết cho 100 thì **không** nhuận;
- nhưng chia hết cho 400 thì **vẫn** nhuận.

## Ví dụ một ca
\`\`\`js
{ vao: 2024, ra: true }
\`\`\`

## Ràng buộc
- Chỉ sửa \`tests.js\`, không sửa \`main.js\` và \`check.js\`.
- Đừng xem mã của các phiên bản lỗi trong \`check.js\`: bài tập là tự nghĩ ra ca biên.

## Cách hỏi AI cho tốt
Hỏi: "Với quy tắc năm nhuận này, hãy liệt kê các ca biên và lý do mỗi ca đáng thử, rồi chỉ ra lỗi phổ biến nhất khi cài đặt." Sau đó tự chọn ca, đừng chép máy móc. Hãy kiểm tra lại bằng lịch/Internet nếu AI khẳng định năm nào đó nhuận hay không.

## Cách tự kiểm tra
\`node check.js\`. Dòng PASS "bắt được lỗi ..." nghĩa là bộ test của bạn đã đủ mạnh với lỗi đó.`,
    files: {
      "main.js": `// Bài 7: hàm cần kiểm thử (ĐÃ ĐÚNG, không cần sửa). Bạn viết test trong tests.js.

// true nếu "nam" là năm nhuận.
function laNamNhuan(nam) {
  return (nam % 4 === 0 && nam % 100 !== 0) || nam % 400 === 0;
}

module.exports = { laNamNhuan };
`,
      "tests.js": `// Viết các ca kiểm thử cho laNamNhuan(nam) trong main.js.
// Mỗi ca có dạng:  { vao: <năm>, ra: <true hoặc false mong đợi> }
// Gợi ý: nghĩ xem lỗi nào dễ mắc nhất khi cài đặt hàm này, rồi chọn năm làm lộ lỗi đó.

module.exports = [
  // { vao: 2024, ra: true },
];
`,
      "check.js": `${PRELUDE_JS}

// Hàm chuẩn và các phiên bản bị lỗi (mô phỏng lỗi hay gặp khi cài đặt).
const chuan = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const loi = [
  ["quên quy tắc năm thế kỷ (chỉ xét chia hết cho 4)", (y) => y % 4 === 0],
  ["quên quy tắc chia hết cho 400", (y) => y % 4 === 0 && y % 100 !== 0],
  ["coi mọi năm chẵn là nhuận", (y) => y % 2 === 0],
  ["coi năm chia hết cho 200 là nhuận", (y) => (y % 4 === 0 && y % 100 !== 0) || y % 200 === 0],
  ["không bao giờ nhuận", () => false],
];

const tests = napTep("./tests.js");
const hopLe = Array.isArray(tests) && tests.every((c) => c && Number.isInteger(c.vao) && typeof c.ra === "boolean");
const ds = hopLe ? tests : [];

kiemTraDieuKien(
  "có ít nhất 6 ca, đúng dạng { vao, ra }",
  () => hopLe && ds.length >= 6,
  hopLe ? "mới có " + ds.length + " ca, cần ít nhất 6" : "tests.js phải xuất một mảng các { vao: số nguyên, ra: true/false }"
);

const sai = ds.filter((c) => chuan(c.vao) !== c.ra);
kiemTraDieuKien(
  "các ca đều đúng với hàm chuẩn",
  () => hopLe && ds.length > 0 && sai.length === 0,
  ds.length === 0
    ? "chưa có ca nào để kiểm tra"
    : "có ca kỳ vọng sai, ví dụ vao=" + (sai[0] && sai[0].vao) + " mong đợi " + (sai[0] && sai[0].ra) + " nhưng hàm đúng trả " + (sai[0] && chuan(sai[0].vao))
);

for (const [ten, ham] of loi) {
  kiemTraDieuKien(
    "bắt được lỗi: " + ten,
    () => ds.some((c) => ham(c.vao) !== c.ra),
    "bộ test của bạn chưa phát hiện lỗi này; hãy thêm một năm mà phiên bản lỗi trả kết quả khác hàm đúng"
  );
}

ketThuc();
`,
    },
    check: "check.js",
    solution: {
      "tests.js": `// Bộ ca kiểm thử mẫu cho laNamNhuan.
module.exports = [
  { vao: 2023, ra: false }, // năm thường
  { vao: 2024, ra: true }, // chia hết cho 4
  { vao: 2002, ra: false }, // chẵn nhưng không chia hết cho 4
  { vao: 1900, ra: false }, // năm thế kỷ, không chia hết cho 400
  { vao: 2000, ra: true }, // năm thế kỷ chia hết cho 400
  { vao: 1800, ra: false }, // chia hết cho 200 nhưng không chia hết cho 400
  { vao: 2100, ra: false },
];
`,
    },
    hints: [
      "Test tốt là test **bắt được lỗi**. Bộ chấm sẽ thử nhiều phiên bản hàm bị sai; bạn phải có ít nhất một ca làm mỗi phiên bản sai đó trả kết quả khác mong đợi.",
      "Nhắc lại quy tắc năm nhuận: chia hết cho 4 thì nhuận, TRỪ năm chia hết cho 100, nhưng LẠI nhuận nếu chia hết cho 400. Mỗi vế của quy tắc cần ít nhất một ca đại diện.",
      "Hãy nghĩ theo nhóm: năm thường (2023), năm nhuận thường (2024), năm thế kỷ KHÔNG nhuận (1900), năm thế kỷ nhuận (2000), và một năm lẻ chẵn nhưng không chia hết cho 4 (2002).",
      "Nếu bộ chấm báo còn lọt một lỗi, đọc tên lỗi trong dòng FAIL rồi nghĩ: năm nào trả về khác nhau giữa hàm đúng và hàm sai này? Thử thêm các năm thế kỷ khác như 1800 hoặc 2100.",
    ],
    concepts: ["kiểm thử","ca biên","mutation testing","đặc tả"],
    minutes: 25,
  },
  {
    id: "py-01-chuyen-doi-nhiet-do",
    lang: "py",
    level: 1,
    title: "Chuyển đổi nhiệt độ",
    goal: "Viết hàm có tham số và giá trị trả về, dùng công thức, làm tròn số thực và rẽ nhánh if/elif/else.",
    instructions: `# Chuyển đổi nhiệt độ

## Bối cảnh
Bạn làm ứng dụng thời tiết nhỏ cho bạn bè ở nước ngoài, họ quen đơn vị độ F. Cần các hàm chuyển đổi và một câu mô tả cảm giác nhiệt độ.

## Yêu cầu
Trong \`main.py\`:

- \`c_sang_f(c)\`: đổi độ C sang độ F, làm tròn 1 chữ số thập phân.
- \`f_sang_c(f)\`: đổi độ F sang độ C, làm tròn 1 chữ số thập phân.
- \`mo_ta(c)\`: trả về chuỗi: \`"Lạnh"\` nếu \`c < 15\`; \`"Dễ chịu"\` nếu \`15 <= c < 30\`; \`"Nóng"\` nếu \`c >= 30\`.

## Ví dụ vào/ra
| Gọi hàm | Kết quả |
| --- | --- |
| \`c_sang_f(0)\` | \`32.0\` |
| \`c_sang_f(37)\` | \`98.6\` |
| \`f_sang_c(212)\` | \`100.0\` |
| \`f_sang_c(50)\` | \`10.0\` |
| \`mo_ta(10)\` | \`"Lạnh"\` |
| \`mo_ta(30)\` | \`"Nóng"\` |

## Ràng buộc
- Chỉ dùng thư viện chuẩn.
- Không gọi \`input()\` hay \`print()\` trong các hàm, chỉ \`return\`.

## Cách hỏi AI cho tốt
Cho AI **công thức và ví dụ vào/ra** như bảng trên, và nhờ nó "viết đúng 3 hàm với tên này, không thêm gì khác". Sau đó hỏi: "Vì sao \`round(98.60000000000001, 1)\` cho \`98.6\`? Số thực trong Python lưu như thế nào?"

## Cách tự kiểm tra
\`python3 check.py\` (Windows: \`python check.py\`). Dòng \`FAIL\` cho biết bạn nhận được gì và mong đợi gì.`,
    files: {
      "main.py": `# Bài 1: Chuyển đổi nhiệt độ.
# Chạy kiểm tra:  python3 check.py


def c_sang_f(c):
    """Đổi độ C sang độ F, làm tròn 1 chữ số thập phân."""
    # TODO
    pass


def f_sang_c(f):
    """Đổi độ F sang độ C, làm tròn 1 chữ số thập phân."""
    # TODO
    pass


def mo_ta(c):
    """'Lạnh' nếu c < 15; 'Dễ chịu' nếu 15 <= c < 30; 'Nóng' nếu c >= 30."""
    # TODO
    pass
`,
      "check.py": `${PRELUDE_PY}

kiem_tra("c_sang_f(0) = 32.0", lambda: lay("c_sang_f")(0), 32.0)
kiem_tra("c_sang_f(100) = 212.0", lambda: lay("c_sang_f")(100), 212.0)
kiem_tra("c_sang_f(37) = 98.6", lambda: lay("c_sang_f")(37), 98.6)
kiem_tra("c_sang_f(-40) = -40.0", lambda: lay("c_sang_f")(-40), -40.0)
kiem_tra("f_sang_c(32) = 0.0", lambda: lay("f_sang_c")(32), 0.0)
kiem_tra("f_sang_c(212) = 100.0", lambda: lay("f_sang_c")(212), 100.0)
kiem_tra("f_sang_c(50) = 10.0", lambda: lay("f_sang_c")(50), 10.0)
kiem_tra("f_sang_c(98.6) = 37.0", lambda: lay("f_sang_c")(98.6), 37.0)
kiem_tra("làm tròn 1 chữ số của c_sang_f(36.6)", lambda: lay("c_sang_f")(36.6), 97.9)
kiem_tra("mo_ta(10) là Lạnh", lambda: lay("mo_ta")(10), "Lạnh")
kiem_tra("mo_ta(14.9) là Lạnh", lambda: lay("mo_ta")(14.9), "Lạnh")
kiem_tra("mo_ta(15) là Dễ chịu", lambda: lay("mo_ta")(15), "Dễ chịu")
kiem_tra("mo_ta(29.9) là Dễ chịu", lambda: lay("mo_ta")(29.9), "Dễ chịu")
kiem_tra("mo_ta(30) là Nóng", lambda: lay("mo_ta")(30), "Nóng")

ket_thuc()
`,
    },
    check: "check.py",
    solution: {
      "main.py": `# Bài 1: Chuyển đổi nhiệt độ.


def c_sang_f(c):
    return round(c * 9 / 5 + 32, 1)


def f_sang_c(f):
    return round((f - 32) * 5 / 9, 1)


def mo_ta(c):
    if c < 15:
        return "Lạnh"
    elif c < 30:
        return "Dễ chịu"
    else:
        return "Nóng"
`,
    },
    hints: [
      "Công thức: F = C * 9 / 5 + 32. Hàm chỉ cần `return` kết quả, không dùng `print` và không dùng `input()`.",
      "Chiều ngược lại: C = (F - 32) * 5 / 9. Cả hai hàm làm tròn đến 1 chữ số thập phân bằng `round(giá_trị, 1)`.",
      "Với `mo_ta`, xét điều kiện từ thấp đến cao: nhỏ hơn 15 là \"Lạnh\", nhỏ hơn 30 là \"Dễ chịu\", còn lại là \"Nóng\".",
      "Nếu ra kết quả kiểu `98.60000000000001`, bạn quên làm tròn. Nếu ra `None`, bạn quên `return`.",
    ],
    concepts: ["hàm","số thực","làm tròn","if/elif/else"],
    minutes: 10,
  },
  {
    id: "py-02-fizzbuzz",
    lang: "py",
    level: 1,
    title: "FizzBuzz",
    goal: "Dùng vòng lặp, phép chia lấy dư và thứ tự các điều kiện để sinh danh sách FizzBuzz.",
    instructions: `# FizzBuzz

## Bối cảnh
Bài kinh điển khi phỏng vấn và khi tập rẽ nhánh/vòng lặp. Quy tắc trò chơi: đếm từ 1 đến n; số chia hết cho 3 thì nói "Fizz", chia hết cho 5 thì nói "Buzz", chia hết cho cả hai thì nói "FizzBuzz", còn lại nói chính số đó.

## Yêu cầu
Trong \`main.py\`:

- \`fizzbuzz(n)\`: trả về **danh sách chuỗi** gồm n phần tử cho các số từ 1 đến n. \`n = 0\` thì trả về danh sách rỗng.
- \`dem_fizzbuzz(n)\`: trả về số lần \`"FizzBuzz"\` xuất hiện trong dãy từ 1 đến n (hãy tái sử dụng \`fizzbuzz\`).

## Ví dụ vào/ra
\`\`\`python
fizzbuzz(5)   # ["1", "2", "Fizz", "4", "Buzz"]
fizzbuzz(15)[-1]   # "FizzBuzz"
dem_fizzbuzz(30)   # 2
\`\`\`

## Ràng buộc
- Phần tử phải là chuỗi (\`"1"\`, không phải số \`1\`).
- Không dùng \`print\` và \`input()\` trong hàm; chỉ \`return\`.

## Cách hỏi AI cho tốt
Thay vì "viết FizzBuzz", hãy hỏi: "Giải thích vì sao trong FizzBuzz phải kiểm tra điều kiện chia hết cho 15 trước. Cho ví dụ chạy tay với n = 15." Sau đó tự cài đặt.

## Cách tự kiểm tra
\`python3 check.py\`. Thử thêm \`print(fizzbuzz(15))\` trong một tệp riêng để nhìn kết quả.`,
    files: {
      "main.py": `# Bài 2: FizzBuzz.
# Chạy kiểm tra:  python3 check.py


def fizzbuzz(n):
    """Danh sách chuỗi cho các số 1..n theo luật FizzBuzz."""
    # TODO
    pass


def dem_fizzbuzz(n):
    """Số lần 'FizzBuzz' xuất hiện trong dãy 1..n."""
    # TODO
    pass
`,
      "check.py": `${PRELUDE_PY}

kiem_tra("fizzbuzz(5)", lambda: lay("fizzbuzz")(5), ["1", "2", "Fizz", "4", "Buzz"])
kiem_tra("fizzbuzz(0) là danh sách rỗng", lambda: lay("fizzbuzz")(0), [])
kiem_tra("fizzbuzz(1)", lambda: lay("fizzbuzz")(1), ["1"])
kiem_tra(
    "fizzbuzz(15) đầy đủ",
    lambda: lay("fizzbuzz")(15),
    ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz"],
)
kiem_tra("fizzbuzz(30)[29] là FizzBuzz", lambda: lay("fizzbuzz")(30)[29], "FizzBuzz")
kiem_tra("fizzbuzz(100) có 100 phần tử", lambda: len(lay("fizzbuzz")(100)), 100)
kiem_tra("phần tử là chuỗi, không phải số", lambda: type(lay("fizzbuzz")(4)[0]).__name__, "str")
kiem_tra("dem_fizzbuzz(14) là 0", lambda: lay("dem_fizzbuzz")(14), 0)
kiem_tra("dem_fizzbuzz(30) là 2", lambda: lay("dem_fizzbuzz")(30), 2)
kiem_tra("dem_fizzbuzz(100) là 6", lambda: lay("dem_fizzbuzz")(100), 6)

ket_thuc()
`,
    },
    check: "check.py",
    solution: {
      "main.py": `# Bài 2: FizzBuzz.


def fizzbuzz(n):
    kq = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            kq.append("FizzBuzz")
        elif i % 3 == 0:
            kq.append("Fizz")
        elif i % 5 == 0:
            kq.append("Buzz")
        else:
            kq.append(str(i))
    return kq


def dem_fizzbuzz(n):
    return fizzbuzz(n).count("FizzBuzz")
`,
    },
    hints: [
      "Tạo một danh sách rỗng `kq = []`, duyệt `for i in range(1, n + 1)` và `kq.append(...)` giá trị tương ứng cho mỗi số.",
      "`i % 3 == 0` nghĩa là i chia hết cho 3. Số chia hết cho cả 3 và 5 phải cho `\"FizzBuzz\"`.",
      "Thứ tự điều kiện quan trọng: nếu bạn kiểm tra chia hết cho 3 trước thì 15 sẽ ra \"Fizz\" và không bao giờ tới nhánh \"FizzBuzz\". Hãy kiểm tra trường hợp chia hết cho cả hai TRƯỚC.",
      "Phần tử cho số i không chia hết cho 3 hay 5 là chính số đó nhưng dạng chuỗi: `str(i)`. Kết quả toàn bộ phải là danh sách chuỗi.",
    ],
    concepts: ["vòng lặp for","phép chia lấy dư %","thứ tự điều kiện","danh sách"],
    minutes: 10,
  },
  {
    id: "py-03-dem-tan-suat",
    lang: "py",
    level: 2,
    title: "Đếm tần suất từ",
    goal: "Dùng từ điển để đếm số lần xuất hiện của từng từ trong văn bản, chuẩn hóa chữ hoa/thường và dấu câu, rồi lấy các từ phổ biến nhất.",
    instructions: `# Đếm tần suất từ

## Bối cảnh
Bạn phân tích một đoạn văn để tìm những từ khóa được nhắc nhiều nhất, ví dụ trong bài phản hồi của sinh viên.

## Yêu cầu
Trong \`main.py\`:

- \`dem_tan_suat(van_ban)\`: trả về từ điển \`{từ: số_lần}\`.
  - Đổi hết sang chữ thường.
  - Bỏ dấu câu ở hai đầu mỗi từ (\`. , ! ? ; : " ' ( ) -\`...). Dấu nằm giữa từ giữ nguyên (ví dụ \`don't\`).
  - Bỏ qua từ rỗng.
- \`tu_pho_bien(van_ban, n)\`: trả về danh sách \`n\` cặp \`(từ, số_lần)\` phổ biến nhất, **số lần giảm dần**; hòa số lần thì sắp theo bảng chữ cái của từ.

## Ví dụ vào/ra
\`\`\`python
dem_tan_suat("Xin chào, xin chào! Tôi là AI.")
# {"xin": 2, "chào": 2, "tôi": 1, "là": 1, "ai": 1}
tu_pho_bien("a b b c c c", 2)
# [("c", 3), ("b", 2)]
\`\`\`

## Ràng buộc
- Chỉ dùng thư viện chuẩn.
- Văn bản rỗng hoặc chỉ có dấu câu thì trả về \`{}\` / \`[]\`.

## Cách hỏi AI cho tốt
Cho AI ví dụ vào/ra kèm *trường hợp lắt léo* (dấu câu, hoa/thường). Sau khi có code, nhờ AI: "Chạy tay hàm này với chuỗi \`Hello, hello!\` và chỉ ra giá trị của từ điển sau mỗi vòng lặp." Đối chiếu với kết quả bạn tự chạy.

## Cách tự kiểm tra
\`python3 check.py\`. In thử \`dem_tan_suat(...)\` với một đoạn văn của riêng bạn.`,
    files: {
      "main.py": `# Bài 3: Đếm tần suất từ.
# Chạy kiểm tra:  python3 check.py

import string  # string.punctuation chứa các dấu câu thường gặp


def dem_tan_suat(van_ban):
    """Trả về dict {từ: số lần}. Chữ thường, bỏ dấu câu ở hai đầu từ."""
    # TODO
    pass


def tu_pho_bien(van_ban, n):
    """Trả về list n cặp (từ, số lần), số lần giảm dần; hòa thì theo bảng chữ cái."""
    # TODO
    pass
`,
      "check.py": `${PRELUDE_PY}

kiem_tra(
    "dem_tan_suat mẫu trong đề",
    lambda: lay("dem_tan_suat")("Xin chào, xin chào! Tôi là AI."),
    {"xin": 2, "chào": 2, "tôi": 1, "là": 1, "ai": 1},
)
kiem_tra("dem_tan_suat không phân biệt hoa thường", lambda: lay("dem_tan_suat")("Hello hello HELLO"), {"hello": 3})
kiem_tra("dem_tan_suat bỏ dấu câu hai đầu", lambda: lay("dem_tan_suat")('"Hi," (hi) hi.'), {"hi": 3})
kiem_tra("dem_tan_suat giữ dấu nháy giữa từ", lambda: lay("dem_tan_suat")("don't don't"), {"don't": 2})
kiem_tra("dem_tan_suat chuỗi rỗng", lambda: lay("dem_tan_suat")(""), {})
kiem_tra("dem_tan_suat chỉ có dấu câu", lambda: lay("dem_tan_suat")("... !!! --"), {})
kiem_tra("tu_pho_bien mẫu trong đề", lambda: lay("tu_pho_bien")("a b b c c c", 2), [("c", 3), ("b", 2)])
kiem_tra("tu_pho_bien hòa thì theo bảng chữ cái", lambda: lay("tu_pho_bien")("b a c a b c d", 3), [("a", 2), ("b", 2), ("c", 2)])
kiem_tra("tu_pho_bien n lớn hơn số từ", lambda: lay("tu_pho_bien")("x y x", 10), [("x", 2), ("y", 1)])
kiem_tra("tu_pho_bien văn bản rỗng", lambda: lay("tu_pho_bien")("", 3), [])

ket_thuc()
`,
    },
    check: "check.py",
    solution: {
      "main.py": `# Bài 3: Đếm tần suất từ.

import string


def dem_tan_suat(van_ban):
    dem = {}
    for tu in van_ban.lower().split():
        tu = tu.strip(string.punctuation)
        if tu == "":
            continue
        dem[tu] = dem.get(tu, 0) + 1
    return dem


def tu_pho_bien(van_ban, n):
    dem = dem_tan_suat(van_ban)
    cac_cap = sorted(dem.items(), key=lambda cap: (-cap[1], cap[0]))
    return cac_cap[:n]
`,
    },
    hints: [
      "Chia văn bản thành các từ bằng `van_ban.split()`, đổi sang chữ thường bằng `.lower()` để \"Xin\" và \"xin\" là cùng một từ.",
      "Dấu câu dính vào từ (\"chào,\"), cần bỏ ở HAI ĐẦU từ: `tu.strip(string.punctuation)` (nhớ `import string`). Từ rỗng sau khi bỏ dấu thì bỏ qua.",
      "Đếm bằng từ điển: `dem[tu] = dem.get(tu, 0) + 1`. (Hoặc tìm hiểu `collections.Counter`, nhưng hãy hiểu cách làm tay trước.)",
      "`tu_pho_bien`: sắp xếp danh sách các cặp `(tu, so_lan)` với khóa là `(-so_lan, tu)` để số lần giảm dần, hòa thì theo bảng chữ cái, rồi cắt `[:n]`.",
    ],
    concepts: ["từ điển (dict)","chuỗi","sắp xếp theo khóa","chuẩn hóa dữ liệu"],
    minutes: 20,
  },
  {
    id: "py-04-xu-ly-csv",
    lang: "py",
    level: 2,
    title: "Xử lý bảng điểm dạng CSV",
    goal: "Phân tích chuỗi CSV thành danh sách từ điển, chuyển kiểu dữ liệu, làm sạch dòng trống/khoảng trắng và tính trung bình mỗi sinh viên.",
    instructions: `# Xử lý bảng điểm dạng CSV

## Bối cảnh
Điểm của lớp được xuất ra từ bảng tính thành văn bản CSV (các cột cách nhau bằng dấu phẩy). Dữ liệu thật hay bẩn: có dòng trống, có khoảng trắng thừa quanh ô.

\`\`\`
ten,toan,van,anh
An, 8, 7, 9

Binh,5,6,4
Chi,10,9,9
\`\`\`

## Yêu cầu
Trong \`main.py\`:

- \`doc_csv(van_ban)\`: trả về danh sách các từ điển, mỗi dòng dữ liệu một từ điển. Khóa lấy từ dòng tiêu đề. Cột \`ten\` giữ là chuỗi; các cột khác chuyển thành số thực (\`float\`). Bỏ qua dòng trống và khoảng trắng thừa quanh ô.
- \`diem_trung_binh(rows)\`: nhận kết quả của \`doc_csv\`, trả về từ điển \`{ten: điểm trung bình các môn}\`, làm tròn 2 chữ số thập phân.
- \`sinh_vien_gioi(rows, nguong)\`: danh sách tên các sinh viên có điểm trung bình \`>= nguong\`, sắp xếp theo điểm trung bình **giảm dần**.

## Ví dụ vào/ra
\`\`\`python
rows = doc_csv(van_ban)
# [{"ten": "An", "toan": 8.0, "van": 7.0, "anh": 9.0}, {"ten": "Binh", ...}, {"ten": "Chi", ...}]
diem_trung_binh(rows)      # {"An": 8.0, "Binh": 5.0, "Chi": 9.33}
sinh_vien_gioi(rows, 8)    # ["Chi", "An"]
\`\`\`

## Ràng buộc
- Chỉ dùng thư viện chuẩn (được dùng module \`csv\` nếu bạn muốn).
- Không đọc tệp, không dùng \`input()\`: dữ liệu đến từ tham số.

## Cách hỏi AI cho tốt
Đưa cho AI **một mẫu dữ liệu thật** (kể cả dòng trống, khoảng trắng) thay vì mô tả chung chung. Hỏi thêm: "Hàm sẽ làm gì nếu có một ô điểm để trống hoặc là chữ?" Xem AI trả lời và cân nhắc xem nên xử lý hay báo lỗi: đó là quyết định của bạn.

## Cách tự kiểm tra
\`python3 check.py\`. In \`doc_csv(...)\` ra để nhìn từng dòng trước khi tính toán tiếp.`,
    files: {
      "main.py": `# Bài 4: Xử lý bảng điểm dạng CSV.
# Chạy kiểm tra:  python3 check.py


def doc_csv(van_ban):
    """CSV dạng chuỗi -> list các dict. Cột 'ten' là chuỗi, cột khác là float."""
    # TODO
    pass


def diem_trung_binh(rows):
    """{ten: điểm trung bình các môn, làm tròn 2 chữ số}"""
    # TODO
    pass


def sinh_vien_gioi(rows, nguong):
    """Tên các sinh viên có trung bình >= nguong, giảm dần theo trung bình."""
    # TODO
    pass
`,
      "check.py": `${PRELUDE_PY}

VAN_BAN = """ten,toan,van,anh
An, 8, 7, 9

Binh,5,6,4
Chi,10,9,9
"""

ROWS = [
    {"ten": "An", "toan": 8.0, "van": 7.0, "anh": 9.0},
    {"ten": "Binh", "toan": 5.0, "van": 6.0, "anh": 4.0},
    {"ten": "Chi", "toan": 10.0, "van": 9.0, "anh": 9.0},
]

kiem_tra("doc_csv bỏ dòng trống, làm sạch khoảng trắng, đổi sang số", lambda: lay("doc_csv")(VAN_BAN), ROWS)
kiem_tra("doc_csv chỉ có tiêu đề", lambda: lay("doc_csv")("ten,toan\\n"), [])
kiem_tra("doc_csv một dòng không có dấu xuống dòng cuối", lambda: lay("doc_csv")("ten,diem\\nLan,7.5"), [{"ten": "Lan", "diem": 7.5}])
kiem_tra("cột ten luôn là chuỗi", lambda: type(lay("doc_csv")(VAN_BAN)[0]["ten"]).__name__, "str")
kiem_tra("diem_trung_binh", lambda: lay("diem_trung_binh")(ROWS), {"An": 8.0, "Binh": 5.0, "Chi": 9.33})
kiem_tra("diem_trung_binh danh sách rỗng", lambda: lay("diem_trung_binh")([]), {})
kiem_tra("sinh_vien_gioi(rows, 8) giảm dần", lambda: lay("sinh_vien_gioi")(ROWS, 8), ["Chi", "An"])
kiem_tra("sinh_vien_gioi ngưỡng cao không ai đạt", lambda: lay("sinh_vien_gioi")(ROWS, 9.5), [])
kiem_tra("sinh_vien_gioi ngưỡng 0 lấy tất cả", lambda: lay("sinh_vien_gioi")(ROWS, 0), ["Chi", "An", "Binh"])

ket_thuc()
`,
    },
    check: "check.py",
    solution: {
      "main.py": `# Bài 4: Xử lý bảng điểm dạng CSV.


def doc_csv(van_ban):
    dong_du_lieu = [d for d in van_ban.splitlines() if d.strip() != ""]
    if not dong_du_lieu:
        return []
    cot = [c.strip() for c in dong_du_lieu[0].split(",")]
    rows = []
    for dong in dong_du_lieu[1:]:
        o = [x.strip() for x in dong.split(",")]
        ban_ghi = {}
        for ten_cot, gia_tri in zip(cot, o):
            ban_ghi[ten_cot] = gia_tri if ten_cot == "ten" else float(gia_tri)
        rows.append(ban_ghi)
    return rows


def _trung_binh(ban_ghi):
    diem = [v for k, v in ban_ghi.items() if k != "ten"]
    return sum(diem) / len(diem)


def diem_trung_binh(rows):
    return {r["ten"]: round(_trung_binh(r), 2) for r in rows}


def sinh_vien_gioi(rows, nguong):
    dat = [(r["ten"], _trung_binh(r)) for r in rows if _trung_binh(r) >= nguong]
    dat.sort(key=lambda cap: -cap[1])
    return [ten for ten, _ in dat]
`,
    },
    hints: [
      "Tách văn bản thành các dòng bằng `van_ban.strip().splitlines()`. Dòng đầu là tiêu đề cột, các dòng sau là dữ liệu. Bỏ qua dòng trống (`dong.strip() == \"\"`).",
      "Mỗi dòng: `dong.split(\",\")` rồi `.strip()` từng ô để bỏ khoảng trắng thừa. Ghép tên cột với giá trị bằng `zip(cot, o)`.",
      "Cột `ten` giữ nguyên là chuỗi; mọi cột còn lại đổi sang số bằng `float(...)`.",
      "Trung bình của một sinh viên: lấy các giá trị khác `ten` trong dòng, `sum(...) / len(...)`, rồi `round(..., 2)`. `sinh_vien_gioi` chỉ cần lọc theo trung bình rồi sắp xếp giảm dần.",
    ],
    concepts: ["CSV","chuỗi","danh sách từ điển","chuyển kiểu","làm sạch dữ liệu"],
    minutes: 25,
  },
  {
    id: "py-05-mat-khau-manh",
    lang: "py",
    level: 2,
    title: "Kiểm tra mật khẩu mạnh",
    goal: "Kiểm tra nhiều quy tắc trên một chuỗi, gom các lỗi vào danh sách và phân loại độ mạnh theo số lỗi.",
    instructions: `# Kiểm tra mật khẩu mạnh

## Bối cảnh
Form đăng ký của ứng dụng cần báo cho người dùng biết mật khẩu họ nhập còn **thiếu** gì. (Nhớ: trong đời thực không bao giờ gửi mật khẩu thật cho AI hay dán vào mã nguồn. Bài này chỉ dùng mật khẩu thử nghiệm.)

## Yêu cầu
Trong \`main.py\`:

- \`kiem_tra_mat_khau(mk)\`: trả về một tuple \`(hop_le, loi)\`:
  - \`hop_le\` là \`True\` khi không có lỗi nào;
  - \`loi\` là danh sách mã lỗi theo **đúng thứ tự** sau (chỉ gồm các lỗi vi phạm):
    1. \`"qua_ngan"\`: ít hơn 8 ký tự;
    2. \`"thieu_chu_hoa"\`: không có chữ hoa;
    3. \`"thieu_chu_thuong"\`: không có chữ thường;
    4. \`"thieu_chu_so"\`: không có chữ số;
    5. \`"thieu_ky_tu_dac_biet"\`: không có ký tự trong \`string.punctuation\`;
    6. \`"chua_khoang_trang"\`: có chứa dấu cách.
- \`do_manh(mk)\`: trả về \`"Mạnh"\` nếu 0 lỗi, \`"Trung bình"\` nếu 1 hoặc 2 lỗi, \`"Yếu"\` nếu từ 3 lỗi trở lên.

## Ví dụ vào/ra
\`\`\`python
kiem_tra_mat_khau("Abcdef1!")   # (True, [])
kiem_tra_mat_khau("abc")        # (False, ["qua_ngan", "thieu_chu_hoa", "thieu_chu_so", "thieu_ky_tu_dac_biet"])
do_manh("abcdefgh1")            # "Trung bình"   (thiếu chữ hoa và ký tự đặc biệt)
\`\`\`

## Ràng buộc
- Chỉ dùng thư viện chuẩn; không \`input()\`, không \`print()\` trong hàm.
- Không lưu hay in mật khẩu ra đâu cả.

## Cách hỏi AI cho tốt
Hãy nhờ AI **liệt kê các quy tắc** thành bảng trước khi viết code, và kiểm tra bảng đó có đúng đề của bạn không. Rồi hỏi: "Quy tắc độ dài tối thiểu 8 và đủ loại ký tự có thực sự làm mật khẩu an toàn không? Mật khẩu nào qua được các quy tắc này mà vẫn yếu?" (ví dụ \`Password1!\`). Đây là bài học về giới hạn của quy tắc.

## Cách tự kiểm tra
\`python3 check.py\`. Tự thử vài mật khẩu thử nghiệm bằng \`print(kiem_tra_mat_khau("..."))\`.`,
    files: {
      "main.py": `# Bài 5: Kiểm tra mật khẩu mạnh.
# Chạy kiểm tra:  python3 check.py

import string  # string.punctuation = các ký tự đặc biệt thường gặp


def kiem_tra_mat_khau(mk):
    """Trả về (hop_le, loi). loi là list mã lỗi theo đúng thứ tự trong DE-BAI.md."""
    # TODO
    pass


def do_manh(mk):
    """'Mạnh' (0 lỗi), 'Trung bình' (1-2 lỗi) hoặc 'Yếu' (>= 3 lỗi)."""
    # TODO
    pass
`,
      "check.py": `${PRELUDE_PY}

kiem_tra("mật khẩu tốt", lambda: lay("kiem_tra_mat_khau")("Abcdef1!"), (True, []))
kiem_tra(
    "mật khẩu 'abc' vi phạm 4 quy tắc",
    lambda: lay("kiem_tra_mat_khau")("abc"),
    (False, ["qua_ngan", "thieu_chu_hoa", "thieu_chu_so", "thieu_ky_tu_dac_biet"]),
)
kiem_tra("chỉ thiếu chữ hoa", lambda: lay("kiem_tra_mat_khau")("abcdef1!"), (False, ["thieu_chu_hoa"]))
kiem_tra("chỉ thiếu chữ thường", lambda: lay("kiem_tra_mat_khau")("ABCDEF1!"), (False, ["thieu_chu_thuong"]))
kiem_tra("chỉ thiếu chữ số", lambda: lay("kiem_tra_mat_khau")("Abcdefg!"), (False, ["thieu_chu_so"]))
kiem_tra("chỉ thiếu ký tự đặc biệt", lambda: lay("kiem_tra_mat_khau")("Abcdefg1"), (False, ["thieu_ky_tu_dac_biet"]))
kiem_tra("có khoảng trắng", lambda: lay("kiem_tra_mat_khau")("Abc def1!"), (False, ["chua_khoang_trang"]))
kiem_tra("đúng 8 ký tự là đủ dài", lambda: lay("kiem_tra_mat_khau")("Aa1!aaaa")[0], True)
kiem_tra("7 ký tự là quá ngắn", lambda: lay("kiem_tra_mat_khau")("Aa1!aaa"), (False, ["qua_ngan"]))
kiem_tra("chuỗi rỗng vi phạm tất cả trừ khoảng trắng", lambda: len(lay("kiem_tra_mat_khau")("")[1]), 5)
kiem_tra("do_manh mạnh", lambda: lay("do_manh")("Abcdef1!"), "Mạnh")
kiem_tra("do_manh trung bình", lambda: lay("do_manh")("abcdefgh1"), "Trung bình")
kiem_tra("do_manh yếu", lambda: lay("do_manh")("abc"), "Yếu")

ket_thuc()
`,
    },
    check: "check.py",
    solution: {
      "main.py": `# Bài 5: Kiểm tra mật khẩu mạnh.

import string


def kiem_tra_mat_khau(mk):
    loi = []
    if len(mk) < 8:
        loi.append("qua_ngan")
    if not any(k.isupper() for k in mk):
        loi.append("thieu_chu_hoa")
    if not any(k.islower() for k in mk):
        loi.append("thieu_chu_thuong")
    if not any(k.isdigit() for k in mk):
        loi.append("thieu_chu_so")
    if not any(k in string.punctuation for k in mk):
        loi.append("thieu_ky_tu_dac_biet")
    if " " in mk:
        loi.append("chua_khoang_trang")
    return (len(loi) == 0, loi)


def do_manh(mk):
    so_loi = len(kiem_tra_mat_khau(mk)[1])
    if so_loi == 0:
        return "Mạnh"
    if so_loi <= 2:
        return "Trung bình"
    return "Yếu"
`,
    },
    hints: [
      "Từng quy tắc là một điều kiện riêng; mỗi điều kiện sai thì thêm một mã lỗi vào danh sách `loi`. Cuối hàm: `return (len(loi) == 0, loi)`.",
      "Kiểm tra \"có ít nhất một ký tự thỏa điều kiện\" bằng `any(ky_tu.isupper() for ky_tu in mk)`. Tương tự `islower()`, `isdigit()`.",
      "Ký tự đặc biệt: dùng `string.punctuation` (nhớ `import string`), kiểm tra `any(k in string.punctuation for k in mk)`. Khoảng trắng: `\" \" in mk`.",
      "Thứ tự mã lỗi trong danh sách phải đúng như đề (qua_ngan, thieu_chu_hoa, ...). `do_manh` chỉ cần đếm `len(loi)` rồi so với 0, 2.",
    ],
    concepts: ["chuỗi","any() và all()","danh sách lỗi","tuple","an toàn thông tin"],
    minutes: 20,
  },
  {
    id: "py-06-sua-loi-thong-ke",
    lang: "py",
    level: 3,
    title: "Sửa lỗi: thống kê điểm",
    goal: "Gỡ lỗi một hàm thống kê có nhiều lỗi: bỏ sót phần tử, khởi tạo sai, chia sai mẫu số, sửa dữ liệu đầu vào và trung vị sai.",
    instructions: `# Sửa lỗi: thống kê điểm

## Bối cảnh
Hàm \`thong_ke\` tính vài số liệu thống kê từ danh sách điểm nhưng cho ra con số sai. Nhiệm vụ: tìm và sửa lỗi, không cần viết lại từ đầu.

## Đặc tả
\`thong_ke(ds)\` với \`ds\` là danh sách số, trả về từ điển:

| Khóa | Ý nghĩa |
| --- | --- |
| \`so_luong\` | số phần tử |
| \`tong\` | tổng |
| \`trung_binh\` | trung bình cộng, làm tròn 2 chữ số |
| \`lon_nhat\`, \`nho_nhat\` | giá trị lớn nhất, nhỏ nhất |
| \`trung_vi\` | trung vị (số ở giữa khi đã sắp xếp; số phần tử chẵn thì lấy trung bình hai số giữa) |

Danh sách rỗng trả về: \`so_luong = 0\`, \`tong = 0\`, \`trung_binh = 0\`, và \`lon_nhat\`, \`nho_nhat\`, \`trung_vi\` đều là \`None\`.

Hàm **không được thay đổi** danh sách đầu vào.

## Ví dụ
\`\`\`python
thong_ke([5, 3, 8])
# {"so_luong": 3, "tong": 16, "trung_binh": 5.33, "lon_nhat": 8, "nho_nhat": 3, "trung_vi": 5}
thong_ke([1, 2, 3, 4])["trung_vi"]   # 2.5
\`\`\`

## Ràng buộc
- Chỉ dùng thư viện chuẩn.
- Giữ nguyên tên hàm và các khóa của từ điển trả về.

## Cách hỏi AI cho tốt
Dán đặc tả, đoạn code và các dòng FAIL cho AI, rồi hỏi: "Liệt kê MỌI chỗ khác với đặc tả, kèm lý do, nhưng chưa sửa." Sau đó **tự sửa** từng chỗ một và chạy lại. So sánh danh sách của AI với những gì bạn tự tìm được: AI có bỏ sót lỗi nào không? Có chỗ nào AI "sửa" mà thực ra đúng?

## Cách tự kiểm tra
\`python3 check.py\`. Mỗi lần sửa xong một lỗi, số dòng PASS phải tăng.`,
    files: {
      "main.py": `# Bài 6: Sửa lỗi thống kê điểm.
# Hàm dưới đây CÓ LỖI. Đọc đặc tả trong DE-BAI.md, tìm và sửa.
# Chạy kiểm tra:  python3 check.py


def thong_ke(ds):
    n = len(ds)
    tong = 0
    for i in range(1, n):
        tong += ds[i]

    lon_nhat = 0
    nho_nhat = 0
    for x in ds:
        if x > lon_nhat:
            lon_nhat = x
        if x < nho_nhat:
            nho_nhat = x

    trung_binh = round(tong / (n + 1), 2)

    ds.sort()
    trung_vi = ds[n // 2]

    return {
        "so_luong": n,
        "tong": tong,
        "trung_binh": trung_binh,
        "lon_nhat": lon_nhat,
        "nho_nhat": nho_nhat,
        "trung_vi": trung_vi,
    }
`,
      "check.py": `${PRELUDE_PY}

def tk(ds):
    return lay("thong_ke")(ds)


MAU = [5, 3, 8]
kiem_tra("so_luong", lambda: tk(list(MAU))["so_luong"], 3)
kiem_tra("tong của [5, 3, 8]", lambda: tk(list(MAU))["tong"], 16)
kiem_tra("trung_binh của [5, 3, 8]", lambda: tk(list(MAU))["trung_binh"], 5.33)
kiem_tra("lon_nhat khi toàn số dương", lambda: tk([5, 3, 8])["lon_nhat"], 8)
kiem_tra("nho_nhat khi toàn số dương", lambda: tk([5, 3, 8])["nho_nhat"], 3)
kiem_tra("lon_nhat khi toàn số âm", lambda: tk([-5, -2, -9])["lon_nhat"], -2)
kiem_tra("nho_nhat khi toàn số âm", lambda: tk([-5, -2, -9])["nho_nhat"], -9)
kiem_tra("trung_vi số phần tử lẻ", lambda: tk([9, 1, 5])["trung_vi"], 5)
kiem_tra("trung_vi số phần tử chẵn", lambda: tk([4, 1, 3, 2])["trung_vi"], 2.5)


def khong_doi_ds():
    ds = [3, 1, 2]
    tk(ds)
    return ds == [3, 1, 2]


kiem_tra_dieu_kien("không thay đổi danh sách đầu vào", khong_doi_ds, "danh sách đầu vào đã bị sắp xếp/thay đổi (hãy dùng sorted thay vì sort)")
kiem_tra(
    "danh sách rỗng",
    lambda: tk([]),
    {"so_luong": 0, "tong": 0, "trung_binh": 0, "lon_nhat": None, "nho_nhat": None, "trung_vi": None},
)
kiem_tra("một phần tử", lambda: tk([7]), {"so_luong": 1, "tong": 7, "trung_binh": 7, "lon_nhat": 7, "nho_nhat": 7, "trung_vi": 7})

ket_thuc()
`,
    },
    check: "check.py",
    solution: {
      "main.py": `# Bài 6: Thống kê điểm (bản đã sửa).


def thong_ke(ds):
    n = len(ds)
    if n == 0:
        return {"so_luong": 0, "tong": 0, "trung_binh": 0, "lon_nhat": None, "nho_nhat": None, "trung_vi": None}

    tong = 0
    for x in ds:
        tong += x

    lon_nhat = ds[0]
    nho_nhat = ds[0]
    for x in ds:
        if x > lon_nhat:
            lon_nhat = x
        if x < nho_nhat:
            nho_nhat = x

    trung_binh = round(tong / n, 2)

    da_sap = sorted(ds)
    if n % 2 == 1:
        trung_vi = da_sap[n // 2]
    else:
        trung_vi = (da_sap[n // 2 - 1] + da_sap[n // 2]) / 2

    return {
        "so_luong": n,
        "tong": tong,
        "trung_binh": trung_binh,
        "lon_nhat": lon_nhat,
        "nho_nhat": nho_nhat,
        "trung_vi": trung_vi,
    }
`,
    },
    hints: [
      "Chạy `python3 check.py` và đọc kỹ từng dòng FAIL. Thêm `print` vào hàm để xem `tong`, `lon_nhat`, `nho_nhat` sau vòng lặp, rồi so với kết quả bạn tự tính tay trên danh sách nhỏ.",
      "Hãy chú ý: `range(1, n)` bắt đầu từ chỉ số nào? Mẫu số của trung bình cộng phải là gì? Và `lon_nhat = 0` sẽ sai với dữ liệu nào?",
      "`ds.sort()` sắp xếp NGAY TRONG danh sách đầu vào, làm thay đổi dữ liệu của người gọi. Hãy dùng `sorted(ds)` để tạo bản sao đã sắp. Trung vị với số phần tử chẵn là trung bình của hai phần tử giữa.",
      "Đừng quên danh sách rỗng: đề yêu cầu trả về các giá trị cụ thể, và hiện tại hàm sẽ báo lỗi chỉ số. Xử lý trường hợp này ngay đầu hàm.",
    ],
    concepts: ["gỡ lỗi","khởi tạo biến","tác dụng phụ","trung vị","danh sách rỗng"],
    minutes: 25,
  },
  {
    id: "py-07-so-chi-tieu",
    lang: "py",
    level: 3,
    title: "Sổ chi tiêu bằng lớp",
    goal: "Thiết kế một lớp nhỏ quản lý các khoản chi: thêm, kiểm tra dữ liệu, thống kê theo danh mục và lưu/nạp dưới dạng JSON.",
    instructions: `# Sổ chi tiêu bằng lớp

## Bối cảnh
Bạn muốn theo dõi chi tiêu hàng tháng. Dữ liệu cần được kiểm tra (không có khoản chi âm), thống kê theo danh mục, và lưu lại được (dạng JSON) để mở lại lần sau. Bài này luyện cách tổ chức dữ liệu và hành vi vào **một lớp**.

## Yêu cầu
Trong \`main.py\`, hoàn thành lớp \`SoChiTieu\`:

- \`them(so_tien, danh_muc, ghi_chu="")\`: thêm một khoản chi. Nếu \`so_tien <= 0\` thì ném \`ValueError\`.
- \`tong()\`: tổng tất cả khoản chi (sổ rỗng là \`0\`).
- \`tong_theo_danh_muc()\`: từ điển \`{danh_muc: tổng}\`.
- \`danh_muc_nhieu_nhat()\`: tên danh mục có tổng chi cao nhất; sổ rỗng thì trả về \`None\`.
- \`xuat_json()\`: chuỗi JSON của danh sách các khoản chi (mỗi khoản có khóa \`so_tien\`, \`danh_muc\`, \`ghi_chu\`).
- \`SoChiTieu.tu_json(text)\` (phương thức lớp): tạo \`SoChiTieu\` mới từ chuỗi JSON do \`xuat_json\` sinh ra.

## Ví dụ
\`\`\`python
so = SoChiTieu()
so.them(35000, "ăn uống", "bún chả")
so.them(120000, "học tập", "sách")
so.them(25000, "ăn uống")
so.tong()                  # 180000
so.tong_theo_danh_muc()    # {"ăn uống": 60000, "học tập": 120000}
so.danh_muc_nhieu_nhat()   # "học tập"
so2 = SoChiTieu.tu_json(so.xuat_json())
so2.tong()                 # 180000
\`\`\`

## Ràng buộc
- Chỉ dùng thư viện chuẩn; không đọc/ghi tệp, không \`input()\` trong lớp (việc lưu ra tệp để chương trình chính lo).
- Giữ nguyên tên lớp, tên phương thức.

## Cách hỏi AI cho tốt
Mô tả **hợp đồng** của từng phương thức như bảng trên (đầu vào, đầu ra, trường hợp lỗi). Sau khi có code, nhờ AI viết thêm 3 ca kiểm thử mà bạn chưa nghĩ ra, rồi **tự đánh giá** các ca đó có hợp lý không. Hỏi thêm: "Số tiền kiểu \`float\` có gây sai số khi cộng nhiều lần không? Nên lưu theo đồng (số nguyên) hay không?"

## Cách tự kiểm tra
\`python3 check.py\`. Tự thử trong một tệp riêng: tạo sổ, thêm vài khoản, \`print(so.xuat_json())\`.`,
    files: {
      "main.py": `# Bài 7: Sổ chi tiêu bằng lớp.
# Chạy kiểm tra:  python3 check.py

import json  # dùng cho xuat_json / tu_json


class SoChiTieu:
    def __init__(self):
        # Mỗi khoản chi là một dict: {"so_tien": ..., "danh_muc": ..., "ghi_chu": ...}
        self.khoan_chi = []

    def them(self, so_tien, danh_muc, ghi_chu=""):
        """Thêm một khoản chi. so_tien <= 0 -> ném ValueError."""
        # TODO
        pass

    def tong(self):
        """Tổng tất cả khoản chi."""
        # TODO
        pass

    def tong_theo_danh_muc(self):
        """Dict {danh_muc: tổng}."""
        # TODO
        pass

    def danh_muc_nhieu_nhat(self):
        """Tên danh mục chi nhiều nhất; sổ rỗng -> None."""
        # TODO
        pass

    def xuat_json(self):
        """Chuỗi JSON của danh sách khoản chi."""
        # TODO
        pass

    @classmethod
    def tu_json(cls, text):
        """Tạo SoChiTieu mới từ chuỗi JSON do xuat_json sinh ra."""
        # TODO
        pass
`,
      "check.py": `${PRELUDE_PY}

import json


def moi():
    return lay("SoChiTieu")()


def so_mau():
    so = moi()
    so.them(35000, "ăn uống", "bún chả")
    so.them(120000, "học tập", "sách")
    so.them(25000, "ăn uống")
    return so


kiem_tra("sổ rỗng có tổng 0", lambda: moi().tong(), 0)
kiem_tra("tong sau khi thêm 3 khoản", lambda: so_mau().tong(), 180000)
kiem_tra("tong_theo_danh_muc", lambda: so_mau().tong_theo_danh_muc(), {"ăn uống": 60000, "học tập": 120000})
kiem_tra("danh_muc_nhieu_nhat", lambda: so_mau().danh_muc_nhieu_nhat(), "học tập")
kiem_tra("danh_muc_nhieu_nhat khi sổ rỗng là None", lambda: moi().danh_muc_nhieu_nhat(), None)


def loi_gia_tri(gia_tri):
    so = moi()
    try:
        so.them(gia_tri, "x")
    except ValueError:
        return "ValueError"
    return "không ném lỗi"


kiem_tra("so_tien = 0 phải ném ValueError", lambda: loi_gia_tri(0), "ValueError")
kiem_tra("so_tien âm phải ném ValueError", lambda: loi_gia_tri(-5000), "ValueError")


def khoan_loi_khong_duoc_them():
    so = moi()
    try:
        so.them(-1, "x")
    except ValueError:
        pass
    return so.tong()


kiem_tra("khoản chi sai không được thêm vào sổ", khoan_loi_khong_duoc_them, 0)


def cau_truc_json():
    du_lieu = json.loads(so_mau().xuat_json())
    return isinstance(du_lieu, list) and len(du_lieu) == 3 and all(
        set(k.keys()) == {"so_tien", "danh_muc", "ghi_chu"} for k in du_lieu
    )


kiem_tra("xuat_json là danh sách 3 khoản có đủ khóa", cau_truc_json, True)
kiem_tra("tu_json(xuat_json()) giữ nguyên tổng", lambda: lay("SoChiTieu").tu_json(so_mau().xuat_json()).tong(), 180000)
kiem_tra(
    "tu_json giữ nguyên thống kê theo danh mục",
    lambda: lay("SoChiTieu").tu_json(so_mau().xuat_json()).tong_theo_danh_muc(),
    {"ăn uống": 60000, "học tập": 120000},
)

ket_thuc()
`,
    },
    check: "check.py",
    solution: {
      "main.py": `# Bài 7: Sổ chi tiêu bằng lớp.

import json


class SoChiTieu:
    def __init__(self):
        self.khoan_chi = []

    def them(self, so_tien, danh_muc, ghi_chu=""):
        if so_tien <= 0:
            raise ValueError("Số tiền phải lớn hơn 0")
        self.khoan_chi.append({"so_tien": so_tien, "danh_muc": danh_muc, "ghi_chu": ghi_chu})

    def tong(self):
        return sum(k["so_tien"] for k in self.khoan_chi)

    def tong_theo_danh_muc(self):
        kq = {}
        for k in self.khoan_chi:
            kq[k["danh_muc"]] = kq.get(k["danh_muc"], 0) + k["so_tien"]
        return kq

    def danh_muc_nhieu_nhat(self):
        kq = self.tong_theo_danh_muc()
        if not kq:
            return None
        return max(kq, key=kq.get)

    def xuat_json(self):
        return json.dumps(self.khoan_chi, ensure_ascii=False)

    @classmethod
    def tu_json(cls, text):
        so = cls()
        so.khoan_chi = json.loads(text)
        return so
`,
    },
    hints: [
      "Trong `__init__` đã có `self.khoan_chi = []`. Mỗi khoản là một từ điển `{\"so_tien\": ..., \"danh_muc\": ..., \"ghi_chu\": ...}`. `them` kiểm tra `so_tien > 0` (nếu không thì `raise ValueError(...)`) rồi `append`.",
      "`tong()` cộng `so_tien` của mọi khoản. `tong_theo_danh_muc()` dùng từ điển: `kq[dm] = kq.get(dm, 0) + so_tien`. `danh_muc_nhieu_nhat()` là khóa có giá trị lớn nhất (`max(kq, key=kq.get)`), nhớ trường hợp sổ rỗng trả `None`.",
      "JSON: `json.dumps(self.khoan_chi, ensure_ascii=False)` để xuất, `json.loads(text)` để nạp (nhớ `import json`). `tu_json` là `@classmethod`: tạo `so = cls()`, gán `so.khoan_chi = json.loads(text)`, rồi trả `so`.",
      "Nếu `tu_json` trả `None`, bạn quên `return so`. Nếu `ValueError` không được ném, kiểm tra điều kiện `so_tien <= 0` ở đầu `them`, trước khi thêm vào danh sách.",
    ],
    concepts: ["lớp (class)","phương thức","ValueError","từ điển","JSON"],
    minutes: 30,
  },
  {
    id: "html-01-gioi-thieu",
    lang: "html",
    level: 1,
    title: "Trang giới thiệu bản thân",
    goal: "Dựng khung một trang HTML đúng chuẩn: tiêu đề, đoạn văn, danh sách, hình ảnh có mô tả và liên kết.",
    instructions: `# Trang giới thiệu bản thân

## Bối cảnh
Bạn làm một trang web một tệp để giới thiệu bản thân với bạn bè. Bài này luyện cấu trúc HTML đúng chuẩn, nền tảng cho mọi trang web sau này.

## Yêu cầu
Hoàn thành \`index.html\` sao cho có đủ:

1. Khai báo \`<!DOCTYPE html>\`, \`<html lang="vi">\`, \`<meta charset="utf-8">\`.
2. Thẻ \`<title>\` **không rỗng**.
3. Đúng **một** thẻ \`<h1>\` có nội dung (tên bạn).
4. Ít nhất một thẻ \`<h2>\` có nội dung (ví dụ "Sở thích").
5. Ít nhất một đoạn văn \`<p>\` có nội dung.
6. Một danh sách \`<ul>\` hoặc \`<ol>\` có **ít nhất 3** mục \`<li>\`.
7. Một hình \`<img>\` có \`src\` và \`alt\` **không rỗng**.
8. Một liên kết \`<a>\` có \`href\` bắt đầu bằng \`http://\` hoặc \`https://\`.

## Ràng buộc
- Chỉ dùng HTML (CSS tùy ý, thêm trong thẻ \`<style>\` hoặc tệp riêng).
- Nội dung do bạn tự viết. Không đưa thông tin cá nhân nhạy cảm (địa chỉ nhà, số điện thoại) vào trang!

## Cách hỏi AI cho tốt
Hãy mô tả trang bạn muốn thấy, ví dụ: "Tạo trang giới thiệu 1 tệp HTML với tên tôi là ..., 3 sở thích, 1 ảnh, 1 liên kết. Dùng thẻ ngữ nghĩa, giải thích mỗi thẻ ngắn gọn." Sau đó mở tệp trong trình duyệt và **đọc lại**: mỗi thẻ để làm gì? Hỏi AI: "Vì sao ảnh cần thuộc tính alt?"

## Cách tự kiểm tra
Chạy \`node check.js\` (bài này chấm bằng cách đọc nội dung \`index.html\`). Rồi mở \`index.html\` bằng trình duyệt để xem bằng mắt.`,
    files: {
      "index.html": `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title></title>
  </head>
  <body>
    <!-- TODO 1: điền thẻ <title> ở trên (tên trang) -->
    <!-- TODO 2: một tiêu đề lớn (h1) với tên bạn -->
    <!-- TODO 3: một đoạn văn (p) giới thiệu bản thân -->
    <!-- TODO 4: tiêu đề phụ (h2) "Sở thích" và một danh sách ul có ít nhất 3 mục li -->
    <!-- TODO 5: một hình ảnh (img) có src và alt -->
    <!-- TODO 6: một liên kết (a) tới một trang web bạn thích -->
  </body>
</html>
`,
      "check.js": `// ====== Phần chấm tự động (bạn không cần sửa tệp này) ======
// Chạy:  node check.js
// Bài HTML được chấm bằng cách đọc chữ trong index.html (không cần trình duyệt).
const fs = require("fs");

let coLoi = false;
function ok(ten) {
  console.log("PASS " + ten);
}
function loi(ten, lyDo) {
  console.log("FAIL " + ten + ": " + String(lyDo).replace(/\\s+/g, " ").trim());
  coLoi = true;
}
function kiemTraDieuKien(ten, dieuKien, lyDoNeuSai) {
  try {
    if (dieuKien()) ok(ten);
    else loi(ten, lyDoNeuSai);
  } catch (e) {
    loi(ten, "gặp lỗi khi chạy - " + (e && e.message ? e.message : e));
  }
}

let html;
try {
  html = fs.readFileSync("index.html", "utf8");
} catch (e) {
  console.log("FAIL đọc index.html: không tìm thấy tệp index.html trong thư mục bài");
  process.exit(1);
}
// Bỏ chú thích HTML để các dòng TODO không bị tính nhầm.
const sach = html.replace(/<!--[\\s\\S]*?-->/g, "");
const coChu = (s) => s.replace(/<[^>]*>/g, "").trim().length > 0;
const tatCa = (re) => Array.from(sach.matchAll(re));

kiemTraDieuKien("có <!DOCTYPE html>", () => /<!doctype\\s+html>/i.test(sach), "thiếu <!DOCTYPE html> ở dòng đầu");
kiemTraDieuKien('<html lang="vi">', () => /<html[^>]*\\blang\\s*=\\s*["']vi["']/i.test(sach), 'thẻ <html> cần thuộc tính lang="vi"');
kiemTraDieuKien("có meta charset", () => /<meta[^>]*charset\\s*=\\s*["']?utf-8/i.test(sach), 'thiếu <meta charset="utf-8">');
kiemTraDieuKien(
  "<title> không rỗng",
  () => {
    const m = sach.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);
    return !!m && m[1].trim().length > 0;
  },
  "thẻ <title> chưa có chữ"
);
kiemTraDieuKien(
  "đúng một <h1> có nội dung",
  () => {
    const h1 = tatCa(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/gi);
    return h1.length === 1 && coChu(h1[0][1]);
  },
  "cần đúng một thẻ <h1> có chữ bên trong (hiện có " + tatCa(/<h1[\\s>]/gi).length + " thẻ <h1>)"
);
kiemTraDieuKien("có <h2> có nội dung", () => tatCa(/<h2[^>]*>([\\s\\S]*?)<\\/h2>/gi).some((m) => coChu(m[1])), "cần ít nhất một thẻ <h2> có chữ");
kiemTraDieuKien("có <p> có nội dung", () => tatCa(/<p[^>]*>([\\s\\S]*?)<\\/p>/gi).some((m) => coChu(m[1])), "cần ít nhất một đoạn <p> có chữ");
kiemTraDieuKien(
  "danh sách có từ 3 mục <li> trở lên",
  () => {
    const dsach = tatCa(/<(ul|ol)[^>]*>([\\s\\S]*?)<\\/\\1>/gi);
    return dsach.some((m) => (m[2].match(/<li[\\s>]/gi) || []).length >= 3);
  },
  "cần một <ul> hoặc <ol> chứa ít nhất 3 thẻ <li>"
);
kiemTraDieuKien(
  "<img> có src và alt không rỗng",
  () =>
    tatCa(/<img\\b[^>]*>/gi).some((m) => {
      const t = m[0];
      const src = t.match(/\\bsrc\\s*=\\s*["']([^"']+)["']/i);
      const alt = t.match(/\\balt\\s*=\\s*["']([^"']+)["']/i);
      return !!src && !!alt && alt[1].trim() !== "";
    }),
  "cần một thẻ <img> với src và alt đều có nội dung"
);
kiemTraDieuKien(
  "có liên kết <a href> bắt đầu bằng http(s)",
  () => tatCa(/<a\\b[^>]*>/gi).some((m) => /\\bhref\\s*=\\s*["']https?:\\/\\/[^"']+["']/i.test(m[0])),
  'cần một thẻ <a href="https://...">'
);

process.exit(coLoi ? 1 : 0);
`,
    },
    check: "check.js",
    solution: {
      "index.html": `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Trang giới thiệu của Lan</title>
  </head>
  <body>
    <h1>Xin chào, mình là Lan</h1>
    <p>Mình là sinh viên năm hai, đang tập lập trình web cùng trợ lý AI.</p>
    <h2>Sở thích</h2>
    <ul>
      <li>Đọc sách</li>
      <li>Chạy bộ buổi sáng</li>
      <li>Nấu ăn</li>
    </ul>
    <img src="anh.jpg" alt="Ảnh chân dung của Lan ở công viên" width="200" />
    <p>Trang web mình thích: <a href="https://developer.mozilla.org/">MDN Web Docs</a></p>
  </body>
</html>
`,
    },
    hints: [
      "Mở `index.html` và đọc các dòng ghi chú TODO trong thẻ `<body>`. Khung `<!DOCTYPE>`, `<html>`, `<head>` đã có, nhưng thẻ `<title>` còn trống.",
      "Mỗi trang chỉ nên có MỘT thẻ `<h1>` (tên của bạn). Các mục nhỏ hơn dùng `<h2>`. Danh sách dùng `<ul>` chứa các `<li>`.",
      "Hình ảnh: `<img src=\"anh.jpg\" alt=\"mô tả ngắn ảnh\">`. Thuộc tính `alt` giúp người dùng đọc màn hình và hiển thị khi ảnh lỗi, nên không được để trống. Bạn không cần có tệp ảnh thật để vượt bài kiểm tra này, nhưng hãy thử thêm một ảnh thật vào thư mục.",
      "Liên kết: `<a href=\"https://...\">chữ hiển thị</a>`, địa chỉ phải bắt đầu bằng `http://` hoặc `https://`. Chạy `node check.js` để xem bạn còn thiếu gì.",
    ],
    concepts: ["cấu trúc HTML","thẻ ngữ nghĩa","danh sách","hình ảnh và alt","liên kết"],
    minutes: 15,
  },
  {
    id: "html-02-form-bmi",
    lang: "html",
    level: 2,
    title: "Biểu mẫu tính BMI",
    goal: "Dựng biểu mẫu có nhãn gắn đúng ô nhập, nút bấm, vùng hiển thị kết quả và đoạn JavaScript xử lý sự kiện.",
    instructions: `# Biểu mẫu tính BMI

## Bối cảnh
Bạn làm một trang tính chỉ số khối cơ thể (BMI): người dùng nhập cân nặng (kg) và chiều cao (m), bấm nút, trang hiển thị kết quả ngay mà không tải lại.

## Yêu cầu
Hoàn thành \`index.html\` sao cho có:

1. Thẻ \`<form id="form-bmi">\`.
2. Hai ô nhập \`<input>\` có \`id="can-nang"\` và \`id="chieu-cao"\`, mỗi ô có thẻ \`<label for="...">\` **gắn đúng** \`id\` của nó.
3. Một nút \`<button>\` nằm trong form.
4. Một vùng hiển thị kết quả có \`id="ket-qua"\`.
5. Một thẻ \`<script>\` chứa mã JavaScript **không có lỗi cú pháp**, tham chiếu đến \`form-bmi\`, \`can-nang\`, \`chieu-cao\`, \`ket-qua\`, và dùng \`addEventListener\`.
6. Nếu bạn lắng nghe sự kiện \`"submit"\` thì phải gọi \`preventDefault()\`.

## Công thức
BMI = cân nặng (kg) / (chiều cao (m) x chiều cao (m)). Ví dụ 60 kg, 1.65 m cho BMI khoảng 22.04.

## Ràng buộc
- Chỉ một tệp \`index.html\` (HTML + JavaScript trong thẻ \`<script>\`).
- Không dùng thư viện ngoài.
- Bộ chấm chỉ đọc chữ trong \`index.html\`, không mở trình duyệt, nên bạn hãy tự mở tệp bằng trình duyệt để thử thật.

## Cách hỏi AI cho tốt
Nêu rõ **các id bắt buộc** ở trên trong yêu cầu. Sau khi AI sinh trang, hãy hỏi: "Điều gì xảy ra nếu người dùng để trống ô chiều cao? Nếu nhập 0?" rồi tự thử trên trình duyệt. Đừng tin hộp thoại "đã chạy tốt" của AI nếu bạn chưa thử.

## Cách tự kiểm tra
\`node check.js\` đọc \`index.html\` và liệt kê điểm còn thiếu. Sau đó mở trang trong trình duyệt và nhập thử vài giá trị, kể cả giá trị sai.`,
    files: {
      "index.html": `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tính BMI</title>
  </head>
  <body>
    <h1>Tính chỉ số BMI</h1>

    <!-- TODO 1: thẻ form với id="form-bmi" -->
    <!--   TODO 2: label for="can-nang" + input id="can-nang" (kg) -->
    <!--   TODO 3: label for="chieu-cao" + input id="chieu-cao" (m) -->
    <!--   TODO 4: một nút button gửi biểu mẫu -->
    <!-- TODO 5: một thẻ p hoặc div có id="ket-qua" để hiện kết quả -->

    <script>
      // TODO 6: lấy form, lắng nghe sự kiện "submit", gọi preventDefault(),
      // đọc hai ô nhập, tính BMI và ghi vào phần tử ket-qua.
    </script>
  </body>
</html>
`,
      "check.js": `// ====== Phần chấm tự động (bạn không cần sửa tệp này) ======
// Chạy:  node check.js
// Bài HTML được chấm bằng cách đọc chữ trong index.html (không cần trình duyệt).
const fs = require("fs");

let coLoi = false;
function ok(ten) {
  console.log("PASS " + ten);
}
function loi(ten, lyDo) {
  console.log("FAIL " + ten + ": " + String(lyDo).replace(/\\s+/g, " ").trim());
  coLoi = true;
}
function kiemTraDieuKien(ten, dieuKien, lyDoNeuSai) {
  try {
    if (dieuKien()) ok(ten);
    else loi(ten, lyDoNeuSai);
  } catch (e) {
    loi(ten, "gặp lỗi khi chạy - " + (e && e.message ? e.message : e));
  }
}

let html;
try {
  html = fs.readFileSync("index.html", "utf8");
} catch (e) {
  console.log("FAIL đọc index.html: không tìm thấy tệp index.html trong thư mục bài");
  process.exit(1);
}
const sach = html.replace(/<!--[\\s\\S]*?-->/g, "");
const tatCa = (re) => Array.from(sach.matchAll(re));
const thuocTinh = (tag, ten) => {
  const m = tag.match(new RegExp("\\\\b" + ten + "\\\\s*=\\\\s*[\\"']([^\\"']*)[\\"']", "i"));
  return m ? m[1] : null;
};

// Mã trong các thẻ <script> không có thuộc tính src
const maScript = tatCa(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)
  .filter((m) => !/\\bsrc\\s*=/.test(m[1]))
  .map((m) => m[2])
  .join("\\n");
// Bỏ chú thích JS để "TODO" trong chú thích không bị tính nhầm
const maSach = maScript.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "").replace(/(^|[^:])\\/\\/.*$/gm, "$1");

kiemTraDieuKien("có <form id=\\"form-bmi\\">", () => tatCa(/<form\\b[^>]*>/gi).some((m) => thuocTinh(m[0], "id") === "form-bmi"), 'thiếu thẻ <form id="form-bmi">');

for (const id of ["can-nang", "chieu-cao"]) {
  kiemTraDieuKien(
    "ô nhập #" + id + " có <label for> gắn đúng",
    () => {
      const coInput = tatCa(/<input\\b[^>]*>/gi).some((m) => thuocTinh(m[0], "id") === id);
      const coLabel = tatCa(/<label\\b[^>]*>/gi).some((m) => thuocTinh(m[0], "for") === id);
      return coInput && coLabel;
    },
    'cần <input id="' + id + '"> và <label for="' + id + '">'
  );
}

kiemTraDieuKien(
  "có nút <button> trong form",
  () => tatCa(/<form\\b[^>]*>([\\s\\S]*?)<\\/form>/gi).some((m) => /<button\\b/i.test(m[1])),
  "cần một thẻ <button> nằm giữa <form> và </form>"
);
kiemTraDieuKien("có vùng kết quả id=\\"ket-qua\\"", () => tatCa(/<(p|div|span|output)\\b[^>]*>/gi).some((m) => thuocTinh(m[0], "id") === "ket-qua"), 'thiếu phần tử có id="ket-qua"');
kiemTraDieuKien("có thẻ <script> chứa mã", () => maSach.trim().length > 20, "thẻ <script> còn trống hoặc chỉ có chú thích");
kiemTraDieuKien(
  "mã JavaScript không có lỗi cú pháp",
  () => {
    try {
      new Function(maSach);
      return true;
    } catch (e) {
      return false;
    }
  },
  "mã trong <script> có lỗi cú pháp; kiểm tra ngoặc, dấu ; và dấu nháy"
);
kiemTraDieuKien(
  "script tham chiếu đủ các id cần thiết",
  () => ["form-bmi", "can-nang", "chieu-cao", "ket-qua"].every((id) => maSach.includes(id)),
  "mã JavaScript phải nhắc tới form-bmi, can-nang, chieu-cao và ket-qua"
);
kiemTraDieuKien("script dùng addEventListener", () => /addEventListener\\s*\\(/.test(maSach), "hãy lắng nghe sự kiện bằng addEventListener(...)");
kiemTraDieuKien(
  "lắng nghe submit thì có preventDefault",
  () => !/["']submit["']/.test(maSach) || /preventDefault\\s*\\(\\s*\\)/.test(maSach),
  "bạn đang lắng nghe 'submit' nhưng chưa gọi event.preventDefault(): trang sẽ tải lại và mất kết quả"
);

process.exit(coLoi ? 1 : 0);
`,
    },
    check: "check.js",
    solution: {
      "index.html": `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tính BMI</title>
  </head>
  <body>
    <h1>Tính chỉ số BMI</h1>

    <form id="form-bmi">
      <p>
        <label for="can-nang">Cân nặng (kg)</label>
        <input id="can-nang" type="number" min="1" step="any" required />
      </p>
      <p>
        <label for="chieu-cao">Chiều cao (m)</label>
        <input id="chieu-cao" type="number" min="0.5" step="any" required />
      </p>
      <button type="submit">Tính BMI</button>
    </form>
    <p id="ket-qua"></p>

    <script>
      const form = document.getElementById("form-bmi");
      const ketQua = document.getElementById("ket-qua");

      form.addEventListener("submit", function (e) {
        e.preventDefault(); // không cho trang tải lại
        const canNang = Number(document.getElementById("can-nang").value);
        const chieuCao = Number(document.getElementById("chieu-cao").value);
        if (!(canNang > 0) || !(chieuCao > 0)) {
          ketQua.textContent = "Vui lòng nhập số dương.";
          return;
        }
        const bmi = canNang / (chieuCao * chieuCao);
        ketQua.textContent = "BMI của bạn: " + bmi.toFixed(2);
      });
    </script>
  </body>
</html>
`,
    },
    hints: [
      "Mỗi ô nhập cần một `id` duy nhất và một `<label for=\"...\">` có `for` trùng với `id` đó. Ví dụ `<label for=\"can-nang\">` đi với `<input id=\"can-nang\" type=\"number\">`.",
      "Nút bấm: `<button type=\"submit\">` đặt BÊN TRONG `<form id=\"form-bmi\">`. Vùng kết quả: `<p id=\"ket-qua\"></p>`.",
      "Trong thẻ `<script>`: lấy phần tử bằng `document.getElementById(\"form-bmi\")`, gắn `addEventListener(\"submit\", function (e) { e.preventDefault(); ... })`. Nếu quên `preventDefault`, trang sẽ tải lại và mất kết quả.",
      "Công thức BMI = cân nặng (kg) chia bình phương chiều cao (m). Đọc giá trị từ ô nhập bằng `.value`, đổi sang số bằng `Number(...)`, ghi kết quả vào `ket-qua` bằng `.textContent`. Kiểm tra đầu vào để tránh chia cho 0.",
    ],
    concepts: ["form","label và id","nút bấm","sự kiện","DOM","JavaScript trong HTML"],
    minutes: 25,
  },
];
