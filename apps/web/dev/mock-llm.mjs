// Máy chủ LLM giả (giao diện kiểu OpenAI, có streaming + gọi công cụ) để thử NEU Agent không cần key.
// Kịch bản theo nội dung yêu cầu: sửa lỗi (đọc → chạy thử → sửa → chạy lại), /init, kế hoạch, hỏi đáp thường.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (o) => `data: ${JSON.stringify(o)}\n\n`;

const FIX_RUN_JS = `const src = files["src/grades.js"];
const mod = {};
new Function("module", src)(mod);
const got = mod.exports.average([8, 9, 10]);
console.log("average([8, 9, 10]) =", got);
if (Math.abs(got - 9) > 1e-9) throw new Error("Sai: mong đợi 9, nhận " + got);
return "OK";`;


// ---------------------------------------------------------------- kịch bản Work
function parseSheetRows(toolText, sheetName) {
  const start = toolText.indexOf(`## Sheet “${sheetName}”`);
  if (start < 0) return [];
  const rest = toolText.slice(start).split("\n").slice(1);
  const rows = [];
  for (const line of rest) {
    if (line.startsWith("## ")) break;
    const m = /^\s*(\d+) \| (.*)$/.exec(line);
    if (m && +m[1] >= 2) rows.push(m[2].split(" | ").map((c) => c.replace(/ \[=.*\]$/, "")));
  }
  return rows;
}

