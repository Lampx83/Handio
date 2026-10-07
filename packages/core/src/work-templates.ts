import type { TemplateField, WorkTemplate } from "./learning-types";

/**
 * Bộ mẫu nghiệp vụ văn phòng cho tab Work. Mỗi mẫu là một lệnh gạch chéo (/<command>); `prompt` là chỉ dẫn cho mô hình (tiếng Anh,
 * chèn nguyên văn các tiêu đề/thuật ngữ tiếng Việt). Tên công cụ và tham số bám sát packages/core/src/office/tools.ts
 * (test work-templates.test.ts kiểm tra lại với schema thật). Thể thức văn bản hành chính theo Nghị định 30/2020/NĐ-CP.
 */

const f = (key: string, label: string, required: boolean, example: string): TemplateField => ({ key, label, required, example });

// ---------------------------------------------------------------- các đoạn chỉ dẫn dùng chung

const ASK = `STEP 1 - Check the information. Look at what the user already gave (in the request above, earlier in the conversation, and in files of the working folder: use find_in_documents / read_document when they mention a source file). If any REQUIRED item is missing, reply FIRST with a short numbered list of questions (at most 6, one line each, with an example answer) and WAIT for the answers; do not draft yet. If everything required is present, go straight to the next step; minor missing details are marked "[cần bổ sung]" instead of asked.`;

const NO_INVENT = `Never invent document numbers, dates, amounts, names, titles, legal bases ("căn cứ") or facts. Use only what the user gave or what you read in their files. Write "[cần bổ sung]" for anything missing (for example "Số: [cần bổ sung]/TB-[cần bổ sung]"). If you are not sure about a rule of form or law, say so in the final report instead of asserting it.`;

const HEADER = `National header: create_docx draws it for you when you pass letterhead. It prints "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM" and "Độc lập - Tự do - Hạnh phúc" on the right, and on the left the parent agency (letterhead.agency_parent), the issuing agency (letterhead.agency, in capitals) and the number line (letterhead.doc_number). letterhead.place_date goes under the motto in italics. Do NOT type the national header again inside content.`;

const DATE_FORM = `Date line (place_date): "<Địa danh>, ngày dd tháng mm năm yyyy", for example "Hà Nội, ngày 07 tháng 10 năm 2026" (days below 10 and months 1 and 2 get a leading zero). If place or date is unknown write "[cần bổ sung], ngày [cần bổ sung]".`;

const SIGN = `Signature block: pass signature with role = the signer's position in capitals (for example "HIỆU TRƯỞNG", "TRƯỞNG KHOA") and name = the signer's full name, or "[cần bổ sung]" if unknown. Add signature.on_behalf ONLY when the user says the signer signs on behalf: "KT." (ký thay: a deputy signs for the head), "TM." (thay mặt: signing for a collective body such as a council or committee), "TL." (thừa lệnh: the head of a support unit signs by order), "TUQ." (thừa ủy quyền). The tool leaves blank space for the signature and stamp.`;

const RECIP = `Recipients: pass recipients as a list of lines such as ["- Như trên;", "- Các đơn vị có liên quan;", "- Lưu: VT, [cần bổ sung]."]. The tool prints the heading "Nơi nhận:" itself, so do not add it. Each line starts with "- " and ends with ";" except the last, which ends with ".".`;

const FILE = (ext: string, example: string) =>
  `Save the result as a NEW ${ext} file with a clear name (for example ${example}); never overwrite an existing file. Then call read_document on the saved file and check: every required part is present in the right order, names, dates, numbers and amounts match what the user gave, and no placeholder remains except "[cần bổ sung]".`;

const REPORT = `Finish with a short report in Vietnamese: the file name, what it contains, what you verified, and the list of "[cần bổ sung]" items and anything else the user must check or fill in (for example document number issued by the clerical office, signature, stamp, legal bases).`;

const LEGAL = `Legal note: this is a REFERENCE TEMPLATE. Tell the user in the final report that the agency (or its legal department) must review it against the regulations currently in force before it is issued or signed. Do not cite any law, decree or article unless the user supplied it. Add one last italic line to the document: "*Ghi chú soạn thảo: bản thảo tham khảo, cần rà soát pháp lý trước khi ban hành/ký - xóa dòng này khi hoàn thiện.*"`;

const STYLE_BODY = `Write in formal, plain Vietnamese administrative style: short sentences, no flowery language. Use Markdown only for what the document needs (numbered lists with "1." and nested items by 2 spaces, bold with **text**, tables, <center>text</center>). Do not start content with a "#" heading that repeats the title.`;

interface AdminSpec {
  type: string;
  need: string;
  structure: string;
  call: string;
  filename: string;
  legal?: boolean;
  extra?: string;
}

/** Ghép chỉ dẫn cho một văn bản hành chính tạo bằng create_docx. */
function adminPrompt(s: AdminSpec): string {
  return [
    `The user wants to draft a Vietnamese official document: ${s.type}. Request: $ARGUMENTS`,
    ASK + `\nInformation needed (REQUIRED first, then RECOMMENDED): ${s.need}`,
    `STEP 2 - Structure (Nghị định 30/2020/NĐ-CP style). Follow this order exactly:\n${s.structure}`,
    `STEP 3 - Create the file with create_docx.\n${s.call}\n${HEADER}\n${DATE_FORM}\n${STYLE_BODY}${s.extra ? "\n" + s.extra : ""}`,
    FILE(".docx", s.filename),
    `Rules: ${NO_INVENT}${s.legal ? "\n" + LEGAL : ""}`,
    REPORT,
  ].join("\n\n");
}

// ---------------------------------------------------------------- văn bản hành chính

