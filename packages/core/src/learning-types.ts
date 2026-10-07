/**
 * Khuôn dữ liệu cho phần HỌC: giáo trình vibe coding, bài tập có chấm tự động, dự án mẫu, và mẫu văn bản cho tab Work.
 * (Nội dung nằm ở curriculum/ và work-templates.ts.)
 */

export type ExerciseLang = "js" | "py" | "html";

/**
 * Bài tập có chấm tự động.
 * - Thư mục của học viên: `bai-tap/<id>/` gồm `DE-BAI.md` (đề), các tệp khởi đầu (`files`) và tệp chấm (`check`).
 * - Metadata ẩn (học viên không thấy trong cây tệp): `.neuagent/exercises/<id>/exercise.json` (tiêu đề, gợi ý, tệp chấm).
 * - Lời giải `solution` KHÔNG được chép vào thư mục học viên (chỉ dùng để kiểm thử bộ bài tập và cho giảng viên).
 */
export interface Exercise {
  /** Định danh ASCII, dạng "js-01-tong-mang", "py-03-dem-tu". Duy nhất. */
  id: string;
  lang: ExerciseLang;
  /** 1 = nhập môn, 2 = cơ bản, 3 = nâng cao. */
  level: 1 | 2 | 3;
  title: string;
  /** Mục tiêu học (1 câu, tiếng Việt). */
  goal: string;
  /** Đề bài (Markdown, tiếng Việt): bối cảnh, yêu cầu, ví dụ vào/ra, ràng buộc, cách chạy/chấm. Ghi vào DE-BAI.md. */
  instructions: string;
  /** Tệp khởi đầu, đường dẫn tương đối trong thư mục bài (vd "main.js", "main.py", "index.html"). Phải GỒM tệp chấm `check`. KHÔNG gồm DE-BAI.md. */
  files: Record<string, string>;
  /** Tên tệp chấm trong `files` ("check.js" hoặc "check.py"). Xem giao thức ở dưới. */
  check: string;
  /** Lời giải mẫu: chỉ các tệp cần thay/ghi đè so với `files` để bài đạt TẤT CẢ bài kiểm tra. */
  solution: Record<string, string>;
  /** Thang gợi ý 3–4 bậc, từ nhẹ đến rõ (bậc cuối vẫn KHÔNG đưa nguyên lời giải). */
  hints: string[];
  /** Khái niệm lập trình được luyện (vd ["vòng lặp", "mảng"]). */
  concepts: string[];
  /** Thời lượng gợi ý (phút). */
  minutes: number;
}

/**
 * GIAO THỨC CHẤM: tệp `check` chạy được bằng `node check.js` (hoặc `python3 check.py`) với thư mục hiện hành là thư mục bài.
 * Mỗi bài kiểm tra in ra MỘT dòng:   `PASS <tên ngắn>`   hoặc   `FAIL <tên ngắn>: <lý do ngắn gọn, tiếng Việt, nêu giá trị nhận được và mong đợi>`.
 * Thoát với mã 1 nếu có FAIL, mã 0 nếu tất cả PASS. Không dùng thư viện ngoài (chỉ thư viện chuẩn). Không đọc mạng. Chạy < 3 giây.
 * Phải chịu được mã học viên sai: bọc try/catch, mã lỗi cú pháp/ném lỗi → in `FAIL <tên>: <thông báo>`; vòng lặp vô hạn do học viên viết thì chấm sẽ bị hết giờ (không cần xử lý).
 * Trong JS dùng CommonJS (`require("./main.js")`), KHÔNG dùng `import`. Chạy trong hộp cát trình duyệt (có require/process.exit nhưng không có fs, child_process, mạng) và trong Node.
 * Trong Python chấm bằng `importlib`/`import main` thông thường; không dùng `input()` trong bài chấm (hãy thiết kế hàm nhận tham số).
 */

export interface LessonStep {
  title: string;
  /** Nội dung bước (Markdown, tiếng Việt, ngắn gọn, dùng ví dụ cụ thể). */
  body: string;
  /** Các câu lệnh/prompt học viên bấm “Thử” để điền vào ô chat (1–3 câu, viết sẵn, cụ thể). */
  try?: string[];
  /** Cách tự kiểm tra kết quả bước này (1–2 câu). */
  check?: string;
}

export interface Lesson {
  /** "bai-01-vibe-coding-la-gi" ... */
  id: string;
  /** Thứ tự 1..N. */
  order: number;
  title: string;
  minutes: number;
  /** 2–4 mục tiêu học (động từ đo được). */
  goals: string[];
  /** Giới thiệu ngắn (Markdown). */
  intro: string;
  steps: LessonStep[];
  /** Điều cần nhớ (3–5 ý). */
  takeaways: string[];
  /** Id bài tập (Exercise.id) liên quan, nếu có. */
  exercises?: string[];
}

/** Dự án mẫu để học viên khởi tạo nhanh (“Dự án mới”). */
export interface ProjectTemplate {
  /** "web-ghi-chu", "py-doan-so"... */
  id: string;
  name: string;
  description: string;
  lang: ExerciseLang | "mixed";
  /** Tệp, đường dẫn tương đối; phải có README.md hướng dẫn chạy; gồm NEUAGENT.md (quy ước cho agent). */
  files: Record<string, string>;
  /** Gợi ý yêu cầu đầu tiên để thử với agent. */
  startPrompts: string[];
}

// ---------------------------------------------------------------- tab Work

export interface TemplateField {
  key: string;
  label: string;
  required: boolean;
  /** Ví dụ giá trị (tiếng Việt). */
  example?: string;
}

/**
 * Mẫu nghiệp vụ văn phòng: trở thành lệnh gạch chéo (/<command>) của tab Work.
 * `prompt` là CHỈ DẪN CHO MÔ HÌNH (viết bằng tiếng Anh, có thể chèn nguyên văn các thuật ngữ/tiêu đề tiếng Việt);
 * nó dùng `$ARGUMENTS` cho phần người dùng gõ sau lệnh. Chỉ dẫn phải: (1) liệt kê thông tin cần có và HỎI người dùng những gì còn thiếu
 * trước khi soạn, (2) quy định chính xác thể thức/cấu trúc, (3) nói rõ công cụ cần dùng (create_docx/create_xlsx/create_pptx…) và tham số,
 * (4) yêu cầu đọc lại để kiểm tra và đánh dấu “[cần bổ sung]” cho mọi thứ không được cung cấp, không bịa số/ký hiệu/căn cứ pháp lý.
 */
export interface WorkTemplate {
  /** ASCII, không dấu, dùng làm tên lệnh: "congvan", "thongbao", "quyetdinh", "bienban", "totrinh", "kehoach", "baocao", "giaymoi"... */
  command: string;
  /** Tên hiển thị tiếng Việt. */
  name: string;
  category: "van-ban-hanh-chinh" | "bang-tinh" | "trinh-chieu" | "thu-tu" | "khac";
  /** Mô tả ngắn (hiển thị trong menu lệnh, ≤ 90 ký tự). */
  description: string;
  fields: TemplateField[];
  prompt: string;
}