function planWork(messages, tools) {
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  const user = String(messages[lastUserIdx]?.content ?? "");
  const turn = messages.slice(lastUserIdx + 1);
  const step = turn.filter((m) => m.role === "assistant").length;
  const toolTexts = turn.filter((m) => m.role === "tool").map((m) => String(m.content ?? ""));
  const last = toolTexts.at(-1) ?? "";

  // hỏi người dùng có cấu trúc (ask_user): gõ "hỏi lại" để xem thẻ câu hỏi
  if (/hỏi lại|ask_user/i.test(user)) {
    if (step === 0) return { text: "Tôi cần biết thêm hai điều trước khi soạn.", calls: [{ name: "ask_user", args: { questions: [
      { question: "Văn bản này gửi cho ai?", header: "Đối tượng", options: [{ label: "Lãnh đạo khoa", description: "Ngắn gọn, nêu quyết định và đề xuất" }, { label: "Toàn thể giảng viên", description: "Đầy đủ, có hướng dẫn thực hiện" }, { label: "Sinh viên" }] },
      { question: "Cần những phần nào?", header: "Nội dung", multi_select: true, options: [{ label: "Tóm tắt" }, { label: "Số liệu" }, { label: "Kiến nghị" }] },
    ] } }] };
    return { text: "Đã nhận câu trả lời của bạn:\n\n" + (last || "(không có)") };
  }
  const invite = /giấy mời|giay moi/i.test(user);
  if (!invite && /điểm|tổng kết|xếp loại|diem/i.test(user)) {
    if (step === 0) return { text: "Tôi sẽ đọc file điểm trước để xem cấu trúc.", calls: [{ name: "todo_write", args: { todos: [{ content: "Đọc file điểm và quy chế", status: "in_progress" }, { content: "Tính tổng kết và xếp loại bằng công thức", status: "pending" }, { content: "Thống kê theo xếp loại", status: "pending" }, { content: "Kiểm tra lại kết quả", status: "pending" }] } }, { name: "read_document", args: { path: "diem-hoc-phan.xlsx" } }] };
    if (step === 1) {
      const rows = parseSheetRows(toolTexts.find((t) => t.includes("Sheet “Điểm”")) ?? "", "Điểm");
      const n = rows.length;
      const data = rows.map((r, i) => [r[0], r[1], r[2], Number(r[3]), Number(r[4]), Number(r[5]), `=ROUND(D${i + 2}*0.1+E${i + 2}*0.3+F${i + 2}*0.6,1)`, `=IF(G${i + 2}>=8.5,"Giỏi",IF(G${i + 2}>=7,"Khá",IF(G${i + 2}>=5,"Trung bình","Yếu")))`]);
      const last = n + 1;
      return { text: `Đã đọc ${n} sinh viên. Quy chế: chuyên cần 10%, giữa kỳ 30%, cuối kỳ 60%; Giỏi ≥ 8,5, Khá ≥ 7, Trung bình ≥ 5. Tôi lưu kết quả sang file mới, không sửa file gốc.`, calls: [{ name: "create_xlsx", args: { path: "diem-tong-ket.xlsx", sheets: [
        { name: "Tổng kết", rows: [["MSSV", "Họ tên", "Lớp", "Chuyên cần", "Giữa kỳ", "Cuối kỳ", "Tổng kết", "Xếp loại"], ...data], autofilter: true, number_formats: { G: "0.0" } },
        { name: "Thống kê", rows: [["Chỉ tiêu", "Giá trị"], ["Sĩ số", `=COUNTA('Tổng kết'!A2:A${last})`], ["Điểm trung bình", `=ROUND(AVERAGE('Tổng kết'!G2:G${last}),2)`], ["Cao nhất", `=MAX('Tổng kết'!G2:G${last})`], ["Thấp nhất", `=MIN('Tổng kết'!G2:G${last})`], ["Số SV Giỏi", `=COUNTIF('Tổng kết'!H2:H${last},"Giỏi")`], ["Số SV Khá", `=COUNTIF('Tổng kết'!H2:H${last},"Khá")`], ["Số SV Trung bình", `=COUNTIF('Tổng kết'!H2:H${last},"Trung bình")`], ["Số SV Yếu", `=COUNTIF('Tổng kết'!H2:H${last},"Yếu")`]], widths: [22, 14] },
      ] } }] };
    }
    if (step === 2) return { text: "Tôi đọc lại file vừa tạo để kiểm tra số liệu.", calls: [{ name: "read_document", args: { path: "diem-tong-ket.xlsx", sheet: "Thống kê" } }] };
    const stats = Object.fromEntries(parseSheetRows(last, "Thống kê").map((r) => [r[0], r[1]]));
    return { text: `## Đã tính xong điểm tổng kết\n\nTệp mới: **diem-tong-ket.xlsx** (file gốc \`diem-hoc-phan.xlsx\` giữ nguyên).\n\n| Chỉ tiêu | Kết quả |\n|---|---:|\n| Sĩ số | ${stats["Sĩ số"]} |\n| Điểm trung bình | ${stats["Điểm trung bình"]} |\n| Cao nhất / Thấp nhất | ${stats["Cao nhất"]} / ${stats["Thấp nhất"]} |\n| Giỏi | ${stats["Số SV Giỏi"]} |\n| Khá | ${stats["Số SV Khá"]} |\n| Trung bình | ${stats["Số SV Trung bình"]} |\n| Yếu | ${stats["Số SV Yếu"]} |\n\n**Đã kiểm tra:** đọc lại file, tổng 4 nhóm xếp loại bằng sĩ số; công thức dùng trọng số 10/30/60 theo sheet “Quy chế”. Thầy/cô nên rà thêm các trường hợp điểm ranh giới 5,0 / 7,0 / 8,5.` };
  }
  if (!invite && /biên bản|bien ban|ghi chú|soạn.*thông báo|soạn/i.test(user)) {
    if (step === 0) return { text: "Tôi đọc ghi chú họp và quy ước của đơn vị.", calls: [{ name: "read_document", args: { path: "ghi-chu-hop-khoa.txt" } }, { name: "read_document", args: { path: "NEUAGENT.md" } }] };
    if (step === 1) return { text: "Tôi soạn biên bản theo thể thức văn bản hành chính, lưu thành tệp mới.", calls: [{ name: "create_docx", args: { path: "bien-ban-hop-giao-ban-30-9-2026.docx", style: "formal",
      letterhead: { agency_parent: "Trường Đại học Mẫu", agency: "Khoa Công nghệ thông tin", doc_number: "Số: …/BB-CNTT", place_date: "Hà Nội, ngày 30 tháng 9 năm 2026" },
      title: "BIÊN BẢN", subtitle: "Họp giao ban Khoa sáng thứ Ba ngày 30/9/2026",
      content: "**1. Thời gian, địa điểm:** 08h30 đến 10h00, ngày 30/9/2026, Phòng 401, Nhà A1.\n\n**2. Thành phần:** TS. Nguyễn Văn An (Trưởng khoa, chủ trì); TS. Trần Thị Mai (Phó trưởng khoa); các thầy cô Hùng, Quân, Lan; thư ký: cô Thảo. Vắng: thầy Nam (đi công tác).\n\n**3. Nội dung:**\n\n1. Thầy An báo cáo tuyển sinh đợt 2: dự kiến 120 chỉ tiêu, đã nhận 87 hồ sơ. Yêu cầu các bộ môn giới thiệu thêm ngành Khoa học dữ liệu.\n2. Cô Mai thông báo kế hoạch Hội thảo AI ngày 17/10/2026; cần chốt khách mời trước 10/10/2026. Cô Lan lập danh sách mời và giấy mời; thầy Hùng phụ trách nội dung chương trình.\n3. Thầy Quân đề xuất mua thêm 02 máy chủ GPU cho phòng lab, dự trù 450 triệu đồng. Thầy An giao thầy Quân viết đề xuất gửi Phòng Kế hoạch – Tài chính trước 15/10/2026.\n4. Cô Thảo nhắc nộp báo cáo cá nhân tháng 9 trước 03/10/2026.\n\n**4. Kết luận:** Thống nhất toàn bộ nội dung trên. Cuộc họp tiếp theo: 28/10/2026.\n\n| TT | Công việc | Phụ trách | Hạn |\n|:--:|---|---|---|\n| 1 | Chốt khách mời, lập danh sách và giấy mời Hội thảo AI | Cô Lan | 10/10/2026 |\n| 2 | Hoàn thiện nội dung chương trình Hội thảo | Thầy Hùng | Trước 17/10/2026 |\n| 3 | Đề xuất mua 02 máy chủ GPU (450 triệu đồng) | Thầy Quân | 15/10/2026 |\n| 4 | Nộp báo cáo cá nhân tháng 9 | Toàn thể | 03/10/2026 |",
      signature: { role: "Thư ký", name: "Thảo" }, recipients: ["- Các thành viên dự họp;", "- Lưu: VT."] } }] };
    if (step === 2) return { text: "Tôi đọc lại biên bản để kiểm tra.", calls: [{ name: "read_document", args: { path: "bien-ban-hop-giao-ban-30-9-2026.docx", max_chars: 3000 } }] };
    return { text: "Đã soạn xong **bien-ban-hop-giao-ban-30-9-2026.docx** từ ghi chú họp.\n\n**Đã kiểm tra:** ngày giờ, địa điểm, 4 nội dung, 4 đầu việc kèm người phụ trách và hạn; tên người viết đúng như ghi chú.\n\n**Thầy/cô cần bổ sung:** số văn bản (đang để “…/BB-CNTT”), họ tên đầy đủ của thư ký (ghi chú chỉ có “cô Thảo”), và người ký (hiện để Thư ký — đổi nếu Trưởng khoa ký)." };
  }
  if (!invite && /tóm tắt|tom tat|tomtat/i.test(user)) {
    if (step === 0) return { text: "Tôi đọc tài liệu rồi tóm tắt.", calls: [{ name: "read_document", args: { path: "ke-hoach-hoi-thao.docx" } }] };
    return { text: "## Tóm tắt kế hoạch hội thảo\n\nKhoa tổ chức hội thảo “Ứng dụng AI trong giảng dạy và nghiên cứu” lúc **14h00 thứ Sáu 17/10/2026** tại Phòng 401, Nhà A1 [[ke-hoach-hoi-thao.docx|đoạn 6]] [[ke-hoach-hoi-thao.docx|đoạn 7]], quy mô khoảng 100 đại biểu, kinh phí dự kiến **28.000.000 đồng** [[ke-hoach-hoi-thao.docx|đoạn 12]].\n\n**Ý chính**\n\n- Mục đích: trao đổi kinh nghiệm dùng AI, giới thiệu nền tảng AI của Khoa, hình thành nhóm nòng cốt.\n- Chương trình 5 phần (khai mạc 15′, báo cáo chính 40′, chia sẻ 30′, giới thiệu nền tảng 20′, thảo luận 35′). [[ke-hoach-hoi-thao.docx|đoạn 10]]\n- Báo cáo chính: PGS.TS. Lê Minh Hoàng.\n\n**Mốc thời gian:** gửi giấy mời trước 10/10 [[ke-hoach-hoi-thao.docx|đoạn 14]]; bộ môn đăng ký đại biểu trước 12/10; báo cáo sau hội thảo 3 ngày.\n\n**Câu hỏi còn mở:** chưa nêu cụ thể nguồn chi và danh sách đại biểu chính thức." };
  }
  if (!invite && /slide|trình chiếu|trinh chieu|powerpoint/i.test(user)) {
    if (step === 0) return { text: "Tôi đọc kế hoạch để dựng slide.", calls: [{ name: "read_document", args: { path: "ke-hoach-hoi-thao.docx" } }] };
    if (step === 1) return { text: "Tôi dựng bài trình chiếu 6 slide.", calls: [{ name: "create_pptx", args: { path: "bao-cao-hoi-thao.pptx", footer: "Khoa CNTT – ĐH Mẫu", content: "# Hội thảo “Ứng dụng AI trong giảng dạy và nghiên cứu”\nKhoa Công nghệ thông tin — 17/10/2026\n\nGhi chú: Chào mừng đại biểu, giới thiệu ban tổ chức.\n\n---\n\n## Mục đích\n\n- Trao đổi kinh nghiệm ứng dụng AI trong dạy, học, nghiên cứu\n- Giới thiệu các công cụ AI do Khoa vận hành\n- Hình thành nhóm nòng cốt cho năm học 2026–2027\n\n---\n\n## Thời gian & địa điểm\n\n- 14h00, thứ Sáu 17/10/2026\n- Phòng họp 401, Nhà A1\n- Khoảng 100 đại biểu: giảng viên, nghiên cứu viên, sinh viên tài năng\n\n---\n\n## Chương trình\n\n| TT | Nội dung | Thời lượng |\n|:--:|---|---:|\n| 1 | Đón tiếp, khai mạc | 15 phút |\n| 2 | Báo cáo chính: Xu hướng AI trong giáo dục đại học | 40 phút |\n| 3 | Chia sẻ: AI hỗ trợ soạn giảng và chấm bài | 30 phút |\n| 4 | Giới thiệu nền tảng AI của Khoa | 20 phút |\n| 5 | Thảo luận, bế mạc | 35 phút |\n\n---\n\n## Kinh phí & tổ chức\n\n- Dự kiến 28.000.000 đồng từ kinh phí hoạt động của Khoa\n- Văn phòng Khoa: hội trường, tài liệu, giấy mời (trước 10/10)\n- Bộ môn: đăng ký đại biểu (trước 12/10)\n\n---\n\n## Bước tiếp theo\n\n- Chốt khách mời trước 10/10/2026\n- Hoàn thiện nội dung chương trình\n- Báo cáo kết quả sau hội thảo 3 ngày\n\nGhi chú: Kêu gọi các bộ môn đăng ký sớm." } }] };
    if (step === 2) return { text: "Tôi kiểm tra lại các slide.", calls: [{ name: "read_document", args: { path: "bao-cao-hoi-thao.pptx" } }] };
    return { text: "Đã tạo **bao-cao-hoi-thao.pptx** gồm 6 slide (bìa, mục đích, thời gian–địa điểm, chương trình dạng bảng, kinh phí–tổ chức, bước tiếp theo), có ghi chú cho người trình bày ở slide bìa và slide cuối.\n\n**Đã kiểm tra:** thời gian, địa điểm, 5 mục chương trình và số tiền khớp với kế hoạch gốc. Thầy/cô nên xem lại bố cục trong PowerPoint và thêm logo của Khoa." };
  }
  if (!invite && /dự toán|du toan|rà soát|ra soat|kiểm tra/i.test(user)) {
    if (step === 0) return { text: "Tôi đọc bảng dự toán để rà soát.", calls: [{ name: "read_document", args: { path: "du-toan-hoi-thao.xlsx" } }] };
    return { text: "## Kết quả rà soát dự toán\n\nTôi phát hiện **4 vấn đề** trong `du-toan-hoi-thao.xlsx`:\n\n| # | Vị trí | Vấn đề | Gợi ý |\n|:-:|---|---|---|\n| 1 | Ô E6 | Đơn giá “3.000.000” đang là **chữ**, không phải số nên Thành tiền F6 tính sai/bằng 0 | Nhập lại thành số 3000000 |\n| 2 | Hàng 3 và hàng 7 | “Tea break” 120 người × 35.000 bị **nhập hai lần** | Giữ một dòng, xoá dòng 7 |\n| 3 | Ô D8 | Số lượng quà lưu niệm **âm (−10)** | Sửa thành số dương, ví dụ 10 |\n| 4 | Ô F9 | Tổng cộng chỉ cộng F2:F7, **thiếu dòng 8** | Sửa thành =SUM(F2:F8) sau khi bỏ dòng trùng |\n\nTôi **chưa sửa file gốc**. Thầy/cô muốn tôi lưu một bản đã sửa (ví dụ `du-toan-hoi-thao-v2.xlsx`) không?" };
  }
  if (invite) {
    if (step === 0) return { text: "Tôi đọc danh sách khách mời và kế hoạch hội thảo.", calls: [{ name: "read_document", args: { path: "danh-sach-moi.xlsx" } }, { name: "read_document", args: { path: "ke-hoach-hoi-thao.docx", max_chars: 4000 } }] };
    if (step === 1) {
      const rows = parseSheetRows(toolTexts.find((t) => t.includes("Sheet “Khách mời”")) ?? "", "Khách mời");
      const pages = rows.map((r) => `<center>**GIẤY MỜI**</center>\n\n**Kính mời:** ${r[1]} ${r[0]}\n\n**Đơn vị:** ${r[2]}\n\nKhoa Công nghệ thông tin trân trọng kính mời ${r[0]} tham dự Hội thảo “Ứng dụng AI trong giảng dạy và nghiên cứu” với vai trò **${r[4]}**.\n\n- Thời gian: 14h00, thứ Sáu, ngày 17/10/2026\n- Địa điểm: Phòng họp 401, Nhà A1\n\nSự hiện diện của quý vị là vinh dự cho Ban tổ chức.`);
      return { text: `Tôi tạo một file Word gồm ${rows.length} giấy mời, mỗi người một trang.`, calls: [{ name: "create_docx", args: { path: "giay-moi-hoi-thao.docx", style: "formal", letterhead: { agency_parent: "Trường Đại học Mẫu", agency: "Khoa Công nghệ thông tin", place_date: "Hà Nội, ngày 07 tháng 10 năm 2026" }, content: pages.join("\n\n<<<pagebreak>>>\n\n"), signature: { role: "Trưởng khoa", name: "Nguyễn Văn An" } } }] };
    }
    if (step === 2) return { calls: [{ name: "read_document", args: { path: "giay-moi-hoi-thao.docx", max_chars: 1500 } }] };
    return { text: "Đã tạo **giay-moi-hoi-thao.docx**: mỗi khách mời một trang, tên và chức vụ lấy đúng từ danh sách.\n\n**Đã kiểm tra:** đủ 6 giấy mời, vai trò từng người khớp cột “Vai trò”.\n**Cần bổ sung:** số giấy mời và xác nhận người ký (hiện để TS. Nguyễn Văn An theo NEUAGENT.md)." };
  }
  return { text: "Xin chào! Tôi là **NEU Agent** (đang chạy bằng máy chủ giả lập để demo).\n\nTôi có thể giúp thầy/cô:\n\n- tóm tắt và tìm thông tin trong Word, Excel, PowerPoint, PDF;\n- soạn thông báo, công văn, biên bản theo thể thức hành chính;\n- tính toán, thống kê, rà soát bảng Excel;\n- làm slide từ tài liệu.\n\nThử gõ: `Tính điểm tổng kết từ file điểm và xếp loại`, `Soạn biên bản từ ghi chú họp`, hoặc `/tomtat ke-hoach-hoi-thao.docx`." };
}