const ADMIN: WorkTemplate[] = [
  {
    command: "congvan",
    name: "Công văn",
    category: "van-ban-hanh-chinh",
    description: "Soạn công văn gửi cơ quan/đơn vị theo thể thức hành chính, xuất ra Word",
    fields: [
      f("agency", "Cơ quan ban hành (và cơ quan chủ quản)", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("recipient", "Kính gửi", true, "Phòng Đào tạo, Trường Đại học Mẫu"),
      f("subject", "Trích yếu (V/v)", true, "đề nghị bố trí phòng học cho lớp bồi dưỡng"),
      f("content", "Nội dung chính, lý do, đề nghị", true, "Lớp bồi dưỡng 30 học viên, 3 buổi chiều từ 14/10 đến 16/10/2026, cần phòng máy 40 chỗ"),
      f("signer", "Người ký, chức vụ (có ký thay không)", true, "Nguyễn Văn A, Trưởng khoa"),
    ],
    prompt: adminPrompt({
      type: "công văn (letter between agencies)",
      need: `(1) issuing agency and its parent agency; (2) recipient(s) after "Kính gửi"; (3) subject (trích yếu); (4) main content: reason, facts, what is requested, deadline; (5) signer's name and position, and whether he or she signs on behalf (KT./TL./TM.); (6) place and date, and recommended: number and symbol, any attachments, contact person and phone, other recipients for "Nơi nhận".`,
      structure: `1. National header and issuing agency block (via letterhead). The number line has the form "Số: <number>/<abbreviation of agency>-<abbreviation of drafting unit>" - a công văn has no document-type abbreviation.
2. Place and date line.
3. The subject line: a công văn has NO title; its trích yếu is written "V/v <subject, lower case after V/v>". create_docx cannot place it on the left under the number, so make it the FIRST line of content in the form "**V/v** <subject>", left-aligned.
4. "Kính gửi:" followed by the recipient(s). If there are several recipients, one per line starting with "- ".
5. Body: an opening paragraph (reason, basis, or reference to a previous document - only if the user gave one); the main content, split into numbered paragraphs when there are several points; the request or proposal with a clear deadline.
6. Closing sentence, for example "Rất mong nhận được sự quan tâm, phối hợp của Quý cơ quan." and then "Trân trọng./." as a separate line.
7. Signer block and "Nơi nhận" (the last recipient line is "- Lưu: VT, <drafting unit>.").`,
      call: `Parameters: path (for example "cong-van-<topic>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, content (items 3 to 6 above, in Markdown), signature and recipients. Do not pass title for a công văn.\n${SIGN}\n${RECIP}`,
      filename: "cong-van-bo-tri-phong-hoc-2026-10-07.docx",
    }),
  },
  {
    command: "thongbao",
    name: "Thông báo",
    category: "van-ban-hanh-chinh",
    description: "Soạn thông báo (họp, lịch, kết luận…) theo thể thức hành chính, xuất ra Word",
    fields: [
      f("agency", "Cơ quan ban hành", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("subject", "Về việc", true, "lịch thi kết thúc học phần học kỳ 1 năm học 2026-2027"),
      f("content", "Nội dung cần thông báo (thời gian, địa điểm, đối tượng, yêu cầu)", true, "Thi từ 05/01 đến 16/01/2027 tại giảng đường B, sinh viên mang thẻ"),
      f("audience", "Đối tượng nhận", false, "Toàn thể sinh viên khoá 66"),
      f("signer", "Người ký", true, "Nguyễn Văn A, Trưởng khoa"),
    ],
    prompt: adminPrompt({
      type: "thông báo (announcement)",
      need: `(1) issuing agency and parent agency; (2) subject ("Về việc ..."); (3) the content to announce: what, when, where, who must do what, requirements, deadlines, contact; (4) who receives it; (5) signer's name and position (and KT./TL./TM. if on behalf); (6) place, date, number and symbol if already issued.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/TB-<abbreviation of agency or unit>".
2. Place and date line.
3. Title "THÔNG BÁO" with the subject line under it written "Về việc <subject>" (use the title and subtitle parameters).
4. Opening sentence stating the basis or reason (only what the user gave), ending with "thông báo như sau:" (or "thông báo đến ... như sau:").
5. Body as numbered items: 1. Thời gian; 2. Địa điểm; 3. Thành phần/đối tượng; 4. Nội dung/yêu cầu - use only items that apply, in this logical order.
6. Closing: a request such as "Đề nghị các đơn vị, cá nhân có liên quan nghiêm túc thực hiện." (or "Trân trọng thông báo./.").
7. Signer block and "Nơi nhận".`,
      call: `Parameters: path (for example "thong-bao-<topic>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "THÔNG BÁO", subtitle "Về việc <subject>", content (items 4 to 6), signature, recipients.\n${SIGN}\n${RECIP}`,
      filename: "thong-bao-lich-thi-2026-10-07.docx",
    }),
  },
  {
    command: "quyetdinh",
    name: "Quyết định",
    category: "van-ban-hanh-chinh",
    description: "Soạn quyết định cá biệt (thành lập, phân công, phê duyệt…) với căn cứ và các Điều",
    fields: [
      f("agency", "Cơ quan ban hành", true, "Trường Đại học Mẫu"),
      f("authority", "Chức danh người ra quyết định", true, "HIỆU TRƯỞNG TRƯỜNG ĐẠI HỌC MẪU"),
      f("subject", "Về việc", true, "thành lập Ban tổ chức Hội thảo khoa học năm 2026"),
      f("bases", "Căn cứ (chỉ ghi những căn cứ có thật do bạn cung cấp)", true, "Căn cứ Quy chế tổ chức và hoạt động của Trường Đại học Mẫu; Xét đề nghị của Trưởng phòng Tổ chức"),
      f("decision", "Nội dung quyết định (các Điều chính)", true, "Thành lập Ban tổ chức gồm 5 thành viên; Ban có nhiệm vụ lập kế hoạch và tổ chức hội thảo"),
      f("effect", "Hiệu lực và nơi chịu trách nhiệm thi hành", false, "Có hiệu lực từ ngày ký; các đơn vị liên quan thi hành"),
    ],
    prompt: adminPrompt({
      type: "quyết định (individual decision, e.g. establishing a committee, assigning staff, approving a plan)",
      need: `(1) issuing agency and parent agency; (2) the position of the person issuing the decision; (3) subject ("Về việc ..."); (4) the legal bases and proposals ("Căn cứ ...", "Xét đề nghị của ...") - ONLY those the user supplies or that are in the files they point to; (5) what is decided (people, roles, amounts, time, tasks) and the effective date; (6) who is responsible for implementation and the other recipients; (7) place, date, number and symbol.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/QĐ-<abbreviation>".
2. Place and date line.
3. Title "QUYẾT ĐỊNH" with the subject under it written "Về việc <subject>".
4. First line of content: the position of the issuing authority in capitals, centered and bold: <center>**HIỆU TRƯỞNG TRƯỜNG ĐẠI HỌC MẪU**</center> (use what the user gave).
5. The bases, one per line, each beginning "Căn cứ ..." and ending with ";" (the last base or the proposal "Xét đề nghị của ..." ends with ","). Write only bases the user supplied; if none were given write one line "Căn cứ [cần bổ sung];" and ask for them in the report.
6. A centered bold line: <center>**QUYẾT ĐỊNH:**</center>
7. The articles, each as a paragraph that starts with bold text: "**Điều 1.** ...", "**Điều 2.** ...". Typical order: Điều 1 the decision itself; following articles for tasks, rights or regime; the effective date ("Quyết định này có hiệu lực kể từ ngày ... "), and the last article names who must implement it ("... chịu trách nhiệm thi hành Quyết định này."). Do not invent amounts, names or dates.
8. Signer block (the person with authority; use KT./TM./TL. only if the user says so) and "Nơi nhận" (usually "- Như Điều <last>;" and "- Lưu: VT, <unit>.").`,
      call: `Parameters: path (for example "quyet-dinh-<topic>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "QUYẾT ĐỊNH", subtitle "Về việc <subject>", content (items 4 to 7), signature, recipients.\n${SIGN}\n${RECIP}`,
      filename: "quyet-dinh-thanh-lap-ban-to-chuc-2026-10-07.docx",
      legal: true,
    }),
  },
  {
    command: "totrinh",
    name: "Tờ trình",
    category: "van-ban-hanh-chinh",
    description: "Soạn tờ trình xin phê duyệt/chủ trương gửi cấp trên, xuất ra Word",
    fields: [
      f("agency", "Cơ quan/đơn vị trình", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("recipient", "Kính gửi (cấp phê duyệt)", true, "Hiệu trưởng Trường Đại học Mẫu"),
      f("subject", "Về việc", true, "xin phê duyệt kế hoạch tổ chức Hội thảo khoa học năm 2026"),
      f("reason", "Sự cần thiết, căn cứ", true, "Thực hiện kế hoạch năm học; nhu cầu trao đổi chuyên môn của giảng viên"),
      f("proposal", "Nội dung đề xuất (thời gian, quy mô, kinh phí, thành phần)", true, "Tổ chức 01 ngày, 100 đại biểu, kinh phí dự kiến 45.000.000 đồng"),
      f("signer", "Người ký", true, "Nguyễn Văn A, Trưởng khoa"),
    ],
    prompt: adminPrompt({
      type: "tờ trình (proposal submitted to a higher authority for approval or a decision)",
      need: `(1) submitting agency/unit and parent agency; (2) the authority it is addressed to ("Kính gửi"); (3) subject ("Về việc ..."); (4) why it is needed and the basis (only what the user gave); (5) the concrete proposal: content, time, scale, budget, participants, responsible units; (6) attachments ("Hồ sơ kèm theo"); (7) signer; (8) place, date, number and symbol.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/TTr-<abbreviation>".
2. Place and date line.
3. Title "TỜ TRÌNH" with the subject under it written "Về việc <subject>".
4. "Kính gửi:" and the addressee.
5. Opening: one sentence "<Agency> xin trình <addressee> xem xét, phê duyệt ... như sau:" (adapt it).
6. Body with Roman-numeral headings in bold: "I. Sự cần thiết" (reason, basis); "II. Nội dung đề xuất" (what, when, where, scale, budget with a table if there are several cost lines, who does it); "III. Kiến nghị" (what exactly the authority is asked to decide). Add "IV. Tổ chức thực hiện" only if the user gave it.
7. Closing sentence "Kính trình <addressee> xem xét, quyết định./." Then, if given, a line "Hồ sơ kèm theo:" with a short list.
8. Signer block and "Nơi nhận" ("- Như trên;" and "- Lưu: VT, <unit>.").`,
      call: `Parameters: path (for example "to-trinh-<topic>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "TỜ TRÌNH", subtitle "Về việc <subject>", content (items 4 to 7), signature, recipients.\n${SIGN}\n${RECIP}\nIf the proposal involves a budget, offer to build a cost sheet with the /dutoan command; use only amounts the user gave.`,
      filename: "to-trinh-phe-duyet-hoi-thao-2026-10-07.docx",
    }),
  },
  {
    command: "baocao",
    name: "Báo cáo",
    category: "van-ban-hanh-chinh",
    description: "Soạn báo cáo công tác/kết quả thực hiện theo thể thức hành chính, xuất ra Word",
    fields: [
      f("agency", "Cơ quan báo cáo", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("recipient", "Kính gửi", true, "Ban Giám hiệu Trường Đại học Mẫu"),
      f("topic", "Nội dung/kỳ báo cáo", true, "Kết quả công tác quý III năm 2026"),
      f("results", "Kết quả, số liệu (chỉ số liệu có thật)", true, "Tổ chức 12 lớp, 450 sinh viên tham gia, tỷ lệ đạt 92%"),
      f("problems", "Tồn tại, khó khăn, kiến nghị", false, "Thiếu phòng thực hành vào giờ cao điểm"),
      f("signer", "Người ký", true, "Nguyễn Văn A, Trưởng khoa"),
    ],
    prompt: adminPrompt({
      type: "báo cáo (report on work done, results or an incident)",
      need: `(1) reporting agency and parent agency; (2) who the report is for ("Kính gửi"); (3) the subject and the period covered; (4) results: activities, figures, comparisons - ONLY real data from the user or from files they name (read them with read_document); (5) strengths, shortcomings and causes; (6) the plan for the next period; (7) proposals; (8) signer; (9) place, date, number and symbol.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/BC-<abbreviation>".
2. Place and date line.
3. Title "BÁO CÁO" with the subject under it (for example "Kết quả công tác quý III năm 2026"; use "Về việc ..." only if the user asks).
4. "Kính gửi:" and the addressee, when the report is sent to a specific authority.
5. Opening: one or two sentences saying who reports on what, for which period.
6. Body with Roman-numeral headings in bold: "I. Tình hình chung" (context in a few sentences); "II. Kết quả thực hiện" (organized by task, with a table of figures when there are several indicators); "III. Đánh giá chung" (ưu điểm, hạn chế, nguyên nhân); "IV. Phương hướng, nhiệm vụ thời gian tới"; "V. Kiến nghị, đề xuất" (only if the user gave proposals).
7. Closing sentence such as "Trên đây là báo cáo ... của <agency>, xin báo cáo <addressee>./."
8. Signer block and "Nơi nhận".`,
      call: `Parameters: path (for example "bao-cao-<topic>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "BÁO CÁO", subtitle <subject>, content (items 4 to 7), signature, recipients.\n${SIGN}\n${RECIP}\nEvery number in the report must come from the user's data; when you compute a total or percentage, state how you computed it and double check it.`,
      filename: "bao-cao-ket-qua-quy-3-2026-10-07.docx",
    }),
  },
  {
    command: "kehoach",
    name: "Kế hoạch",
    category: "van-ban-hanh-chinh",
    description: "Soạn kế hoạch tổ chức hoạt động/sự kiện: mục đích, nội dung, phân công, kinh phí",
    fields: [
      f("agency", "Cơ quan ban hành", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("activity", "Hoạt động/sự kiện", true, "Tổ chức Hội thảo khoa học sinh viên năm 2026"),
      f("purpose", "Mục đích, yêu cầu", true, "Tạo diễn đàn trao đổi nghiên cứu; bảo đảm đúng tiến độ, tiết kiệm"),
      f("when_where", "Thời gian, địa điểm, thành phần", true, "08h00 ngày 20/11/2026, Hội trường A, 120 đại biểu"),
      f("tasks", "Phân công, thời hạn", false, "Bộ môn Mạng chuẩn bị nội dung; Văn phòng khoa lo hậu cần; hạn 10/11/2026"),
      f("budget", "Kinh phí (nếu có)", false, "Dự kiến 30.000.000 đồng từ nguồn của khoa"),
    ],
    prompt: adminPrompt({
      type: "kế hoạch (plan to organize an activity, event or period of work)",
      need: `(1) issuing agency and parent agency; (2) the activity and its name; (3) purpose and requirements; (4) content/program, time, place, participants; (5) assignment of tasks (who does what, by when); (6) budget and source, if any; (7) signer; (8) place, date, number and symbol; (9) the legal or planning bases, ONLY if the user gives them.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/KH-<abbreviation>".
2. Place and date line.
3. Title "KẾ HOẠCH" with the subject under it (for example "Tổ chức Hội thảo khoa học sinh viên năm 2026").
4. Opening basis, only if the user gave bases: "Căn cứ ...;" lines, then "<Agency> xây dựng kế hoạch ... như sau:". Without bases, use a one-sentence opening and do not make up any basis.
5. Body with Roman-numeral headings in bold: "I. MỤC ĐÍCH, YÊU CẦU" (1. Mục đích; 2. Yêu cầu); "II. NỘI DUNG, THỜI GIAN, ĐỊA ĐIỂM" (program table with columns Thời gian | Nội dung | Người thực hiện when there is a schedule); "III. PHÂN CÔNG THỰC HIỆN" (table Nội dung | Đơn vị/người phụ trách | Thời hạn); "IV. KINH PHÍ" (only if given; small table or sentences, amounts exactly as given); "V. TỔ CHỨC THỰC HIỆN" (one short paragraph on reporting and coordination).
6. Signer block and "Nơi nhận".`,
      call: `Parameters: path (for example "ke-hoach-<topic>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "KẾ HOẠCH", subtitle <subject>, content (items 4 and 5), signature, recipients.\n${SIGN}\n${RECIP}\nIf a budget is involved, offer to build a cost sheet with the /dutoan command.`,
      filename: "ke-hoach-hoi-thao-sinh-vien-2026-10-07.docx",
    }),
  },
  {
    command: "bienban",
    name: "Biên bản",
    category: "van-ban-hanh-chinh",
    description: "Soạn biên bản cuộc họp/làm việc: thành phần, nội dung, kết luận, chữ ký",
    fields: [
      f("agency", "Cơ quan/đơn vị", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("meeting", "Cuộc họp/buổi làm việc", true, "Họp giao ban tuần 40"),
      f("time_place", "Thời gian, địa điểm", true, "09h00 ngày 07/10/2026, phòng họp tầng 3"),
      f("attendees", "Chủ trì, thư ký, thành phần tham dự và vắng", true, "Chủ trì: Nguyễn Văn A; Thư ký: Trần Thị B; có mặt 12/14"),
      f("notes", "Ghi chép nội dung, ý kiến, kết luận", true, "Thống nhất lịch thi; giao Bộ môn Mạng soạn đề trước 20/10"),
    ],
    prompt: adminPrompt({
      type: "biên bản (minutes of a meeting or working session)",
      need: `(1) agency/unit; (2) the meeting's name and purpose; (3) start time and place; (4) the chair (chủ trì), the secretary (thư ký), attendees and absentees, with positions; (5) the agenda; (6) the opinions raised and the conclusions or decisions, with who is assigned what and by when; (7) the end time; (8) number and symbol if issued. The user's notes may be rough: organize them, but never add opinions, decisions or names that were not in the notes.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/BB-<abbreviation>".
2. Title "BIÊN BẢN" with the subject under it (for example "Họp giao ban tuần 40").
3. Opening paragraph: time ("Vào hồi ... giờ ..., ngày ... tháng ... năm ...") and place.
4. "**I. Thành phần tham dự**": Chủ trì; Thư ký; Có mặt (list); Vắng mặt (list, with reasons if given).
5. "**II. Nội dung cuộc họp**": the agenda items in order; for each, a short summary of the reported content and of the opinions (attributed to the person only when the notes say so).
6. "**III. Kết luận**" (or "Kết luận của chủ trì"): numbered decisions, each with the person or unit in charge and the deadline; a table Nội dung | Người phụ trách | Hạn is good when there are 3 or more.
7. Closing line: "Cuộc họp kết thúc vào ... giờ ... cùng ngày. Biên bản đã được đọc lại cho các thành phần cùng nghe và thống nhất thông qua." (only if the user confirms it; otherwise mark "[cần bổ sung]").
8. Signatures: do NOT pass signature. Add a two-column Markdown table at the end with the header cells "THƯ KÝ" and "CHỦ TRÌ", two empty rows for signing space, and a row with the two names (or "[cần bổ sung]").`,
      call: `Parameters: path (for example "bien-ban-<topic>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "BIÊN BẢN", subtitle <subject>, content (items 3 to 8). Pass recipients only if the minutes are to be distributed. Warn the user that the signature table has visible borders that can be removed in Word.\nACTION TRACKER: when the conclusions assign 3 or more tasks, or the user pasted a raw transcript, first list in 3 short groups what you extracted (quyết định, việc giao, câu hỏi còn mở) so the user can correct it. After saving the minutes also create_xlsx a NEW file (for example theo-doi-viec-<topic>-<yyyy-mm-dd>.xlsx), sheet "Việc cần làm", columns TT | Công việc | Người phụ trách | Hạn (a real ISO date YYYY-MM-DD) | Trạng thái ("Chưa làm") | Còn lại (ngày), with the formula =IF(D2="","",D2-TODAY()) on each row. Owners and deadlines come only from the notes; if one is missing write "[cần bổ sung]" and ask. Names exactly as in the notes.`,
      filename: "bien-ban-hop-giao-ban-tuan-40-2026-10-07.docx",
    }),
  },
  {
    command: "giaymoi",
    name: "Giấy mời",
    category: "van-ban-hanh-chinh",
    description: "Soạn giấy mời dự họp/hội thảo/sự kiện theo thể thức hành chính, xuất ra Word",
    fields: [
      f("agency", "Cơ quan mời", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("guest", "Kính mời (người/đơn vị)", true, "Ông Lê Văn C, Giám đốc Công ty Cổ phần Công nghệ Mẫu"),
      f("event", "Tên sự kiện, nội dung", true, "Hội thảo Chuyển đổi số trong giáo dục đại học"),
      f("time_place", "Thời gian, địa điểm", true, "08h00 ngày 20/11/2026, Hội trường A"),
      f("contact", "Liên hệ, xác nhận tham dự", false, "Cô Trần Thị B, 0900 000 000, trước ngày 15/11/2026"),
      f("signer", "Người ký", true, "Nguyễn Văn A, Trưởng khoa"),
    ],
    prompt: adminPrompt({
      type: "giấy mời (invitation letter)",
      need: `(1) inviting agency and parent agency; (2) the guest(s): name, position, organization, with the right form of address (Ông/Bà); (3) the event's name and purpose; (4) time and place; (5) program or content, dress code or things to bring, if any; (6) contact person and RSVP deadline; (7) signer; (8) place, date, number and symbol.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/GM-<abbreviation>".
2. Place and date line.
3. Title "GIẤY MỜI" with a short line under it stating the purpose (for example "Tham dự Hội thảo ...").
4. "Kính mời:" and the guest(s) with position and organization.
5. "Tới dự:" the event name; then lines "Thời gian:", "Địa điểm:", "Nội dung/Chương trình:" (a short list or table if there is a program), and "Chuẩn bị/Lưu ý:" only if the user gave any.
6. A short courteous closing, for example "Rất mong Ông/Bà sắp xếp thời gian tham dự." and the contact line ("Xin vui lòng xác nhận tham dự trước ... theo số điện thoại ..."), then "Trân trọng kính mời./."
7. Signer block and "Nơi nhận" (usually "- Như trên;" and "- Lưu: VT, <unit>.").`,
      call: `Parameters: path (for example "giay-moi-<event>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "GIẤY MỜI", subtitle <purpose line>, content (items 4 to 6), signature, recipients.\n${SIGN}\n${RECIP}\nIf there are several guests, offer to produce one letter per guest; do it only if the user agrees.`,
      filename: "giay-moi-hoi-thao-chuyen-doi-so-2026-10-07.docx",
    }),
  },
  {
    command: "giaygioithieu",
    name: "Giấy giới thiệu",
    category: "van-ban-hanh-chinh",
    description: "Soạn giấy giới thiệu cán bộ/giảng viên/sinh viên đến làm việc với cơ quan khác",
    fields: [
      f("agency", "Cơ quan giới thiệu", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("person", "Người được giới thiệu (họ tên, chức vụ/lớp)", true, "Ông Phạm Văn D, giảng viên Bộ môn Mạng"),
      f("destination", "Cơ quan/đơn vị được giới thiệu đến", true, "Sở Giáo dục và Đào tạo [tỉnh Mẫu]"),
      f("purpose", "Nội dung làm việc", true, "Liên hệ khảo sát nhu cầu bồi dưỡng tin học cho giáo viên"),
      f("valid", "Thời hạn có giá trị", false, "đến hết ngày 31/10/2026"),
      f("signer", "Người ký", true, "Nguyễn Văn A, Trưởng khoa"),
    ],
    prompt: adminPrompt({
      type: "giấy giới thiệu (letter of introduction)",
      need: `(1) issuing agency and parent agency; (2) the person(s) introduced: full name, position or class, unit (no ID numbers unless the user insists and supplies them); (3) the agency or unit he/she is introduced to; (4) the purpose of the visit; (5) validity period; (6) signer; (7) place, date, number and symbol.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/GGT-<abbreviation>".
2. Place and date line.
3. Title "GIẤY GIỚI THIỆU" (no subject line is needed).
4. "Kính gửi:" the destination agency or unit.
5. Body: "<Issuing agency> trân trọng giới thiệu:" then lines "Ông/Bà: <full name>", "Chức vụ/Đơn vị công tác: ...", "Được cử đến: <destination>", "Về việc: <purpose>".
6. A request line such as "Đề nghị Quý cơ quan tạo điều kiện để Ông/Bà <name> hoàn thành nhiệm vụ." and the validity line "Giấy giới thiệu có giá trị đến hết ngày <date>." (or "[cần bổ sung]" if unknown).
7. Signer block (with the stamp space) and "Nơi nhận" ("- Như trên;" and "- Lưu: VT, <unit>.").`,
      call: `Parameters: path (for example "giay-gioi-thieu-<name>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "GIẤY GIỚI THIỆU", content (items 4 to 6), signature, recipients.\n${SIGN}\n${RECIP}`,
      filename: "giay-gioi-thieu-pham-van-d-2026-10-07.docx",
    }),
  },
  {
    command: "giayuyquyen",
    name: "Giấy ủy quyền",
    category: "van-ban-hanh-chinh",
    description: "Soạn giấy ủy quyền giữa hai bên: phạm vi, thời hạn, cam kết (cần rà soát pháp lý)",
    fields: [
      f("grantor", "Bên ủy quyền (họ tên, chức vụ, đơn vị)", true, "Ông Nguyễn Văn A, Trưởng khoa, Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("grantee", "Bên được ủy quyền (họ tên, chức vụ, đơn vị)", true, "Bà Trần Thị B, Phó Trưởng khoa"),
      f("scope", "Phạm vi, nội dung ủy quyền", true, "Ký các giấy tờ xác nhận sinh viên thuộc phạm vi khoa trong thời gian đi công tác"),
      f("period", "Thời hạn ủy quyền", true, "Từ 12/10/2026 đến 20/10/2026"),
      f("note", "Điều kiện, giới hạn khác", false, "Không được ủy quyền lại cho người khác"),
    ],
    prompt: adminPrompt({
      type: "giấy ủy quyền (power of attorney between two parties)",
      need: `(1) the grantor ("Bên ủy quyền"): full name, position, unit, address; (2) the grantee ("Bên được ủy quyền"): same; (3) the exact scope of authority: what may be done, what may NOT be done; (4) the period; (5) whether sub-delegation is allowed; (6) place and date, number and symbol if any. ID card numbers, addresses and similar data only if the user supplies them: never guess them, and keep them out of file names.`,
      structure: `1. National header and agency block when the grantor is an agency (via letterhead); for an individual grantor pass only place_date in letterhead (the tool then prints just the national header and the date).
2. Title "GIẤY ỦY QUYỀN".
3. Opening: "Hôm nay, ngày ... tháng ... năm ..., tại ..., chúng tôi gồm:"
4. "**BÊN ỦY QUYỀN (Bên A):**" with name, position, unit, address, contact; "**BÊN ĐƯỢC ỦY QUYỀN (Bên B):**" with the same fields.
5. "**Điều 1. Phạm vi ủy quyền**": the specific powers, as a numbered list; then what is excluded.
6. "**Điều 2. Thời hạn ủy quyền**": from ... to ...
7. "**Điều 3. Trách nhiệm của các bên**": Bên B acts within the scope and reports the results to Bên A; Bên A is responsible for the legal consequences of acts done by Bên B within the scope (state this as a common clause and tell the user to confirm it).
8. "**Điều 4. Điều khoản chung**": the number of copies and effect from the date of signing.
9. Signatures: do NOT pass signature. End with a two-column Markdown table with header cells "BÊN ỦY QUYỀN" and "BÊN ĐƯỢC ỦY QUYỀN", two empty rows for signing space, and a row of the two names. In the final report remind the user that depending on the case the document may need certification or the agency's seal, and that they should check this with the competent office.`,
      call: `Parameters: path (for example "giay-uy-quyen-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "GIẤY ỦY QUYỀN", content (items 3 to 9).`,
      filename: "giay-uy-quyen-2026-10-07.docx",
      legal: true,
    }),
  },
  {
    command: "don",
    name: "Đơn xin",
    category: "van-ban-hanh-chinh",
    description: "Soạn đơn xin nghỉ phép, xin xác nhận, xin phép… gửi cấp có thẩm quyền, xuất ra Word",
    fields: [
      f("type", "Loại đơn", true, "Đơn xin nghỉ phép"),
      f("recipient", "Kính gửi", true, "Ban chủ nhiệm Khoa Công nghệ thông tin; Phòng Tổ chức cán bộ"),
      f("applicant", "Người làm đơn (họ tên, chức vụ/đơn vị hoặc lớp)", true, "Nguyễn Văn A, giảng viên Bộ môn Mạng"),
      f("reason", "Lý do, nội dung xin", true, "Giải quyết việc gia đình"),
      f("period", "Thời gian, công việc bàn giao", false, "Từ 12/10/2026 đến 14/10/2026; bàn giao lớp cho cô Trần Thị B"),
    ],
    prompt: adminPrompt({
      type: "đơn (application, e.g. leave request, request for certification, request for permission)",
      need: `(1) the kind of application; (2) the addressee(s) after "Kính gửi"; (3) the applicant's full name and position, unit or class (no ID numbers unless the user supplies them); (4) the reason and exactly what is requested; (5) dates or period and what is handed over to whom (for leave); (6) place and date. For an application with an "Ý kiến" section (opinion of the unit head), add it only if the user asks.`,
      structure: `1. National header only (via letterhead with place_date; an application has no issuing-agency block and no number).
2. Title in capitals, for example "ĐƠN XIN NGHỈ PHÉP" or "ĐƠN ĐỀ NGHỊ XÁC NHẬN ..." (use the title parameter).
3. "Kính gửi:" the addressee(s), one per line starting with "- " when there are several.
4. Self-introduction: "Tôi tên là: ...", "Chức vụ/Đơn vị công tác (hoặc Lớp): ...".
5. Request paragraph: "Nay tôi làm đơn này xin ... " with the reason and the dates; for leave add the handover arrangement.
6. Commitment and thanks: "Kính mong Quý ... xem xét, giải quyết. Tôi xin chân thành cảm ơn./."
7. Signer block: signature.role "Người làm đơn" and signature.name = the applicant (no recipients are needed).`,
      call: `Parameters: path (for example "don-xin-nghi-phep-<yyyy-mm-dd>.docx"), style "formal", letterhead {place_date} only, title (the name of the application in capitals), content (items 3 to 6), signature {role: "Người làm đơn", name}. Pass no recipients and no on_behalf.`,
      filename: "don-xin-nghi-phep-nguyen-van-a-2026-10-07.docx",
    }),
  },
  {
    command: "hopdong",
    name: "Hợp đồng dịch vụ/thuê khoán",
    category: "van-ban-hanh-chinh",
    description: "Soạn hợp đồng dịch vụ hoặc thuê khoán công việc đơn giản (cần pháp chế rà soát)",
    fields: [
      f("party_a", "Bên A (bên thuê): tên, đại diện, chức vụ, địa chỉ, MST, tài khoản", true, "Trường Đại học Mẫu; đại diện: Nguyễn Văn A, Hiệu trưởng; [địa chỉ]"),
      f("party_b", "Bên B (bên nhận): tên, đại diện, địa chỉ, MST/CCCD, tài khoản", true, "Ông Phạm Văn D; [địa chỉ]; [số tài khoản]"),
      f("work", "Nội dung công việc/dịch vụ, sản phẩm bàn giao", true, "Thiết kế và vận hành website sự kiện, bàn giao mã nguồn và tài liệu"),
      f("time", "Thời gian, địa điểm thực hiện", true, "Từ 12/10/2026 đến 30/11/2026"),
      f("price", "Giá trị, thuế, tiến độ thanh toán", true, "18.000.000 đồng, thanh toán 2 đợt 50%/50%"),
      f("terms", "Điều khoản khác (phạt, bảo mật, tranh chấp…)", false, "Bảo mật dữ liệu; phạt chậm tiến độ [mức do hai bên thoả thuận]"),
    ],
    prompt: adminPrompt({
      type: "hợp đồng dịch vụ / hợp đồng thuê khoán công việc (simple service or task contract)",
      need: `(1) Bên A: full legal name, representative and position, address, tax code, bank account; (2) Bên B: same (for an individual: name, address, ID or tax code only if supplied); (3) the work or service and the deliverables, with acceptance criteria; (4) the period and place; (5) the contract value in numbers (write the amount in words only if you are certain it is correct, and re-check it), who bears taxes and fees, payment schedule and method; (6) rights and obligations; (7) penalties, confidentiality, dispute resolution if the user wants them; (8) the number of copies; (9) place, date and contract number. Ask the user whether the contract is for an individual hired for a task or for an organization providing a service: the clauses differ.`,
      structure: `1. National header (via letterhead) with the contract number "Số: <number>/HĐ" if given, and place_date.
2. Title "HỢP ĐỒNG DỊCH VỤ" or "HỢP ĐỒNG THUÊ KHOÁN CÔNG VIỆC" (use what matches the user's case) with the subject under it ("V/v <work>").
3. Legal bases: ONLY those the user supplied, each "Căn cứ ...;". If none, write "Căn cứ [cần bổ sung];" and explain in the report that the legal department must supply them.
4. "Hôm nay, ngày ... tháng ... năm ..., tại ..., chúng tôi gồm:" then "**BÊN A (Bên thuê/Bên sử dụng dịch vụ):**" and "**BÊN B (Bên nhận/Bên cung cấp dịch vụ):**" with the particulars.
5. Articles, each a bold line "**Điều N. <heading>**" followed by numbered clauses: Điều 1 Nội dung công việc; Điều 2 Thời gian, địa điểm thực hiện; Điều 3 Giá trị hợp đồng và phương thức thanh toán; Điều 4 Quyền và nghĩa vụ của Bên A; Điều 5 Quyền và nghĩa vụ của Bên B; Điều 6 Nghiệm thu, thanh lý hợp đồng; Điều 7 Vi phạm, bồi thường và giải quyết tranh chấp; Điều 8 Điều khoản chung (number of copies, effect from the signing date). Keep clauses simple and neutral, and mark every blank (amounts, penalty rates, deadlines) with "[cần bổ sung]" - never invent penalty rates or tax rules.
6. Signatures: do NOT pass signature. End with a two-column Markdown table with header cells "ĐẠI DIỆN BÊN A" and "ĐẠI DIỆN BÊN B", two empty rows for signing space, and a row of names.`,
      call: `Parameters: path (for example "hop-dong-<work>-<yyyy-mm-dd>.docx"), style "formal", letterhead {doc_number, place_date} (add agency fields only if Bên A is an agency that wants its header), title, subtitle, content (items 3 to 6).`,
      filename: "hop-dong-dich-vu-website-2026-10-07.docx",
      legal: true,
      extra: `Warn the user clearly in the final report: a contract creates legal obligations, so it MUST be reviewed by the legal department or a lawyer (pháp chế) before signing.`,
    }),
  },
  {
    command: "bienbanbangiao",
    name: "Biên bản bàn giao",
    category: "van-ban-hanh-chinh",
    description: "Soạn biên bản bàn giao tài sản, hồ sơ, công việc giữa bên giao và bên nhận",
    fields: [
      f("agency", "Cơ quan/đơn vị lập biên bản", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("giver", "Bên giao (họ tên, chức vụ)", true, "Ông Phạm Văn D, kỹ thuật viên phòng máy"),
      f("receiver", "Bên nhận (họ tên, chức vụ)", true, "Bà Trần Thị B, Phó Trưởng khoa"),
      f("items", "Danh mục bàn giao (tên, số lượng, tình trạng)", true, "30 máy tính để bàn, hoạt động bình thường; 02 máy chiếu, 01 bị hỏng bóng đèn"),
      f("time_place", "Thời gian, địa điểm", true, "14h00 ngày 07/10/2026, phòng máy P.302"),
    ],
    prompt: adminPrompt({
      type: "biên bản bàn giao (handover record for assets, records or duties)",
      need: `(1) agency/unit; (2) giver (Bên giao) and receiver (Bên nhận) with full name and position; (3) what is handed over, as a list: name, unit of measure, quantity, condition, notes; (4) time and place; (5) the reason (for example staff change, project closing); (6) responsibilities after the handover; (7) the number of copies; (8) any witness or approving person.`,
      structure: `1. National header and agency block (via letterhead); the number line is "Số: <number>/BBBG-<abbreviation>" only if the user gave a number or symbol, else "Số: [cần bổ sung]".
2. Title "BIÊN BẢN BÀN GIAO" with the subject under it ("V/v bàn giao <what>").
3. Opening: time and place, then the reason or basis (only what the user gave).
4. "**I. Các bên tham gia bàn giao**": "Bên giao (Bên A):" and "Bên nhận (Bên B):" with names and positions; a witness line only if given.
5. "**II. Nội dung bàn giao**": a table with columns STT | Tên tài sản/hồ sơ/công việc | ĐVT | Số lượng | Tình trạng | Ghi chú, using only items the user listed. Quantities are numbers exactly as given; if you add a total row, compute and check it.
6. "**III. Trách nhiệm và cam kết**": Bên A has handed over fully as listed; Bên B has received, checked and is responsible from the handover time; open issues recorded in the notes.
7. Closing: "Biên bản được lập thành ... bản, mỗi bên giữ ... bản, có giá trị như nhau." (numbers from the user, else "[cần bổ sung]").
8. Signatures: do NOT pass signature. End with a Markdown table with header cells "BÊN GIAO" and "BÊN NHẬN" (add a third column "NGƯỜI XÁC NHẬN/CHỨNG KIẾN" only if given), two empty rows for signing space, and a row of names.`,
      call: `Parameters: path (for example "bien-ban-ban-giao-<what>-<yyyy-mm-dd>.docx"), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "BIÊN BẢN BÀN GIAO", subtitle, content (items 3 to 8).`,
      filename: "bien-ban-ban-giao-phong-may-2026-10-07.docx",
    }),
  },
  {
    command: "nhanxet",
    name: "Nhận xét, đánh giá cá nhân",
    category: "van-ban-hanh-chinh",
    description: "Soạn bản nhận xét, đánh giá cán bộ/sinh viên dựa trên dữ kiện bạn cung cấp",
    fields: [
      f("person", "Người được nhận xét (họ tên, chức vụ/lớp, đơn vị)", true, "Nguyễn Văn Mẫu, sinh viên lớp K65-CNTT1"),
      f("period", "Thời gian, nhiệm vụ được đánh giá", true, "Kỳ thực tập từ 01/07/2026 đến 31/08/2026 tại Công ty Mẫu"),
      f("facts", "Dữ kiện, minh chứng (kết quả, thái độ, thành tích, hạn chế)", true, "Hoàn thành 3/3 nhiệm vụ đúng hạn; đi làm đầy đủ; cần cải thiện kỹ năng thuyết trình"),
      f("rating", "Xếp loại/đề xuất (nếu đã có)", false, "Hoàn thành tốt nhiệm vụ"),
      f("author", "Người nhận xét (họ tên, chức vụ)", true, "Trần Thị B, cán bộ hướng dẫn"),
    ],
    prompt: adminPrompt({
      type: "bản nhận xét / đánh giá cá nhân (written assessment of a staff member, lecturer or student)",
      need: `(1) who is assessed: full name, position or class, unit; (2) the period and the tasks assessed; (3) FACTS and evidence the author provides: results, attitude, discipline, achievements, shortcomings; (4) the rating or recommendation, only if the author already decided it; (5) the author: name, position, relation to the person; (6) the agency, place and date. Personal and sensitive data (grades, salary, ID numbers) stays in the working folder: do not put it in the file name, and include in the text only what is necessary.`,
      structure: `1. National header and agency block (via letterhead) if the assessment is an official document of an agency; number line "Số: [cần bổ sung]" if not given.
2. Title "BẢN NHẬN XÉT" (or "BẢN ĐÁNH GIÁ" if the user says so) with a subject line under it, for example "Đối với <full name>".
3. "**I. Thông tin chung**": full name, position or class, unit, period assessed, tasks.
4. "**II. Nhận xét**": numbered sub-items such as 1. Kết quả thực hiện nhiệm vụ; 2. Chuyên môn, nghiệp vụ (or Kiến thức, kỹ năng); 3. Ý thức tổ chức kỷ luật, tinh thần trách nhiệm; 4. Tinh thần hợp tác; 5. Hạn chế, điểm cần cải thiện. Use only sub-items for which the author gave facts; each statement must rest on a fact the author provided. Tone: objective, respectful, specific, no exaggeration.
5. "**III. Đánh giá chung**": an overall conclusion in two or three sentences, with the rating only if the author gave it; otherwise "[cần bổ sung]".
6. Signer block for the author (the person who writes the assessment), and recipients only if the user names any.`,
      call: `Parameters: path (for example "nhan-xet-<short-label>-<yyyy-mm-dd>.docx" - no full personal names or IDs if the user wants privacy), style "formal", letterhead {agency_parent, agency, doc_number, place_date}, title "BẢN NHẬN XÉT", subtitle, content (items 3 to 5), signature.\n${SIGN}\nNever invent achievements, scores, ratings or praise to fill the form: if the facts are thin, write less and say so in the report.`,
      filename: "nhan-xet-thuc-tap-2026-10-07.docx",
    }),
  },
];

// ---------------------------------------------------------------- thư từ (soạn trong khung chat)

const CHAT_RULES = `Write the message IN THE CHAT, ready to copy and paste. Do NOT create a file (no create_docx and no other file tool) unless the user explicitly asks for one; if they do, use create_docx with style "modern" and read_document to check the saved file. You cannot send email or messages yourself: say so if the user asks.`;

interface MailSpec {
  type: string;
  need: string;
  structure: string;
  extra?: string;
}

function mailPrompt(s: MailSpec): string {
  return [
    `The user wants to write ${s.type} in Vietnamese. Request: $ARGUMENTS`,
    ASK + `\nInformation needed: ${s.need}`,
    CHAT_RULES,
    `STEP 2 - Structure of the message:\n${s.structure}`,
    `${s.extra ? s.extra + "\n" : ""}Style: courteous, direct, plain Vietnamese suited to the relationship (use "Kính gửi" with Quý/Ông/Bà for formal addressees); one idea per paragraph; no filler. ${NO_INVENT}`,
    `Finish with 1-3 short lines in Vietnamese: what the user must fill in or check before sending (names, dates, attachments, contact details), and an offer to make it shorter or more formal.`,
  ].join("\n\n");
}

const MAIL: WorkTemplate[] = [
  {
    command: "email",
    name: "Email công việc trang trọng",
    category: "thu-tu",
    description: "Soạn email công việc lịch sự, rõ yêu cầu và thời hạn (hiển thị trong khung chat)",
    fields: [
      f("recipient", "Người nhận (tên, chức danh, đơn vị)", true, "Ông Lê Văn C, Phó Giám đốc Công ty Cổ phần Công nghệ Mẫu"),
      f("purpose", "Mục đích email", true, "Đề nghị cung cấp báo giá thiết bị phòng máy"),
      f("details", "Nội dung, dữ kiện cần nêu", true, "30 máy tính cấu hình trong tệp đính kèm, giao hàng trước 30/11/2026"),
      f("deadline", "Hạn phản hồi", false, "trước ngày 15/10/2026"),
      f("sender", "Người gửi (họ tên, chức vụ, liên hệ)", true, "Nguyễn Văn A, Trưởng khoa, 0900 000 000"),
    ],
    prompt: mailPrompt({
      type: "a formal work email",
      need: `(1) recipient(s): name, position, organization, and how to address them; (2) purpose of the email; (3) the facts and details to include (dates, amounts, attachments); (4) what you want the recipient to do and by when; (5) the sender's name, position and contact details; (6) tone (very formal / friendly-formal).`,
      structure: `1. "Tiêu đề:" one line, specific, under about 12 words, starting with the key topic.
2. Greeting: "Kính gửi <title and name>,".
3. Opening: one sentence with the purpose (and a short courteous introduction only if the recipient does not know the sender).
4. Body: 2-4 short paragraphs or a short list with the needed details; the exact request and the deadline, in one clear sentence.
5. "File đính kèm:" line only if the user mentions attachments.
6. Closing: "Rất mong nhận được phản hồi của <Anh/Chị/Quý ...> trước <date>. Trân trọng cảm ơn." then "Trân trọng," and the signature lines (name, position, unit, phone, email).`,
    }),
  },
  {
    command: "thucamon",
    name: "Thư mời / Thư cảm ơn",
    category: "thu-tu",
    description: "Soạn thư mời dự sự kiện hoặc thư cảm ơn đối tác, diễn giả (trong khung chat)",
    fields: [
      f("kind", "Loại thư (mời hay cảm ơn)", true, "Thư cảm ơn"),
      f("recipient", "Người nhận (tên, chức danh, đơn vị)", true, "Ông Lê Văn C, Giám đốc Công ty Cổ phần Công nghệ Mẫu"),
      f("event", "Sự kiện/đóng góp liên quan", true, "Báo cáo chuyên đề tại Hội thảo Chuyển đổi số ngày 20/11/2026"),
      f("details", "Chi tiết cần nêu (thời gian, địa điểm hoặc kết quả đạt được)", true, "Hơn 100 đại biểu tham dự, nhận nhiều phản hồi tích cực"),
      f("sender", "Người gửi (họ tên, chức vụ)", true, "Nguyễn Văn A, Trưởng khoa"),
    ],
    prompt: mailPrompt({
      type: "an invitation letter (thư mời) or a thank-you letter (thư cảm ơn)",
      need: `(1) which one: invitation or thank-you; (2) recipient: name, position, organization, form of address; (3) the event or the contribution; (4) for an invitation: time, place, program, dress code, RSVP date and contact; for a thank-you: what exactly the person did and what result it had (only real facts); (5) the sender's name and position; (6) tone.`,
      structure: `For a THƯ MỜI:
1. "Tiêu đề:" "Thư mời tham dự <event>".
2. Greeting "Kính gửi <title and name>,".
3. Opening: who invites to what, with the reason for inviting this person.
4. A short block: "Thời gian:", "Địa điểm:", "Nội dung:" (and "Chương trình:" in two or three bullets if given).
5. Closing: ask for confirmation by the RSVP date with the contact, "Rất mong được đón tiếp <Ông/Bà>." and "Trân trọng kính mời."
For a THƯ CẢM ƠN:
1. "Tiêu đề:" "Thư cảm ơn <contribution or event>".
2. Greeting.
3. Thank the person for the specific contribution (one or two sentences, concrete, not generic).
4. The result or impact (only facts the user gave).
5. A hope to continue cooperating, then "Trân trọng cảm ơn." Both letters end with the signature lines (name, position, unit, contact).`,
    }),
  },
  {
    command: "phanhoi",
    name: "Email phản hồi khiếu nại",
    category: "thu-tu",
    description: "Soạn email phản hồi khiếu nại, góp ý lịch sự: ghi nhận, giải thích, hướng xử lý",
    fields: [
      f("complaint", "Nội dung khiếu nại/góp ý (tóm tắt)", true, "Sinh viên phản ánh điểm giữa kỳ chưa được cập nhật sau 3 tuần"),
      f("findings", "Kết quả kiểm tra, xác minh", true, "Đã kiểm tra: bảng điểm của giảng viên nộp muộn 1 tuần"),
      f("resolution", "Hướng giải quyết, thời hạn, người phụ trách", true, "Cập nhật điểm trước 12/10/2026; liên hệ thầy Phạm Văn D"),
      f("recipient", "Người nhận (tên, vai trò)", true, "Bạn Nguyễn Văn Mẫu, lớp K65-CNTT1"),
      f("sender", "Người gửi (họ tên, chức vụ)", true, "Trần Thị B, Phòng Đào tạo"),
    ],
    prompt: mailPrompt({
      type: "a polite reply email to a complaint or negative feedback (phản hồi khiếu nại/góp ý)",
      need: `(1) a short summary of the complaint and who made it; (2) what has been checked and found (only verified facts); (3) the resolution: what will be done, by whom, by when; (4) what the sender is allowed to promise (never promise compensation, refunds or policy changes the user did not authorize); (5) whether the sender may apologize for the inconvenience, or must avoid admitting fault; (6) the sender's name, position and contact; (7) the recipient and how to address them.`,
      structure: `1. "Tiêu đề:" "Phản hồi về <short subject>".
2. Greeting "Kính gửi <title and name>,".
3. Thank the person for the feedback and show that the message was read: restate the issue in one neutral sentence.
4. Acknowledge the inconvenience politely (an apology only if the user allowed it; never blame the person, never admit fault or legal liability on your own).
5. What was checked and found: only the facts given, in plain words.
6. The resolution: concrete steps, the responsible person, a date; and what the recipient can do if the problem remains (a contact line).
7. Closing: thanks, a wish to keep improving, "Trân trọng," and the signature lines.`,
      extra: `If the complaint contains personal or sensitive data, do not repeat more of it than necessary. If the facts given do not support a clear resolution, say so in the final note and propose a neutral holding reply ("đang kiểm tra, sẽ phản hồi trước ...").`,
    }),
  },
  {
    command: "thongbaonoibo",
    name: "Thông báo nội bộ ngắn",
    category: "thu-tu",
    description: "Soạn thông báo nội bộ ngắn gọn để gửi nhóm/email nội bộ (trong khung chat)",
    fields: [
      f("what", "Thông báo về việc gì", true, "Họp giao ban tuần 41"),
      f("when_where", "Thời gian, địa điểm/hình thức", true, "09h00 thứ Hai 12/10/2026, phòng họp tầng 3"),
      f("audience", "Đối tượng nhận", true, "Toàn thể giảng viên và cán bộ của khoa"),
      f("action", "Việc cần làm của người nhận", false, "Gửi báo cáo tuần trước 17h thứ Sáu 09/10/2026"),
      f("contact", "Đầu mối liên hệ", false, "Cô Trần Thị B, văn phòng khoa"),
    ],
    prompt: mailPrompt({
      type: "a short internal announcement (thông báo nội bộ)",
      need: `(1) what the announcement is about; (2) date, time, place or online link; (3) who it concerns; (4) what recipients must do and the deadline; (5) the contact person; (6) the channel (email, Zalo, group chat), which decides the length.`,
      structure: `1. "Tiêu đề:" one line, with the date or the key action first, for example "[Họp] ... ngày ...".
2. Greeting: "Kính gửi <audience>," (or "Chào cả nhà," only if the user asks for a friendly tone).
3. Core message in 2-4 short lines or bullets: Nội dung; Thời gian; Địa điểm/Hình thức; Yêu cầu đối với người nhận.
4. Contact line: "Liên hệ: <name, phone>".
5. A one-line closing: "Trân trọng thông báo." and the sender's name and unit.
Keep the whole message under about 120 words. After the main version, add a "Bản rút gọn" of at most 50 words for chat apps.`,
    }),
  },
];

// ---------------------------------------------------------------- bảng tính

const SHEET_COMMON = `Rules for the spreadsheet: put real numbers in cells (never strings such as "1.200.000"); formulas are strings that start with "=", use English function names and commas (for example =SUM(F2:F11)); ISO dates "YYYY-MM-DD" become real dates shown dd/mm/yyyy. The tool recalculates formulas and returns the values: compare them with a hand calculation of at least two rows. create_xlsx parameters: path, sheets[{name, rows, header, widths, freeze_header, autofilter, number_formats}]; the first row of each sheet is the header. Sheet names must not contain / \\ ? * [ ]. Do not use Vietnamese function names. ${NO_INVENT}`;

const SHEET_VERIFY = (example: string) =>
  `Save as a NEW .xlsx file with a clear name (for example ${example}); never overwrite an existing file. Then call read_document on it to verify: the headers, the number of data rows, the formulas and their results (check the totals by hand), and that no placeholder remains except "[cần bổ sung]".`;

interface SheetSpec {
  type: string;
  need: string;
  design: string;
  filename: string;
}

function sheetPrompt(s: SheetSpec): string {
  return [
    `The user wants a spreadsheet: ${s.type}. Request: $ARGUMENTS`,
    ASK + `\nInformation needed: ${s.need}`,
    `STEP 2 - Design of the workbook:\n${s.design}`,
    `STEP 3 - Create it with create_xlsx.\n${SHEET_COMMON}\nIf the user points to an existing file as the data source, read it with read_document first and copy real values from it; never edit the original.`,
    SHEET_VERIFY(s.filename),
    `Finish with a short report in Vietnamese: the file name, the sheets and columns, which cells hold formulas, what you verified, and what the user must still fill in or confirm ("[cần bổ sung]" items). Tell the user which cells to change when the data changes.`,
  ].join("\n\n");
}

const SHEETS: WorkTemplate[] = [
  {
    command: "chamcong",
    name: "Bảng chấm công tháng",
    category: "bang-tinh",
    description: "Tạo bảng chấm công tháng: ký hiệu, đếm ngày công, nghỉ phép bằng công thức",
    fields: [
      f("month", "Tháng, năm", true, "Tháng 10 năm 2026"),
      f("staff", "Danh sách nhân sự", true, "Nguyễn Văn A, Trần Thị B, Lê Văn C"),
      f("codes", "Ký hiệu chấm công đơn vị đang dùng", false, "x = đi làm cả ngày, n = nửa ngày, P = nghỉ phép, O = ốm, KL = nghỉ không lương"),
      f("holidays", "Ngày nghỉ lễ/ngày không làm việc trong tháng", false, "Không có"),
    ],
    prompt: sheetPrompt({
      type: "a monthly attendance sheet (bảng chấm công)",
      need: `(1) month and year; (2) the list of staff (full names; ask for unit and position columns only if the user wants them); (3) the attendance codes the unit uses (if none, propose: "x" full day, "n" half day, "P" annual leave, "O" sick leave, "KL" unpaid leave, "L" public holiday, and say these are only a suggestion); (4) public holidays or non-working days in the month; (5) whether to add an overtime column.`,
      design: `Sheet 1, named "Chấm công T<month>-<year>" (for example "Chấm công T10-2026"):
- Row 1 (header): "STT", "Họ và tên", then the day numbers 1, 2, ... up to the number of days of that month (28, 29, 30 or 31; work it out carefully, February depends on the leap year), then the total columns "Ngày công", "Nghỉ phép", "Nghỉ ốm", "Nghỉ không lương", "Nghỉ lễ", "Ghi chú".
- Row 2: the weekday of each day, as formulas, so that it is always right: in the day column for day d use =IF(WEEKDAY(DATE(<year>,<month>,d),2)=7,"CN","T"&(WEEKDAY(DATE(<year>,<month>,d),2)+1)) with the real year, month and day numbers written into the formula; columns A and B of this row hold "" and "Thứ".
- Rows 3 and below: one row per person with STT (1, 2, ...) and the name; the day cells stay empty for the user to fill in with the codes.
- Day columns start at column C (day 1 = C, day 2 = D, ...); work out the last day column letter (day 31 is column AG). With the last day column called <last>, row r holds: Ngày công =COUNTIF(C<r>:<last><r>,"x")+0.5*COUNTIF(C<r>:<last><r>,"n"); Nghỉ phép =COUNTIF(C<r>:<last><r>,"P"); Nghỉ ốm =COUNTIF(C<r>:<last><r>,"O"); Nghỉ không lương =COUNTIF(C<r>:<last><r>,"KL"); Nghỉ lễ =COUNTIF(C<r>:<last><r>,"L"). Adapt the codes to the ones the unit uses.
- Settings: freeze_header true, widths (STT 5, name 24, day columns 4, totals 11, note 20), number_formats {"<Ngày công column letter>": "0.0"}.
Sheet 2, named "Ký hiệu": a table of the codes and their meaning, plus the line "Ngày công = số ngày x + 0,5 × số ngày n" and the public holidays given by the user.
Pre-fill a few example codes ONLY if the user asks for a demo; otherwise leave the day cells empty and tell the user how to fill them. Do not claim the codes are mandated by any regulation.`,
      filename: "cham-cong-thang-10-2026.xlsx",
    }),
  },
  {
    command: "dutoan",
    name: "Dự toán kinh phí",
    category: "bang-tinh",
    description: "Lập bảng dự toán kinh phí: STT, nội dung, ĐVT, số lượng, đơn giá, thành tiền, tổng",
    fields: [
      f("activity", "Hoạt động/nhiệm vụ cần dự toán", true, "Hội thảo khoa học sinh viên năm 2026"),
      f("items", "Các khoản chi (nội dung, ĐVT, số lượng, đơn giá)", true, "Thuê hội trường 1 ngày 8.000.000; Tea break 120 người 35.000; In tài liệu 120 bộ 12.000"),
      f("source", "Nguồn kinh phí", false, "Kinh phí hoạt động của khoa"),
      f("norms", "Tệp hoặc căn cứ định mức (nếu có)", false, "Quy chế chi tiêu nội bộ [tên tệp trong thư mục]"),
    ],
    prompt: sheetPrompt({
      type: "a cost estimate (dự toán kinh phí) for an activity",
      need: `(1) the activity's name; (2) the cost lines: content, unit of measure (ĐVT), quantity, unit price - real numbers in VND; (3) whether lines are grouped (for example "I. Chi hội trường", "II. Chi in ấn") and whether each group needs a subtotal; (4) the funding source and the spending norms or rules to follow: if the user points to a file, read it with read_document and apply it, otherwise do NOT claim any norm or limit - put "[cần bổ sung]" in the Ghi chú column; (5) the preparer and approver (for the note below the table).`,
      design: `Sheet 1, named "Dự toán":
- Header row: "STT", "Nội dung", "ĐVT", "Số lượng", "Đơn giá (đồng)", "Thành tiền (đồng)", "Ghi chú".
- One row per cost line: STT as a number; Thành tiền as a formula =D<r>*E<r>. If a line has only a lump-sum amount, use quantity 1 and put the amount in the unit price.
- If lines are grouped: a group row (STT "I", "II", ... and the group name, quantity and price empty) followed by its lines, and a subtotal formula in the group row's Thành tiền, =SUM(F<first line>:F<last line>); the grand total is then the sum of the subtotal cells (for example =F2+F8), never a SUM over a range that includes subtotals.
- If not grouped: the last row is "Cộng" (or "Tổng cộng") with Thành tiền =SUM(F2:F<last line>).
- After the total row, one more row: "Bằng chữ:" followed by "[cần bổ sung]" - write the amount in words only if the user asks, and then re-check it carefully.
- number_formats {"D": "#,##0", "E": "#,##0", "F": "#,##0"}, widths for readable columns (STT 6, Nội dung 40, ĐVT 10, others 16, Ghi chú 24), freeze_header true.
If the funding source is given, add it in a second sheet "Thông tin" (Hoạt động, Nguồn kinh phí, Người lập dự toán, Ngày lập) with "[cần bổ sung]" for unknown items.
After creating it, give the grand total in the report so the user can compare with their own figure.`,
      filename: "du-toan-hoi-thao-sinh-vien-2026.xlsx",
    }),
  },
  {
    command: "lichtuan",
    name: "Lịch công tác tuần",
    category: "bang-tinh",
    description: "Lập lịch công tác tuần: thứ tự động theo ngày, buổi, nội dung, chủ trì, địa điểm",
    fields: [
      f("week", "Tuần (từ ngày … đến ngày …)", true, "Từ 12/10/2026 đến 18/10/2026"),
      f("unit", "Đơn vị lập lịch", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("events", "Các công việc trong tuần (ngày, buổi, giờ, nội dung, địa điểm, chủ trì, thành phần)", true, "Thứ Ba 13/10 sáng 08h30 họp giao ban, phòng họp tầng 3, chủ trì Nguyễn Văn A"),
      f("note", "Ghi chú chung", false, "Lịch có thể thay đổi, sẽ thông báo thêm"),
    ],
    prompt: sheetPrompt({
      type: "a weekly work schedule (lịch công tác tuần)",
      need: `(1) the week (first and last date); (2) the unit that issues it; (3) the events: date, session (sáng/chiều), time, content, place, chair (chủ trì), participants, preparing unit; (4) whether the schedule is per person (for example the head of the unit) or for the whole unit; (5) a general note.`,
      design: `Sheet 1, named "Lịch tuần <dd.mm>-<dd.mm>" (a dot, not a slash, in the sheet name):
- Header row: "Thứ", "Ngày", "Buổi", "Thời gian", "Nội dung công việc", "Địa điểm", "Chủ trì", "Thành phần tham dự", "Đơn vị chuẩn bị", "Ghi chú".
- Column B holds the real date as an ISO string "YYYY-MM-DD" (shown dd/mm/yyyy by the tool). Column A is a formula so that the weekday always matches the date (do not use CHOOSE, it is not reliable in this tool): =IF(WEEKDAY(B<r>,2)=7,"Chủ nhật","Thứ "&(WEEKDAY(B<r>,2)+1)).
- Rows sorted by date, then by session and time. One row per event. If a day has no event but the user wants it shown, add a row with "Không có lịch" (or "[cần bổ sung]") in the content column.
- widths for readable columns (Thứ 10, Ngày 12, Buổi 8, Thời gian 12, Nội dung 45, Địa điểm 22, Chủ trì 22, Thành phần 30, Chuẩn bị 20, Ghi chú 20), freeze_header true, autofilter true.
Add a second sheet "Thông tin" with the unit, the week ("Từ ngày ... đến ngày ...") and the general note.
Check that every date is inside the given week and that the weekday computed by the formula agrees with the weekday the user wrote; if they disagree, STOP and ask the user which is right.`,
      filename: "lich-cong-tac-tuan-12-10-2026.xlsx",
    }),
  },
  {
    command: "tiendo",
    name: "Theo dõi tiến độ công việc/dự án",
    category: "bang-tinh",
    description: "Lập bảng theo dõi tiến độ: hạn, % hoàn thành, trạng thái và số ngày còn lại tự tính",
    fields: [
      f("project", "Dự án/nhóm công việc", true, "Chuẩn bị Hội thảo khoa học sinh viên 2026"),
      f("tasks", "Danh sách việc (tên, người phụ trách, ngày bắt đầu, hạn, % hoàn thành)", true, "Lập kế hoạch - Trần Thị B - 01/10 đến 10/10/2026 - 100%; Mời diễn giả - Phạm Văn D - 05/10 đến 25/10/2026 - 40%"),
      f("ref_date", "Ngày chuẩn để tính (để trống nếu dùng ngày hôm nay)", false, "07/10/2026"),
    ],
    prompt: sheetPrompt({
      type: "a task and project progress tracker (theo dõi tiến độ)",
      need: `(1) the project name; (2) the tasks: name, person in charge, start date, deadline (due date), percent complete, notes; (3) the reference date for "days left": a fixed date given by the user (then the numbers stay reproducible) or today (use =TODAY(), and tell the user that the values change every day).`,
      design: `Three sheets.
Sheet "Thông số": header "Tham số", "Giá trị"; row 2: "Ngày chuẩn" and either the user's date as an ISO string "YYYY-MM-DD" or the formula =TODAY(); number_formats {"B": "dd/mm/yyyy"}.
Sheet "Theo dõi": header "STT", "Công việc", "Người phụ trách", "Bắt đầu", "Hạn hoàn thành", "Tiến độ", "Trạng thái", "Số ngày còn lại", "Ghi chú". Dates as ISO strings. "Tiến độ" is a fraction between 0 and 1 (40% = 0.4) with number_formats {"F": "0%"}. For row r:
  Trạng thái =IF(F<r>>=1,"Hoàn thành",IF(E<r><'Thông số'!$B$2,"Quá hạn",IF(F<r>=0,"Chưa bắt đầu","Đang thực hiện")))
  Số ngày còn lại =IF(F<r>>=1,"",E<r>-'Thông số'!$B$2)   (negative = days overdue; explain this in the report)
  freeze_header true, autofilter true, sensible widths.
Sheet "Tổng hợp": header "Chỉ tiêu", "Giá trị"; rows: "Tổng số việc" =COUNTA('Theo dõi'!B2:B<last>); "Hoàn thành" =COUNTIF('Theo dõi'!G2:G<last>,"Hoàn thành"); "Đang thực hiện"; "Chưa bắt đầu"; "Quá hạn" (the same COUNTIF with each label); "Tiến độ trung bình (%)" =ROUND(AVERAGE('Theo dõi'!F2:F<last>)*100,1). Check that the four status counts add up to the total.
Do not guess percentages or dates: for an unknown percentage use 0 and say so in the Ghi chú column with "[cần bổ sung]"; for an unknown deadline ask the user (formulas need a date).`,
      filename: "theo-doi-tien-do-hoi-thao-2026.xlsx",
    }),
  },
  {
    command: "thongke",
    name: "Thống kê danh sách",
    category: "bang-tinh",
    description: "Thống kê danh sách theo nhóm: đếm, tổng, trung bình bằng COUNTIF/SUMIF, giữ nguyên bản gốc",
    fields: [
      f("source", "Tệp/bảng dữ liệu nguồn", true, "danh-sach-sinh-vien.xlsx, sheet Danh sách"),
      f("group_by", "Cột để nhóm", true, "Lớp; Giới tính"),
      f("measure", "Cột số cần cộng/tính trung bình (nếu có)", false, "Điểm tổng kết"),
      f("goal", "Điều cần biết", false, "Mỗi lớp có bao nhiêu sinh viên, điểm trung bình từng lớp"),
    ],
    prompt: sheetPrompt({
      type: "a statistics summary of a list (thống kê: count, sum, average by group)",
      need: `(1) the source file and sheet (read it with read_document; if it is large, read it in ranges, for example A1:F200, then continue); (2) the column(s) to group by; (3) the numeric column(s) to add up or average, if any; (4) the exact question to answer; (5) any rows to exclude (blank rows, headers repeated in the middle). If the data is pasted in the chat instead of a file, build the workbook with create_xlsx.`,
      design: `Never modify the source file.
Preferred route when the source is an .xlsx: use xlsx_edit with save_as set to a NEW file (for example "<name>-thong-ke.xlsx") and add_sheet {name: "Thống kê", rows: [...]}, so the data stays in the copy and the formulas can point to it. Otherwise use create_xlsx with a "Dữ liệu" sheet (the data as real numbers and text) and a "Thống kê" sheet.
Sheet "Thống kê":
- Header row: the group name (for example "Lớp"), "Số lượng", and, when a numeric column exists, "Tổng", "Trung bình".
- One row per distinct group value, listed after you have read the data (sorted in a sensible order). For group value in A<r> and the data in sheet 'Dữ liệu' rows 2 to <n> (use the real sheet name in quotes and the real last row): Số lượng =COUNTIF('Dữ liệu'!<group col>2:<group col><n>,A<r>); Tổng =SUMIF('Dữ liệu'!<group col>2:<group col><n>,A<r>,'Dữ liệu'!<value col>2:<value col><n>); Trung bình =IF(B<r>=0,0,ROUND(C<r>/B<r>,2)).
- A final row "Cộng" with =SUM(B2:B<last group row>) and, if applicable, =SUM(C2:C<last group row>) and the overall average =ROUND(C<total>/B<total>,2).
- A control row "Tổng số bản ghi trong dữ liệu" with =COUNTA('Dữ liệu'!<group col>2:<group col><n>); it must equal "Cộng" in Số lượng. If not (for example misspelled group values or trailing spaces), report the difference and list the odd values.
For several grouping columns, make one block per column, each with its own header, below each other with an empty row between.
Mention in the report how many rows were read, and any row you excluded.`,
      filename: "danh-sach-sinh-vien-thong-ke.xlsx",
    }),
  },
  {
    command: "bangdiem",
    name: "Bảng điểm và xếp loại",
    category: "bang-tinh",
    description: "Lập bảng điểm: tổng kết theo trọng số, xếp loại tự động, thống kê phân bố",
    fields: [
      f("course", "Học phần/lớp", true, "Nhập môn lập trình - lớp K65-CNTT1"),
      f("weights", "Thành phần điểm và trọng số", true, "Chuyên cần 10%, giữa kỳ 30%, cuối kỳ 60%"),
      f("grading", "Thang điểm và ngưỡng xếp loại", true, "Thang 10: Giỏi từ 8,5; Khá từ 7,0; Trung bình từ 5,0; còn lại Yếu"),
      f("data", "Danh sách và điểm (hoặc tệp nguồn)", true, "file diem-hoc-phan.xlsx hoặc dán danh sách MSSV, họ tên, điểm"),
    ],
    prompt: sheetPrompt({
      type: "a grade sheet (bảng điểm) with weighted final scores and ranking",
      need: `(1) the course or class; (2) the score components and the weight of each (they must add up to 100%; check it); (3) the grading scale and the cut-offs for each ranking label: ask the user, do NOT assume the school's rules; (4) the student list and scores: from a file (read it with read_document first) or from the chat; (5) rounding rule (for example one decimal). Student names and IDs in the examples are fictitious; real grades stay in the working folder and must not appear in file names.`,
      design: `Sheet "Bảng điểm": header "STT", "MSSV", "Họ và tên", then one column per component (for example "Chuyên cần", "Giữa kỳ", "Cuối kỳ"), then "Tổng kết", "Xếp loại", "Ghi chú". Scores are real numbers. For row r with three components in D, E, F and the weights in the sheet "Quy chế" (rows 2 to 4):
  Tổng kết (column G) =IF(COUNT(D<r>:F<r>)<3,"",ROUND(D<r>*'Quy chế'!$B$2+E<r>*'Quy chế'!$B$3+F<r>*'Quy chế'!$B$4,1))
  Xếp loại (column H) =IF(G<r>="","",IF(G<r>>='Quy chế'!$B$8,"Giỏi",IF(G<r>>='Quy chế'!$B$9,"Khá",IF(G<r>>='Quy chế'!$B$10,"Trung bình","Yếu"))))
  Use the labels, the number of levels and the number of components the user gave and adjust the formulas and cell references accordingly. Missing scores stay empty (the formulas then show ""), and are listed in the report. number_formats {"D": "0.0", "E": "0.0", "F": "0.0", "G": "0.0"}, freeze_header true, autofilter true.
Sheet "Quy chế": row 1 header "Thành phần", "Trọng số"; rows 2-4 one row per component with the weight as a fraction (0.1, 0.3, 0.6); row 5 "Tổng trọng số" =SUM(B2:B4), which must equal 1; row 6 empty; row 7 a second small header "Xếp loại", "Từ điểm"; rows 8-10 the cut-offs (Giỏi, Khá, Trung bình) as numbers. If your layout differs, update the references in the formulas above.
Sheet "Thống kê": the number of students per ranking label =COUNTIF('Bảng điểm'!H2:H<last>,"Giỏi") etc., the total graded =COUNT('Bảng điểm'!G2:G<last>), the average =ROUND(AVERAGE('Bảng điểm'!G2:G<last>),2), the maximum =MAX('Bảng điểm'!G2:G<last>) and the minimum =MIN('Bảng điểm'!G2:G<last>). The counts per label must add up to the total graded.
Do not edit the original file; check three students by hand against the formulas and say which ones.`,
      filename: "bang-diem-nhap-mon-lap-trinh-2026.xlsx",
    }),
  },
];

// ---------------------------------------------------------------- trình chiếu

const SLIDE_RULES = `Slide format for create_pptx (parameters: path, content, footer): content is Markdown and slides are separated by a line containing only "---". Slide 1 is the cover: "# <Title>" followed by one or two plain lines (unit, speaker, date). Every other slide: "## <Slide title>" followed by 3-6 short bullets ("- ...", at most 15 words each, no full paragraphs) or one small table. Presenter notes: a paragraph starting exactly with "Ghi chú: " on its own line inside the slide, 2-4 sentences of what the speaker should say. One idea per slide. Slides are text only: tell the user in the report where an image, chart or logo would help ("[cần bổ sung: ...]" is fine in the notes, not on the slide face). Set footer to the unit's name (or the event name). ${NO_INVENT} Use only figures the user gave; do not draw conclusions the data does not support.`;

interface SlideSpec {
  type: string;
  need: string;
  outline: string;
  filename: string;
}

function slidePrompt(s: SlideSpec): string {
  return [
    `The user wants a PowerPoint presentation: ${s.type}. Request: $ARGUMENTS`,
    ASK + `\nInformation needed: ${s.need}\nIf the user names source files (reports, Word, Excel), read each one with read_document first and take facts only from them.`,
    `STEP 2 - Suggested outline (6-10 slides; merge or drop slides when material is thin, never pad):\n${s.outline}`,
    `STEP 3 - Create it with create_pptx.\n${SLIDE_RULES}`,
    `Save as a NEW .pptx file with a clear name (for example ${s.filename}); never overwrite an existing file. Then call read_document on it to verify: the number of slides, each slide's title, the notes, that the figures match the user's data, and that no slide has more than 6 bullets. Warn about any slide that may overflow.`,
    `Finish with a short report in Vietnamese: the file name, the list of slide titles, what you verified, the "[cần bổ sung]" items and the places where the user should add images or charts.`,
  ].join("\n\n");
}

const SLIDES: WorkTemplate[] = [
  {
    command: "tongket",
    name: "Báo cáo tổng kết",
    category: "trinh-chieu",
    description: "Tạo slide báo cáo tổng kết năm/kỳ/dự án: kết quả, số liệu, bài học, kế hoạch tới",
    fields: [
      f("topic", "Nội dung và kỳ tổng kết", true, "Tổng kết công tác năm học 2025-2026 của Khoa Công nghệ thông tin"),
      f("results", "Kết quả, số liệu chính (chỉ số liệu có thật)", true, "12 lớp bồi dưỡng, 450 sinh viên, tỷ lệ đạt 92%, 8 đề tài nghiên cứu"),
      f("lessons", "Hạn chế, bài học kinh nghiệm", false, "Thiếu phòng thực hành, chậm tiến độ một số đề tài"),
      f("next", "Phương hướng kỳ tới", false, "Mở thêm 2 lớp, hoàn thiện phòng máy"),
      f("audience", "Người nghe, thời lượng", false, "Hội nghị cán bộ, 15 phút"),
    ],
    prompt: slidePrompt({
      type: "a year-end or period summary report (báo cáo tổng kết)",
      need: `(1) the unit and the period; (2) the audience and the time available (this sets the slide count: about 1 slide per 1.5-2 minutes); (3) main results with real figures and comparisons to the previous period if the user gave them; (4) highlights and awards; (5) shortcomings and lessons; (6) the direction and targets for the next period; (7) proposals or thanks.`,
      outline: `1. Cover: "# Báo cáo tổng kết <period>" and the unit.
2. "## Nội dung báo cáo" (3-4 bullets: the agenda).
3. "## Tình hình chung" (context, in 3-4 bullets).
4-6. "## Kết quả nổi bật" slides: one slide per area (đào tạo, nghiên cứu, hoạt động khác... only the areas the user gave), each with 3-5 bullets; a small table Chỉ tiêu | Kế hoạch | Thực hiện only if both columns were given.
7. "## Hạn chế và bài học kinh nghiệm".
8. "## Phương hướng, nhiệm vụ <next period>".
9. "## Đề xuất, kiến nghị" (only if given).
10. "## Trân trọng cảm ơn" (closing, with the contact if given).
Every content slide has a "Ghi chú:" paragraph for the presenter.`,
      filename: "tong-ket-nam-hoc-2025-2026.pptx",
    }),
  },
  {
    command: "gioithieu",
    name: "Giới thiệu đơn vị/dự án",
    category: "trinh-chieu",
    description: "Tạo slide giới thiệu đơn vị hoặc dự án: sứ mệnh, hoạt động, thành tựu, liên hệ",
    fields: [
      f("subject", "Đơn vị/dự án cần giới thiệu", true, "Khoa Công nghệ thông tin, Trường Đại học Mẫu"),
      f("facts", "Thông tin chính (lịch sử, quy mô, thế mạnh, thành tựu)", true, "Thành lập 2010; 45 giảng viên; 3 ngành đào tạo; hợp tác với 10 doanh nghiệp"),
      f("audience", "Đối tượng nghe và mục tiêu", true, "Đối tác doanh nghiệp, mục tiêu tìm hợp tác thực tập"),
      f("contact", "Thông tin liên hệ", false, "Văn phòng khoa, [email], [số điện thoại]"),
    ],
    prompt: slidePrompt({
      type: "an introduction of an organization or a project (giới thiệu đơn vị/dự án)",
      need: `(1) the name of the unit or project; (2) the audience and the goal (partnership, recruitment, funding, induction of newcomers); (3) the facts: history, mission, structure, scale, strengths, programs or products, achievements with real numbers; (4) what the audience should do afterwards (call to action); (5) contact details; (6) the time available.`,
      outline: `1. Cover: "# <Name>" and a tagline or unit line.
2. "## Chúng tôi là ai" (history, mission, in 3-5 bullets).
3. "## Cơ cấu và quy mô" (numbers the user gave).
4. "## Lĩnh vực hoạt động / Thế mạnh".
5. "## Chương trình, sản phẩm chính" (for a project: "## Mục tiêu và kết quả chính").
6. "## Thành tựu tiêu biểu" (only real ones).
7. "## Cơ hội hợp tác" (tailored to the audience and goal).
8. "## Liên hệ" (name, email, phone, address, only what the user gave).
Add "Ghi chú:" for the presenter on each slide.`,
      filename: "gioi-thieu-khoa-cntt-2026.pptx",
    }),
  },
  {
    command: "dexuat",
    name: "Đề xuất dự án",
    category: "trinh-chieu",
    description: "Tạo slide đề xuất dự án/sáng kiến để xin chủ trương hoặc kinh phí",
    fields: [
      f("title", "Tên dự án/sáng kiến", true, "Xây dựng phòng thực hành an toàn thông tin"),
      f("problem", "Vấn đề, nhu cầu", true, "Sinh viên chưa có môi trường thực hành tấn công - phòng thủ; nhu cầu nhân lực cao"),
      f("solution", "Giải pháp, nội dung đề xuất", true, "Trang bị 20 máy chủ ảo hoá, xây dựng 10 bài thực hành"),
      f("plan", "Tiến độ, nhân sự, kinh phí", true, "6 tháng; 4 giảng viên; dự kiến 350.000.000 đồng"),
      f("ask", "Điều đề nghị người nghe quyết định", true, "Phê duyệt chủ trương và bố trí kinh phí"),
    ],
    prompt: slidePrompt({
      type: "a project or initiative proposal (đề xuất dự án) to obtain approval or funding",
      need: `(1) the project's name; (2) the problem or need, with evidence the user supplied; (3) the proposed solution and the expected results; (4) the plan: phases, time, team, responsibilities; (5) the budget and the source (real numbers only; if the user has a cost sheet, read it); (6) risks and how to handle them; (7) EXACTLY what decision or support is requested from the audience; (8) the audience and the time available.`,
      outline: `1. Cover: "# <Project name>" and the proposing unit.
2. "## Vấn đề và nhu cầu".
3. "## Mục tiêu của dự án".
4. "## Giải pháp đề xuất".
5. "## Kết quả dự kiến" (measurable, only what the user stated).
6. "## Kế hoạch thực hiện" (a table Giai đoạn | Nội dung | Thời gian when phases were given).
7. "## Nhân sự và phân công".
8. "## Kinh phí dự kiến" (a small table; the total must equal the sum of the lines: check it).
9. "## Rủi ro và biện pháp" (only if given, or if you ask the user to confirm the risks you suggest, marked "[cần bổ sung]").
10. "## Đề nghị" (the exact decision requested; thanks).
Each slide gets a "Ghi chú:" paragraph for the presenter.`,
      filename: "de-xuat-phong-thuc-hanh-attt-2026.pptx",
    }),
  },
];

// ---------------------------------------------------------------- khác

const OTHERS: WorkTemplate[] = [
  {
    command: "chuanbihop",
    name: "Chuẩn bị họp",
    category: "khac",
    description: "Lập chương trình họp có phân bổ thời gian và danh sách việc cần chuẩn bị (Word)",
    fields: [
      f("meeting", "Tên cuộc họp, mục đích", true, "Họp giao ban tuần 41 của Khoa Công nghệ thông tin"),
      f("when_where", "Thời gian, địa điểm/hình thức, thành phần", true, "09h00-10h30 thứ Hai 12/10/2026, phòng họp tầng 3, toàn bộ giảng viên"),
      f("agenda", "Các nội dung cần bàn, người trình bày", true, "Báo cáo tuần; kế hoạch thi; đề xuất mua sắm - Nguyễn Văn A, Trần Thị B"),
      f("prep", "Tài liệu, thiết bị, việc cần chuẩn bị", false, "Máy chiếu, bản in kế hoạch thi, danh sách điểm danh"),
    ],
    prompt: [
      `The user wants to prepare a meeting. Request: $ARGUMENTS`,
      ASK + `\nInformation needed: (1) the meeting's name and purpose; (2) date, start and end time, place or online link; (3) the chair, the secretary and the participants; (4) the agenda items with the presenter of each and the time each one needs; (5) documents, equipment and arrangements needed; (6) who prepares what, and by when.`,
      `STEP 2 - Content of the document (one Word file with two parts):
Part 1, "CHƯƠNG TRÌNH CUỘC HỌP": a short block with "Thời gian:", "Địa điểm:", "Chủ trì:", "Thư ký:", "Thành phần:"; then a table with columns Thời gian | Nội dung | Người trình bày | Thời lượng (phút). Times must be consecutive and add up to the meeting length: check the arithmetic and tell the user if the agenda does not fit. Include an opening and a closing item ("Khai mạc", "Kết luận và bế mạc") only if time allows.
Part 2, "DANH SÁCH VIỆC CẦN CHUẨN BỊ": a table with columns STT | Việc cần làm | Người phụ trách | Hạn | Tình trạng (write "Chưa làm"). Typical items: send the invitation or notice, prepare documents, check the room and equipment, record the minutes, follow up the decisions. Add only items that make sense for this meeting; mark unknown owners and deadlines as "[cần bổ sung]".
Finally, offer to draft the notice or invitation with the /thongbao or /giaymoi commands and the minutes with /bienban.`,
      `STEP 3 - Create the file with create_docx: path (for example "chuan-bi-hop-<topic>-<yyyy-mm-dd>.docx"), style "formal", title "CHƯƠNG TRÌNH CUỘC HỌP", subtitle = the meeting's name, content = parts 1 and 2 (use <<<pagebreak>>> between them only if part 1 fills most of a page), page_numbers true. This is an internal working document: do not add letterhead or signature unless the user asks for an official agenda. Do not start content with a "#" heading that repeats the title.`,
      FILE(".docx", "chuan-bi-hop-giao-ban-tuan-41-2026-10-12.docx"),
      `Rules: ${NO_INVENT}`,
      REPORT,
    ].join("\n\n"),
  },
  {
    command: "tonghop",
    name: "Tổng hợp ý kiến từ nhiều tài liệu",
    category: "khac",
    description: "Đọc nhiều tài liệu, gom ý kiến theo chủ đề, nêu đồng thuận/khác biệt, trích nguồn",
    fields: [
      f("topic", "Vấn đề cần tổng hợp", true, "Ý kiến góp ý dự thảo kế hoạch đào tạo năm học 2026-2027"),
      f("sources", "Thư mục hoặc danh sách tệp nguồn", true, "Thư mục gop-y/ (các tệp .docx và .xlsx)"),
      f("output", "Hình thức kết quả (trong chat hoặc tệp Word)", false, "Tệp Word tong-hop-gop-y.docx"),
      f("focus", "Điều cần làm nổi bật", false, "Các điểm các đơn vị không thống nhất"),
    ],
    prompt: [
      `The user wants a synthesis of opinions or information scattered over several documents. Request: $ARGUMENTS`,
      ASK + `\nInformation needed: (1) the topic or question; (2) where the documents are (a folder or a list of files) and which to ignore; (3) what to focus on (agreements, disagreements, proposals, figures); (4) the output: a summary in the chat, or a Word file; (5) the audience of the synthesis.`,
      `STEP 2 - Collect. Use find_in_documents with 2-4 different keywords related to the topic to locate relevant files and passages, and list the candidate files for the user in one line each. Then read the files ONE AT A TIME with read_document (use offset to continue long files; for Excel use sheet and range) and write short notes after each: who or which document said what, with its location (file name, heading, page or sheet when shown). Your context window is small: do not keep whole documents in mind, keep only notes. You cannot read scanned PDFs or images and cannot open old .doc/.xls/.ppt: list such files as "không đọc được" instead of guessing.`,
      `STEP 3 - Synthesize. Group the notes by theme (3-7 themes). For each theme give: the points of agreement, the points of difference (who thinks what), specific proposals, and the sources in brackets after each point, for example "(Bộ môn Mạng - gop-y-mang.docx, mục 2)". Present a table Chủ đề | Ý kiến chính | Nguồn | Đồng thuận/Khác biệt, and below it a short list "Vấn đề còn bỏ ngỏ" and "Đề xuất bước tiếp theo". Never merge conflicting figures or opinions silently, never attribute an opinion to a person or unit unless the document says so, and never add your own opinion as if it came from a source: mark your own suggestions as "Gợi ý". ${NO_INVENT}`,
      `STEP 4 - Output. By default present the synthesis in the chat. If the user asks for a file, create it with create_docx: path (for example "tong-hop-<topic>-<yyyy-mm-dd>.docx"), style "modern", title, subtitle, content with the table and lists (page_numbers true); save under a NEW name, never overwrite; then call read_document on the saved file to verify that all themes and sources are present and match your notes.`,
      `Finish with a short report in Vietnamese: the files you read (and those you could not read), the number of themes, the main agreements and disagreements, and the "[cần bổ sung]" items the user must supply or check.`,
    ].join("\n\n"),
  },
];

export const WORK_TEMPLATES: WorkTemplate[] = [...ADMIN, ...MAIL, ...SHEETS, ...SLIDES, ...OTHERS];
