import { createDocx } from "./office/docx-write";
import { createXlsx } from "./office/xlsx";

/** Bộ tệp mẫu cho tab Work (dữ liệu hoàn toàn giả lập), dùng cho các kịch bản training. Sinh bằng chính công cụ Office của agent. */
const LAST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ"];
const MID = ["Văn", "Thị", "Minh", "Quốc", "Thu", "Hoài", "Đức", "Ngọc"];
const GIVEN = ["An", "Bình", "Chi", "Dũng", "Giang", "Hà", "Hạnh", "Hùng", "Khánh", "Lan", "Linh", "Mai", "Nam", "Phúc", "Quân", "Sơn", "Thảo", "Trang", "Tú", "Việt", "Yến", "Hiếu", "Oanh", "Long"];

function students(n: number): (string | number)[][] {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const score = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 2) / 2;
  return Array.from({ length: n }, (_, i) => [
    `1123${String(i + 1).padStart(4, "0")}`,
    `${LAST[Math.floor(rnd() * LAST.length)]} ${MID[Math.floor(rnd() * MID.length)]} ${GIVEN[i % GIVEN.length]}`,
    i % 2 ? "K65-CNTT2" : "K65-CNTT1",
    score(6, 10),
    score(3, 9.5),
    score(2.5, 9.5),
  ]);
}