function plan(messages, tools) {
  if (String(messages[0]?.content ?? "").includes("(Work mode)")) return planWork(messages, tools);
  const names = new Set(tools.map((t) => t.function.name));
  const sys = String(messages[0]?.content ?? "");
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  const user = String(messages[lastUserIdx]?.content ?? "");
  const step = messages.slice(lastUserIdx + 1).filter((m) => m.role === "assistant").length;
  const lastTool = messages.slice(lastUserIdx + 1).filter((m) => m.role === "tool").at(-1);
  const toolText = String(lastTool?.content ?? "");
  const runner = names.has("bash") ? { name: "bash", args: { command: "node src/grades.test.js" } } : { name: "run_javascript", args: { code: FIX_RUN_JS } };

  if (sys.startsWith("You compress")) return { text: "- Mục tiêu: sửa lỗi hàm average.\n- Đã đọc src/grades.js." };
  if (/PLAN MODE/.test(sys)) {
    if (step === 0) return { text: "Để tôi xem mã trước.", calls: [{ name: "read_file", args: { path: "src/grades.js" } }] };
    if (step === 1) return { calls: [{ name: "exit_plan_mode", args: { plan: "## Kế hoạch sửa lỗi\n\n1. Sửa mẫu số trong `average` ở `src/grades.js` (đang là `scores.length + 1`).\n2. Chạy lại bài kiểm tra để xác nhận kết quả **9**.\n3. Báo cáo thay đổi." } }] };
    return { text: toolText.includes("được duyệt") ? "Kế hoạch đã được duyệt — chuyển sang thực hiện." : "Tôi sẽ chỉnh lại kế hoạch theo góp ý của bạn." };
  }
  if (/NEUAGENT\.md at the project root/.test(user)) {
    if (step === 0) return { text: "Tôi xem cấu trúc dự án.", calls: [{ name: "list_dir", args: {} }] };
    if (step === 1) return { calls: [{ name: "read_file", args: { path: "README.md" } }] };
    if (step === 2) return { calls: [{ name: "write_file", args: { path: "NEUAGENT.md", content: "# Dự án: Máy tính điểm\n\n## Chạy & kiểm tra\n- `node src/grades.test.js`\n\n## Quy ước\n- JavaScript thuần (CommonJS), bình luận tiếng Việt.\n\n## Thư mục\n- `src/`: mã nguồn và test.\n" } }] };
    return { text: "Đã tạo `NEUAGENT.md` mô tả dự án, cách chạy test và quy ước." };
  }
  if (/lỗi|sửa|bug|fix|sai/i.test(user) && !/^\/(help|mode)/.test(user)) {
    if (step === 0) return { text: "Tôi sẽ lập danh sách việc rồi xem mã.", calls: [{ name: "todo_write", args: { todos: [{ content: "Đọc mã nguồn", status: "in_progress" }, { content: "Chạy thử để tái hiện lỗi", status: "pending" }, { content: "Sửa lỗi", status: "pending" }, { content: "Chạy lại để kiểm chứng", status: "pending" }] } }] };
    if (step === 1) return { calls: [{ name: "read_file", args: { path: "src/grades.js" } }] };
    if (step === 2) return { text: "Mã chia cho `scores.length + 1`. Tôi chạy thử để xác nhận.", calls: [{ name: "todo_write", args: { todos: [{ content: "Đọc mã nguồn", status: "completed" }, { content: "Chạy thử để tái hiện lỗi", status: "in_progress" }, { content: "Sửa lỗi", status: "pending" }, { content: "Chạy lại để kiểm chứng", status: "pending" }] } }, runner] };
    if (step === 3) return { text: "Đúng là sai (kết quả không phải 9). Sửa mẫu số.", calls: [{ name: "edit_file", args: { path: "src/grades.js", old_string: "scores.length + 1", new_string: "scores.length" } }] };
    if (step === 4) return { calls: [{ name: "todo_write", args: { todos: [{ content: "Đọc mã nguồn", status: "completed" }, { content: "Chạy thử để tái hiện lỗi", status: "completed" }, { content: "Sửa lỗi", status: "completed" }, { content: "Chạy lại để kiểm chứng", status: "in_progress" }] } }, runner] };
    if (step === 5) return { calls: [{ name: "todo_write", args: { todos: [{ content: "Đọc mã nguồn", status: "completed" }, { content: "Chạy thử để tái hiện lỗi", status: "completed" }, { content: "Sửa lỗi", status: "completed" }, { content: "Chạy lại để kiểm chứng", status: "completed" }] } }] };
    return { text: "## Đã sửa xong\n\n**Nguyên nhân:** `average` chia tổng cho `scores.length + 1` nên luôn nhỏ hơn giá trị đúng.\n\n**Cách sửa:** đổi mẫu số thành `scores.length` trong `src/grades.js`.\n\n**Kiểm chứng:** chạy lại bài kiểm tra, `average([8, 9, 10])` cho kết quả `9`." };
  }
  return { text: "Xin chào! Tôi là **NEU Agent** (đang chạy bằng máy chủ giả lập để demo).\n\nTôi có thể:\n\n- đọc và giải thích mã trong thư mục dự án,\n- sửa file (luôn hỏi bạn trước, bạn thấy rõ phần thay đổi),\n- chạy kiểm thử rồi sửa đến khi qua.\n\nThử gõ: `Sửa lỗi trong hàm tính điểm trung bình` hoặc `/init`." };
}

async function stream(res, p, promptTokens) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const words = (p.text ?? "").split(/(\s+)/);
  for (let i = 0; i < words.length; i += 2) {
    res.write(J({ choices: [{ delta: { content: words.slice(i, i + 2).join("") } }] }));
    await sleep(18);
  }
  (p.calls ?? []).forEach((c, index) => res.write(J({ choices: [{ delta: { tool_calls: [{ index, id: "call_" + Math.random().toString(16).slice(2, 10), type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] })));
  res.write(J({ choices: [{ delta: {}, finish_reason: p.calls?.length ? "tool_calls" : "stop" }] }));
  res.write(J({ choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: 40 } }));
  res.write("data: [DONE]\n\n");
  res.end();
}

export async function mockHandler(req, res, pathname) {
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (pathname.endsWith("/models")) return send(200, { data: [{ id: "mock-agent" }] });
  if (pathname.endsWith("/chat/completions") && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    const tokens = Math.round(JSON.stringify(body.messages ?? []).length / 3);
    await sleep(250);
    return stream(res, plan(body.messages ?? [], body.tools ?? []), tokens);
  }
  return send(404, { error: "not found" });
}
