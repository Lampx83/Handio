/**
 * Nhóm công cụ ít dùng. Mỗi lược đồ công cụ tốn ngữ cảnh ở MỌI lần gọi mô hình (cửa sổ chỉ 32k token; 47 công cụ của tab Work
 * từng chiếm ~15k token trước khi người dùng nói gì, khiến agent phải tóm tắt ngữ cảnh liên tục). Công cụ trong nhóm chỉ được đưa
 * vào lời gọi khi người dùng/kết quả công cụ gần đây nhắc tới chủ đề của nhóm, hoặc khi agent tự bật bằng `use_tools`.
 * Đã bật thì giữ nguyên đến hết phiên (danh sách công cụ ổn định, không nhấp nháy).
 */
export interface ToolGroup {
  id: string;
  /** Mô tả một dòng (hiện trong mô tả của `use_tools`). */
  label: string;
  tools: string[];
  /** Khớp trên văn bản đã bỏ dấu, viết thường. */
  match: RegExp;
  /** Chỉ áp dụng cho các tab này. */
  profiles: string[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "pdf",
    label: "PDF: xem thông tin, lấy chữ, tách, gộp, xoay, ghép ảnh thành PDF, tạo PDF",
    tools: ["pdf_info", "pdf_text", "pdf_split", "pdf_merge", "pdf_rotate", "images_to_pdf", "create_pdf"],
    match: /pdf/,
    profiles: ["work", "design"],
  },
  {
    id: "files",
    label: "Quản lý tệp: sao chép, di chuyển/đổi tên, tạo thư mục, nén, giải nén",
    tools: ["copy_file", "move_file", "make_dir", "zip_files", "unzip_file"],
    match: /sao chep|copy|di chuyen|doi ten|rename|\bnen\b|zip|giai nen|tao thu muc|thu muc moi|sap xep (lai )?(tep|file)|gom (tep|file)|don (dep|thu muc)|phan loai (tep|file)/,
    profiles: ["work", "design"],
  },
  {
    id: "utils",
    label: "Tiện ích: ngày/hạn/ngày làm việc, âm lịch, số thành chữ, máy tính, CSV, email .eml, lịch .ics, so sánh văn bản, thống kê, che thông tin cá nhân",
    tools: ["date_calc", "lunar_convert", "vn_text", "vn_number_words", "calc", "csv_convert", "create_ics", "create_eml", "text_diff", "doc_stats", "scan_pii", "redact_pii"],
    match: /am lich|duong lich|lich am|so (thanh|sang) chu|bang chu|doc so|csv|\.ics|lich hen|\.eml|soan (email|mail|thu)|gui (email|mail)|so sanh|khac biet|dem (tu|chu|ky tu)|thong ke (van ban|tai lieu)|an thong tin|che thong tin|thong tin ca nhan|cccd|cmnd|tinh (ngay|tuoi|thoi han|tuan)|cong them|bao nhieu ngay|so ngay|ngay lam viec|may tinh|tinh toan/,
    profiles: ["work", "design"],
  },
  {
    id: "office_plus",
    label: "Văn phòng nâng cao: trộn thư/thay thế hàng loạt trong Word, gộp văn bản, kiểm tra trường trộn, bảng tổng hợp (pivot) Excel",
    tools: ["merge_documents", "merge_check", "docx_replace", "xlsx_pivot"],
    match: /tron (thu|van ban|mail)|mail merge|gop (van ban|tai lieu|word|file word)|hang loat|dong loat|pivot|bang tong hop|tong hop (so lieu|theo)/,
    profiles: ["work", "design"],
  },
  {
    id: "office",
    label: "Word/Excel/PowerPoint: tạo và sửa tệp Office, đọc tài liệu",
    tools: ["create_docx", "docx_edit", "create_xlsx", "xlsx_edit", "create_pptx", "pptx_edit", "read_document", "find_in_documents"],
    match: /\.(docx|xlsx|pptx)|\bword\b|excel|powerpoint|bang tinh|power point/,
    profiles: ["design"],
  },
];

/** Bỏ dấu tiếng Việt, viết thường — để khớp cả khi người dùng gõ không dấu. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
}

/** Các nhóm áp dụng cho một tab. */
export function groupsFor(profile: string): ToolGroup[] {
  return TOOL_GROUPS.filter((g) => g.profiles.includes(profile));
}

/** Nhóm có chủ đề xuất hiện trong các đoạn văn bản (chưa tính nhóm đã bật). */
export function matchGroups(profile: string, texts: string[]): string[] {
  const folded = texts.map(fold);
  return groupsFor(profile)
    .filter((g) => folded.some((t) => g.match.test(t)))
    .map((g) => g.id);
}

/** Tên nhóm chứa một công cụ (nếu có) — dùng khi mô hình gọi thẳng công cụ chưa được bật. */
export function groupOfTool(profile: string, tool: string): string | null {
  return groupsFor(profile).find((g) => g.tools.includes(tool))?.id ?? null;
}