export async function buildWorkSamples(): Promise<Record<string, string | Uint8Array>> {
  const out: Record<string, string | Uint8Array> = {};

  out["diem-hoc-phan.xlsx"] = (await createXlsx([
    { name: "Điểm", rows: [["MSSV", "Họ tên", "Lớp", "Chuyên cần", "Giữa kỳ", "Cuối kỳ"], ...students(24)], autofilter: true },
    { name: "Quy chế", rows: [["Thành phần", "Trọng số"], ["Chuyên cần", 0.1], ["Giữa kỳ", 0.3], ["Cuối kỳ", 0.6], ["", ""], ["Xếp loại", "Điểm từ"], ["Giỏi", 8.5], ["Khá", 7], ["Trung bình", 5], ["Yếu", 0]], number_formats: { B: "0.0" } },
  ])).bytes;

  out["du-toan-hoi-thao.xlsx"] = (await createXlsx([{
    name: "Dự toán",
    rows: [
      ["TT", "Nội dung", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền"],
      [1, "Thuê hội trường", "buổi", 1, 8000000, "=D2*E2"],
      [2, "Tea break", "người", 120, 35000, "=D3*E3"],
      [3, "In ấn tài liệu", "bộ", 120, 12000, "=D4*E4"],
      [4, "Banner, backdrop", "cái", 2, 1500000, "=D5*E5"],
      [5, "Thù lao báo cáo viên", "người", 3, "3.000.000", "=D6*E6"],
      [6, "Tea break", "người", 120, 35000, "=D7*E7"],
      [7, "Quà lưu niệm", "phần", -10, 150000, "=D8*E8"],
      ["", "Tổng cộng", "", "", "", "=SUM(F2:F7)"],
    ],
    number_formats: { E: "#,##0", F: "#,##0" },
  }])).bytes;

  out["danh-sach-moi.xlsx"] = (await createXlsx([{
    name: "Khách mời",
    rows: [
      ["Họ tên", "Chức vụ", "Đơn vị", "Email", "Vai trò"],
      ["PGS.TS. Lê Minh Hoàng", "Phó Viện trưởng", "Viện Nghiên cứu Giáo dục số", "hoang.le@example.edu.vn", "Báo cáo chính"],
      ["TS. Phạm Thu Hà", "Trưởng bộ môn", "Khoa Hệ thống thông tin", "ha.pham@example.edu.vn", "Báo cáo viên"],
      ["ThS. Đặng Quốc Việt", "Giảng viên", "Khoa Công nghệ thông tin", "viet.dang@example.edu.vn", "Báo cáo viên"],
      ["Bà Nguyễn Hoài Thu", "Giám đốc", "Công ty Giải pháp Học tập Số", "thu.nguyen@example.com", "Đại diện doanh nghiệp"],
      ["Ông Trần Đức Long", "Trưởng phòng", "Phòng Đào tạo", "long.tran@example.edu.vn", "Khách mời"],
      ["TS. Vũ Ngọc Anh", "Phó trưởng khoa", "Khoa Toán kinh tế", "anh.vu@example.edu.vn", "Phản biện"],
    ],
  }])).bytes;

  out["thong-bao-nhap.docx"] = await createDocx({
    style: "modern",
    content: "# thong bao hop khoa\n\nKính gưi các thầy cô trong Khoa,\n\nKhoa se to chuc hop giao ban vào ngày 5/10/2026 luc 14h tai phòng 401 nha A1. Noi dung: tổng kết hoạt động tháng 9 và triển khai kế hoạch tháng 10.\nĐề nghi các thầy cô sắp xếp thời gian tham du đầy đủ. Hạn nộp báo cáo cá nhân là ngày 03-10-2026.\n\nTrân trọng\n\nTrưởng khoa",
  });

  out["ke-hoach-hoi-thao.docx"] = await createDocx({
    style: "formal",
    title: "KẾ HOẠCH TỔ CHỨC HỘI THẢO",
    subtitle: "“Ứng dụng AI trong giảng dạy và nghiên cứu” — Khoa Công nghệ thông tin",
    content: "## 1. Mục đích, yêu cầu\n\nTạo diễn đàn trao đổi kinh nghiệm ứng dụng trí tuệ nhân tạo trong giảng dạy, học tập và nghiên cứu khoa học; giới thiệu các công cụ AI do Khoa vận hành; hình thành nhóm nòng cốt triển khai trong năm học 2026–2027.\n\n## 2. Thời gian, địa điểm\n\n- Thời gian: 14h00, thứ Sáu, ngày 17/10/2026.\n- Địa điểm: Phòng họp 401, Nhà A1.\n- Quy mô: 100 đại biểu (giảng viên, nghiên cứu viên, sinh viên chương trình tài năng).\n\n## 3. Nội dung chương trình\n\n| TT | Nội dung | Thời lượng | Phụ trách |\n|:--:|---|---:|---|\n| 1 | Đón tiếp, khai mạc | 15 phút | Ban tổ chức |\n| 2 | Báo cáo chính: Xu hướng AI trong giáo dục đại học | 40 phút | PGS.TS. Lê Minh Hoàng |\n| 3 | Chia sẻ kinh nghiệm: AI hỗ trợ soạn giảng và chấm bài | 30 phút | TS. Phạm Thu Hà |\n| 4 | Giới thiệu nền tảng AI của Khoa (lập trình, văn phòng) | 20 phút | ThS. Đặng Quốc Việt |\n| 5 | Thảo luận, bế mạc | 35 phút | Tất cả |\n\n## 4. Kinh phí\n\nDự kiến 28.000.000 đồng từ nguồn kinh phí hoạt động của Khoa (chi tiết theo dự toán kèm theo).\n\n## 5. Tổ chức thực hiện\n\n1. Văn phòng Khoa: chuẩn bị hội trường, tài liệu, tea break; gửi giấy mời trước ngày 10/10/2026.\n2. Bộ môn: đăng ký đại biểu tham dự trước ngày 12/10/2026.\n3. Trợ lý Khoa: tổng hợp kết quả, báo cáo Trưởng khoa sau hội thảo 03 ngày.",
  });

  out["ghi-chu-hop-khoa.txt"] =
    "hop giao ban khoa sang thu 3 (30/9/2026), phong 401 A1, bat dau 8h30 xong 10h.\nco mat: thay An (truong khoa) chu tri, co Mai (pho khoa), thay Hung, co Lan, thay Quan, co Thao (thu ky ghi). vang: thay Nam (di cong tac).\n\n- thay An bao cao: tuyen sinh dot 2 du kien 120 chi tieu, da co 87 ho so. yeu cau bo mon gioi thieu them nganh Khoa hoc du lieu.\n- co Mai: ke hoach hoi thao AI ngay 17/10, can chot khach moi truoc 10/10. giao co Lan lam danh sach moi + giay moi. thay Hung lo phan noi dung chuong trinh.\n- thay Quan de xuat mua them 2 may chu GPU cho phong lab, du tru 450 trieu. thay An: viet de xuat gui phong KHTC truoc 15/10, thay Quan phu trach.\n- co Thao nhac: nop bao cao ca nhan thang 9 truoc 3/10.\n- ket luan: thong nhat tat ca noi dung tren. hop tiep ngay 28/10.\n";

  out["NEUAGENT.md"] =
    "# Quy ước của đơn vị (dữ liệu mẫu — hãy sửa cho đúng đơn vị của bạn)\n\n- Đơn vị: Khoa Công nghệ thông tin, Trường Đại học Mẫu.\n- Trưởng khoa (người ký thông báo/công văn): TS. Nguyễn Văn An. Phó trưởng khoa: TS. Trần Thị Mai.\n- Địa danh trên văn bản: Hà Nội.\n- Số/ký hiệu công văn: Số: …/TB-CNTT (thông báo), …/KH-CNTT (kế hoạch), …/BB-CNTT (biên bản).\n- Văn bản hành chính dùng style formal (Times New Roman 13). Báo cáo nội bộ dùng style modern.\n- Tiền tệ viết “28.000.000 đồng”; ngày tháng dd/mm/yyyy.\n- Mọi văn bản mới lưu thành tệp mới, không ghi đè bản gốc.\n";

  out[".neuagent/commands/giay-moi.md"] =
    "---\ndescription: Tạo giấy mời hàng loạt từ file danh sách khách mời (mỗi người một trang)\n---\nTạo giấy mời hàng loạt từ file danh sách: $ARGUMENTS\nĐọc file danh sách bằng read_document và đọc kế hoạch hội thảo trong thư mục để lấy thời gian, địa điểm, chương trình. Soạn MỘT file Word (style formal) có mỗi khách mời một trang (dùng <<<pagebreak>>> giữa các trang): quốc hiệu, “GIẤY MỜI”, “Kính mời: <chức vụ, họ tên, đơn vị>”, nội dung mời kèm vai trò của khách, thời gian, địa điểm, chữ ký Trưởng khoa theo NEUAGENT.md. Không bịa thông tin ngoài các file. Sau đó đọc lại để kiểm tra số trang đúng số khách và tên viết đúng từng ký tự.\n";

  out["DOC-LAM-QUEN.md"] =
    "# Thư mục mẫu cho tab Work\n\nCác tệp ở đây là **dữ liệu giả lập** để bạn tập làm quen. Hãy thử các yêu cầu trong tài liệu *Kịch bản training*:\n\n- `diem-hoc-phan.xlsx` — bảng điểm 24 sinh viên (chưa tính tổng kết).\n- `du-toan-hoi-thao.xlsx` — dự toán có vài lỗi cố ý (thử “rà soát dự toán”).\n- `danh-sach-moi.xlsx` — danh sách khách mời (thử `/giay-moi danh-sach-moi.xlsx`).\n- `ke-hoach-hoi-thao.docx` — kế hoạch hội thảo (thử `/tomtat`, `/trinhchieu`).\n- `thong-bao-nhap.docx` — thông báo nháp nhiều lỗi (thử `/rasoat`).\n- `ghi-chu-hop-khoa.txt` — ghi chú họp thô (thử soạn biên bản).\n- `NEUAGENT.md` — quy ước của đơn vị mà agent tự đọc.\n";
  return out;
}
