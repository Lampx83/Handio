/**
 * Nội dung hướng dẫn trong ứng dụng (cho người đã đăng nhập): mẹo, thủ thuật và tình huống mẫu theo từng tab.
 * Viết cho người dùng cuối, tiếng Việt, ngắn và làm theo được ngay. `tryIt` là câu mẫu: nút "Dùng thử" chèn vào ô nhập.
 */
export type GuideTab = "code" | "work" | "design";

export interface GuideItem {
  /** Tiêu đề ngắn. */
  t: string;
  /** Mô tả/cách làm. */
  d: string;
  /** Câu mẫu chèn vào ô nhập khi bấm "Dùng thử". */
  tryIt?: string;
}

export interface GuideSection {
  id: string;
  title: string;
  icon: string;
  intro?: string;
  items: GuideItem[];
}

const COMMON_AFTER: GuideSection[] = [
  {
    id: "noi-it", title: "Nói ít, ra nhiều", icon: "🎯",
    intro: "Bạn không cần viết dài. Hãy nói KẾT QUẢ bạn muốn; NEU Agent tự quyết các chi tiết còn lại và ghi rõ “Giả định” ở cuối báo cáo để bạn chỉnh.",
    items: [
      { t: "Công thức 3 ý: việc gì – cho ai – cảm giác mong muốn", d: "Ví dụ: “Trang giới thiệu CLB lập trình, cho tân sinh viên, trẻ trung”. Chỉ cần vậy là đủ để có bản đầu hoàn chỉnh.", tryIt: "Làm trang giới thiệu câu lạc bộ lập trình cho tân sinh viên, trẻ trung, có form đăng ký" },
      { t: "Mô tả kết quả, đừng mô tả cách làm", d: "Nói “có giỏ hàng, lưu lại khi tải lại trang”, không cần nói dùng thư viện nào hay chia file ra sao." },
      { t: "Mỗi lần sửa một ý", d: "“Tiêu đề to hơn” rồi “đổi màu nền sang xanh nhạt”. Sửa từng ý cho kết quả chính xác hơn nhiều lần sửa dồn." },
      { t: "Cho mẫu thay vì giải thích", d: "Đính kèm tệp mẫu (nút ＋ hoặc kéo thả) hoặc nói “giống như tệp X nhưng đổi Y”. Agent học theo mẫu rất tốt." },
      { t: "Dán nguyên thông báo lỗi", d: "Gặp lỗi thì dán nguyên văn thông báo, không cần tóm tắt. Agent đọc đúng dòng lỗi và sửa tận gốc." },
      { t: "Sai giả định? Chỉ cần nói", d: "Cuối mỗi lần làm, agent ghi “Giả định: …” (tối đa 3 ý). Giả định nào sai thì nói một câu, nó sửa đúng chỗ đó." },
      { t: "Việc lớn: lập kế hoạch trước", d: "Bấm chế độ chạy dưới ô nhập, chọn “Lập kế hoạch”: agent chỉ đọc và đề xuất kế hoạch; bạn duyệt rồi mới làm." },
    ],
  },
  {
    id: "anh-web", title: "Đọc ảnh, tìm web & lệnh mở rộng", icon: "🔎",
    intro: "NEU Agent đọc được ảnh (chữ tiếng Việt, bảng, biểu đồ) và tìm thông tin trên web có nêu nguồn. Hai việc này dùng thêm token, nên hãy nêu rõ bạn cần gì.",
    items: [
      { t: "Đọc ảnh chụp, bản scan", d: "Thả ảnh (png, jpg, webp) vào dự án rồi nhờ đọc: chữ tiếng Việt, bảng và biểu đồ đều đọc được. Chữ nhỏ, số tiền, ngày và số hiệu có thể sai: hãy đối chiếu lại. Ảnh lớn được tự thu nhỏ; PDF bản scan thì xuất từng trang thành ảnh trước.", tryIt: "Đọc các ảnh trong thư mục và chuyển thành một văn bản Word, chỗ nào không đọc được thì ghi rõ." },
      { t: "Bảng trong ảnh → Excel", d: "Chụp bảng điểm, bảng giá, danh sách rồi nói “chuyển thành Excel có công thức”. Agent đọc từng ô, tính lại tổng và báo nếu lệch so với ảnh.", tryIt: "Chuyển bảng trong ảnh thành Excel, tính tổng bằng công thức và so với tổng ghi trong ảnh." },
      { t: "Dán ảnh chụp lỗi thay vì gõ lại", d: "Ở tab Code, thả ảnh chụp màn hình lỗi vào dự án và nói “sửa lỗi trong ảnh”: agent đọc thông báo trong ảnh rồi làm việc với đúng dòng lỗi." },
      { t: "Tìm trên web, có nguồn", d: "Hỏi những gì cần thông tin bên ngoài hoặc mới thay đổi (quy định, giá, tin tức, tài liệu). Agent tìm, đọc vài trang đáng tin và trả lời kèm địa chỉ nguồn. Đọc một trang web sẽ hỏi bạn cho phép; chọn “luôn cho phép” nếu muốn bớt hỏi.", tryIt: "Tìm quy định mới nhất về chuẩn đầu ra ngoại ngữ của sinh viên đại học và tóm tắt, kèm nguồn." },
      { t: "Đừng đưa dữ liệu cá nhân vào câu tìm kiếm", d: "Từ khoá và địa chỉ trang được gửi ra ngoài hệ thống. Hãy tìm bằng từ khoá chung, không kèm họ tên, mã số, điểm hay nội dung tệp riêng tư." },
      { t: "Có giới hạn tìm kiếm", d: "Mỗi người có số lượt tìm và tải trang trong 10 phút để tránh bị các máy tìm kiếm chặn. Chạm giới hạn thì agent báo và làm tiếp với những gì đã có." },
      { t: "Gõ / để xem lệnh mở rộng", d: "Ngoài lệnh có sẵn còn có các lệnh theo nghiệp vụ như /nghien-cuu, /so-sanh, /phan-tich, /de-thi, /rubric, /soat-giao-dien, /doc-anh… Gõ /packs để xem các gói mở rộng đang bật." },
    ],
  },
  {
    id: "phim-tat", title: "Phím tắt & thao tác nhanh", icon: "⌨️",
    items: [
      { t: "Enter gửi · Shift+Enter xuống dòng", d: "Phím ↑ trong ô nhập gọi lại các câu bạn đã gửi." },
      { t: "Gõ / để mở lệnh và mẫu", d: "Danh sách lệnh và mẫu nghiệp vụ hiện ra, gõ tiếp để lọc. Có mẫu cho từng tab." },
      { t: "Gõ @ để nhắc tệp", d: "“Sửa @báo-cáo.docx cho gọn hơn”: agent biết chính xác tệp nào." },
      { t: "Shift+Tab đổi chế độ chạy", d: "Chọn giữa Hỏi trước, Tự động, Lập kế hoạch… Chế độ Tự động đủ cho việc thường ngày." },
      { t: "Esc để dừng · Esc hai lần để quay lại", d: "Quay lại một lượt trước, kể cả khôi phục các tệp đã đổi. Dùng khi agent làm lệch ý." },
      { t: "Kéo thả tệp vào cửa sổ", d: "Word, Excel, PowerPoint, PDF, ảnh mẫu thiết kế, mã nguồn… thả vào là dùng được." },
      { t: "Gửi thêm khi agent đang làm", d: "Cứ gõ tiếp: tin nhắn được xếp hàng và agent đọc ở bước kế tiếp, không phải chờ hết lượt." },
    ],
  },
  {
    id: "van-de", title: "Khi gặp vấn đề", icon: "🛟",
    items: [
      { t: "Agent làm lâu hoặc quay vòng", d: "Bấm nút Dừng (■) rồi nói hướng khác, hoặc “thử cách khác”. Agent tự dừng khi thấy mình lặp và nói rõ đang kẹt ở đâu." },
      { t: "“Đã hết số bước”", d: "Gõ “tiếp tục”. Agent làm tiếp từ chỗ dừng; nó luôn tóm tắt đã làm gì và còn gì." },
      { t: "Kết quả sai ý", d: "Esc hai lần (hoặc nút ↶ Quay lại) để về lượt trước, rồi nói lại một ý cụ thể hơn. Hoặc nói thẳng điều sai." },
      { t: "“Phiên đăng nhập đã hết hạn”", d: "Bấm nút Đăng nhập lại ngay trong thông báo. Cuộc trò chuyện và tệp của bạn vẫn còn." },
      { t: "“Đã dùng hết hạn mức hôm nay”", d: "Hạn mức token làm mới lúc 00:00 giờ Việt Nam. Dưới ô nhập có nhãn nhắc khi bạn đã dùng từ 80%. Hết hạn mức, bạn vẫn xem và sửa tệp thủ công." },
      { t: "Phản hồi chậm", d: "Vài chục giây là bình thường với việc nhiều bước. Nếu quá lâu, thử Dừng và gửi lại; báo lỗi ở Cài đặt nếu lặp lại." },
      { t: "Báo lỗi cho nhóm phát triển", d: "Cài đặt → Báo lỗi: xem trước đúng dữ liệu sẽ gửi (chỉ số liệu, không có nội dung) rồi gửi." },
    ],
  },
  {
    id: "rieng-tu", title: "Hạn mức & riêng tư", icon: "🔒",
    items: [
      { t: "Hạn mức token mỗi ngày", d: "Sinh viên 5 triệu, giảng viên 10 triệu token/ngày. Hết thì đợi sang ngày hôm sau; được vượt thêm khoảng 10% để hoàn tất việc đang làm. Việc dài tốn nhiều token hơn việc ngắn." },
      { t: "Mẹo tiết kiệm token", d: "Bắt đầu cuộc trò chuyện mới (＋) khi đổi chủ đề; nói rõ tệp cần xem bằng @; tránh dán cả tệp lớn khi chỉ cần một đoạn." },
      { t: "Dữ liệu của bạn", d: "Tệp nằm trong thư mục dự án trên máy bạn. Hệ thống chỉ gửi số liệu chẩn đoán KHÔNG có nội dung (tắt được ở Cài đặt)." },
      { t: "Đừng dán mật khẩu, khoá truy cập", d: "Agent không cần chúng. Nếu cần khoá API, hãy lưu vào tệp .env và nhờ agent đọc từ biến môi trường." },
    ],
  },
];

export const GUIDE: Record<GuideTab, GuideSection[]> = {
  code: [
    {
      id: "bat-dau", title: "Bắt đầu nhanh", icon: "🚀",
      intro: "Tab Code giúp bạn làm ra ứng dụng chỉ bằng cách mô tả. Agent lập kế hoạch, viết, chạy thử và sửa lỗi cùng bạn.",
      items: [
        { t: "1. Mở hoặc tạo dự án", d: "Chọn thư mục ở góc trên bên trái (hoặc “Dự án mới…”). Mọi tệp agent tạo ra nằm trong thư mục này." },
        { t: "2. Nói bạn muốn gì bằng một câu", d: "Agent tự quyết phần còn lại và làm trọn vẹn: giao diện thích ứng mọi màn hình, dữ liệu mẫu tiếng Việt, hướng dẫn chạy.", tryIt: "Làm website bán trà sữa có giỏ hàng, giao diện trẻ trung" },
        { t: "3. Bấm ▶ để chạy và xem", d: "Agent tự chạy thử và báo kết quả thật. Bạn bấm ▶ trên thanh trên để mở bản đang chạy, ± để xem các thay đổi, ↶ để quay lại." },
      ],
    },
    {
      id: "tinh-huong", title: "Tình huống mẫu", icon: "💡",
      intro: "Bấm “Dùng thử” để chèn câu mẫu vào ô nhập rồi sửa theo ý bạn.",
      items: [
        { t: "Website bán hàng nhỏ", d: "Trang sản phẩm, giỏ hàng, thanh toán giả lập, lưu giỏ khi tải lại.", tryIt: "Làm website bán trà sữa có giỏ hàng và thanh toán giả lập, giao diện trẻ trung" },
        { t: "Trang CV / portfolio cá nhân", d: "Giới thiệu, dự án, kỹ năng, liên hệ; đẹp trên điện thoại.", tryIt: "Làm trang portfolio cá nhân cho sinh viên CNTT, có phần dự án và liên hệ" },
        { t: "Ứng dụng việc cần làm (Todo)", d: "Thêm, sửa, xoá, lọc, đánh dấu xong; dữ liệu còn nguyên khi tải lại trang.", tryIt: "Làm app danh sách việc cần làm có lọc, sửa, xoá và lưu lại khi tải lại trang" },
        { t: "Trò chơi nhỏ", d: "Rắn săn mồi, 2048, cờ ca-rô… có điểm cao nhất và nút chơi lại.", tryIt: "Làm game rắn săn mồi chơi bằng phím mũi tên, có điểm cao nhất và nút chơi lại" },
        { t: "Trang thống kê từ CSV", d: "Thả tệp CSV vào, nhờ làm bảng và biểu đồ.", tryIt: "Đọc file điểm.csv và làm trang thống kê có biểu đồ cột và bảng xếp hạng" },
        { t: "Sửa lỗi chương trình", d: "Dán lỗi hoặc chỉ nói “chạy rồi sửa”. Agent chạy, đọc lỗi, tìm nguyên nhân gốc, sửa và chạy lại.", tryIt: "Chạy chương trình, đọc lỗi và sửa đến khi chạy đúng" },
        { t: "Hiểu một dự án có sẵn", d: "Cho người mới: nó đọc mã rồi giải thích luồng chính bằng lời dễ hiểu.", tryIt: "/explain dự án này, dành cho người mới học" },
        { t: "Thêm tính năng vào dự án đang có", d: "Nói rõ giữ nguyên giao diện/cấu trúc để agent chỉ sửa đúng chỗ cần.", tryIt: "Thêm chức năng tìm kiếm vào trang hiện tại, giữ nguyên giao diện" },
        { t: "Viết test và chạy", d: "Agent viết test cho các hàm quan trọng rồi chạy cho bạn xem kết quả.", tryIt: "Viết test cho các hàm trong thư mục src và chạy" },
      ],
    },
    {
      id: "meo", title: "Mẹo & thủ thuật", icon: "✨",
      items: [
        { t: "“Đẹp hơn” thì nói rõ đẹp là sao", d: "“Tông xanh dương, bo góc lớn, chữ to hơn, nhiều khoảng trắng hơn” cho kết quả tốt hơn “làm đẹp lên”.", tryIt: "Làm giao diện sang hơn: tông xanh dương đậm, bo góc lớn, chữ to hơn, nhiều khoảng trắng hơn" },
        { t: "Nhờ rà soát trước khi chốt", d: "Gõ /review để agent đọc các thay đổi và nhận xét như một người kiểm duyệt; /commit để tạo commit gọn." },
        { t: "Dạy agent quy ước của dự án", d: "Gõ /init để tạo AGENTS.md (cách chạy, quy ước đặt tên…). Từ đó agent làm đúng ý hơn mà bạn không cần nhắc lại." },
        { t: "Việc lớn: chế độ Lập kế hoạch", d: "Agent đề xuất các bước, bạn duyệt hoặc chỉnh, rồi mới làm. Hợp với dự án nhiều phần." },
        { t: "Xem và hoàn tác", d: "Nút ± liệt kê tệp đã đổi (xem từng dòng); ↶ quay lại một lượt trước, kể cả khôi phục tệp." },
        { t: "Chạy lệnh trực tiếp bằng !", d: "Gõ “!npm test” (hoặc lệnh khác) để chạy ngay; kết quả được đưa vào cuộc trò chuyện để agent đọc." },
        { t: "Học vibe coding", d: "Nút 📚 Học có bài học ngắn và bài tập tự chấm điểm trên dự án mẫu." },
      ],
    },
  ],
  work: [
    {
      id: "bat-dau", title: "Bắt đầu nhanh", icon: "🚀",
      intro: "Tab Work xử lý Word, Excel, PowerPoint, PDF: tóm tắt, soạn thảo, tính toán, làm slide… bạn chỉ cần nói việc cần làm.",
      items: [
        { t: "1. Đưa tệp vào", d: "Kéo thả tệp vào cửa sổ hoặc bấm ＋. Không có tệp cũng được: bạn nói việc, agent soạn mới." },
        { t: "2. Nói việc cần làm bằng vài chữ", d: "Agent tự suy ra loại văn bản, bố cục và thể thức; chỗ nào thiếu thông tin nó để dấu [cần bổ sung] cho bạn điền.", tryIt: "Soạn thông báo họp tổng kết học kỳ, thứ Sáu tuần sau" },
        { t: "3. Mở tệp kết quả", d: "Kết quả được lưu thành tệp mới (không ghi đè bản gốc). Agent đọc lại để kiểm tra số liệu và nói rõ đã kiểm tra gì." },
      ],
    },
    {
      id: "tinh-huong", title: "Tình huống mẫu", icon: "💡",
      intro: "Bấm “Dùng thử” để chèn câu mẫu; nhiều việc có sẵn mẫu nghiệp vụ khi bạn gõ /.",
      items: [
        { t: "Tổng kết điểm → báo cáo", d: "Từ bảng điểm, tính điểm tổng kết bằng công thức sống, xếp loại và làm báo cáo Word.", tryIt: "Tính điểm tổng kết từ file điểm, xếp loại và lập báo cáo Word" },
        { t: "Thông báo / công văn / biên bản", d: "Soạn đúng thể thức hành chính từ ghi chú rời rạc.", tryIt: "Soạn thông báo họp từ ghi chú này" },
        { t: "Slide từ tài liệu", d: "Từ file Word hoặc ý chính thành bài thuyết trình có mạch rõ ràng.", tryIt: "Tạo slide báo cáo 8 trang từ file Word đang chọn" },
        { t: "Rà soát chính tả, số liệu, thể thức", d: "Liệt kê lỗi thành bảng, không sửa bản gốc.", tryIt: "/rasoat bản kế hoạch năm học" },
        { t: "Giấy mời / giấy chứng nhận hàng loạt", d: "Một mẫu Word + một bảng Excel → hàng chục bản riêng cho từng người.", tryIt: "/tronthu giấy mời từ danh sách khách mời" },
        { t: "Hỏi đáp từ tài liệu có trích dẫn", d: "Trả lời CHỈ dựa trên tệp của bạn, kèm trích dẫn bấm vào xem được.", tryIt: "/hoidap Quy chế nói gì về điều kiện xét học bổng?" },
        { t: "Bảng tổng hợp theo nhóm", d: "Kiểu PivotTable bằng công thức sống: tự cập nhật khi dữ liệu đổi.", tryIt: "/bangtonghop tổng doanh thu theo khu vực và tháng" },
        { t: "Quét dữ liệu cá nhân trước khi chia sẻ", d: "Phát hiện số CCCD, điện thoại, email… và tạo bản che.", tryIt: "/quetcanhan" },
      ],
    },
    {
      id: "meo", title: "Mẹo & thủ thuật", icon: "✨",
      items: [
        { t: "Ghi chú nháp dài cũng được", d: "Cứ dán nguyên ghi chú lộn xộn: agent tự sắp xếp thành văn bản có cấu trúc." },
        { t: "Điền sau với [cần bổ sung]", d: "Agent không bịa số liệu, tên, số văn bản. Chỗ nào chưa biết, nó đánh dấu để bạn điền nhanh." },
        { t: "Đối chiếu với nguồn", d: "Nói “kiểm tra lại số liệu so với file gốc” để có bảng đối chiếu từng con số." },
        { t: "Sửa văn bản của người khác", d: "Nói “sửa có theo dõi”: thay đổi hiện dưới dạng Track Changes để người kia chấp nhận hoặc từ chối." },
        { t: "Excel dùng công thức sống", d: "Kết quả luôn là công thức (=SUM…) chứ không phải số gõ tay, nên sửa dữ liệu là tự tính lại." },
        { t: "Luôn có bản mới", d: "Bản gốc không bị ghi đè; kết quả thêm hậu tố -v2 hoặc ngày. Muốn ghi đè thì nói rõ." },
      ],
    },
  ],
  design: [
    {
      id: "bat-dau", title: "Bắt đầu nhanh", icon: "🚀",
      intro: "Tab Design tạo poster, landing page, slide, logo, thiệp… dưới dạng một tệp HTML/SVG xem ngay bên phải.",
      items: [
        { t: "1. Nói loại thiết kế và nội dung chính", d: "Agent tự chọn bảng màu, chữ, bố cục hợp mục đích và viết nội dung thật (không dùng lorem ipsum).", tryIt: "Poster A4 cho hội thảo AI trong giáo dục, phong cách hiện đại" },
        { t: "2. Xem và chỉnh bên phải", d: "Chọn khổ xem trước (A4, vuông, story, slide…). Bấm 🎯 Chỉ vào để sửa rồi bấm thẳng vào phần muốn đổi." },
        { t: "3. Xuất PDF / PNG", d: "Bản Desktop có nút PDF và PNG; bản web có nút tải tệp HTML." },
      ],
    },
    {
      id: "tinh-huong", title: "Tình huống mẫu", icon: "💡",
      items: [
        { t: "Poster hội thảo / sự kiện", d: "Có tiêu đề nổi bật, thời gian địa điểm, nội dung chính, khu vực QR.", tryIt: "Poster A4 cho hội thảo AI trong giáo dục, ngày 15/11, hội trường A" },
        { t: "Landing page giới thiệu khoá học", d: "Đầu trang, lợi ích, chương trình, đăng ký; thích ứng điện thoại.", tryIt: "Làm landing page giới thiệu khoá học lập trình Python cho người mới" },
        { t: "Bộ slide thuyết trình", d: "Mỗi slide một ý, bố cục thống nhất.", tryIt: "Làm bộ 6 slide giới thiệu đề tài nghiên cứu về chuyển đổi số" },
        { t: "Logo cho câu lạc bộ", d: "Logo bằng SVG gọn, dùng được trên nền sáng và tối.", tryIt: "Thiết kế logo cho câu lạc bộ lập trình, tối giản" },
        { t: "Thiệp mời, danh thiếp, banner", d: "Đúng khổ chuẩn (thiệp, danh thiếp 1050×600, banner mạng xã hội).", tryIt: "Thiệp mời lễ tốt nghiệp, trang trọng, tông xanh navy và vàng" },
        { t: "Infographic", d: "Biến số liệu/ý chính thành hình dễ nhìn.", tryIt: "Infographic 5 bước nghiên cứu khoa học cho sinh viên" },
      ],
    },
    {
      id: "meo", title: "Mẹo & thủ thuật", icon: "✨",
      items: [
        { t: "🎯 Chỉ vào để sửa", d: "Bấm nút 🎯 trên khung xem trước, bấm vào tiêu đề/nút/khối cần đổi, rồi chọn “To hơn / Đổi màu / Căn giữa…” hoặc gõ vài chữ. Không phải mô tả “cái nút thứ hai bên trái”." },
        { t: "Nói bằng cảm xúc và màu", d: "“Trẻ trung, tông cam – xanh”, “trang trọng, vàng đồng” giúp agent chọn đúng phong cách." },
        { t: "Dán ý chính, để agent viết lời", d: "Cho 3–5 gạch đầu dòng; nó viết nội dung hoàn chỉnh, ngắn gọn, đúng giọng." },
        { t: "Tạo biến thể", d: "Gõ /bienthe để có phiên bản khác (màu, bố cục) thành tệp mới, không mất bản cũ.", tryIt: "/bienthe đổi sang tông xanh lá" },
        { t: "Nội dung thật cần bạn cung cấp", d: "Tên tổ chức, số điện thoại, địa chỉ… agent để dấu [..] thay vì bịa. Bạn điền hoặc nhờ agent điền." },
        { t: "Không dùng ảnh ngoài", d: "Thiết kế chạy không cần mạng: dùng hình vẽ SVG, biểu tượng và khối màu. Chỗ cần ảnh thật có khung ghi chú." },
      ],
    },
  ],
};

/** Các mục chung hiển thị sau mục riêng của từng tab. */
export const GUIDE_COMMON: GuideSection[] = COMMON_AFTER;

/** Mẹo ngắn hiện trên màn hình chào (luân phiên). */
export const TIPS: Record<GuideTab, string[]> = {
  code: [
    "Chỉ cần nói kết quả bạn muốn bằng một câu: agent tự quyết các chi tiết và làm trọn vẹn.",
    "Gặp lỗi? Dán nguyên thông báo lỗi, không cần tóm tắt.",
    "Gõ / để mở các lệnh như /init, /review, /explain.",
    "Esc hai lần để quay lại lượt trước, kể cả khôi phục các tệp đã đổi.",
    "Việc lớn? Chọn chế độ “Lập kế hoạch” để duyệt các bước trước khi làm.",
  ],
  work: [
    "Kéo thả tệp Word/Excel vào cửa sổ rồi nói việc cần làm bằng vài chữ.",
    "Chỗ chưa biết sẽ được đánh dấu [cần bổ sung] để bạn điền, agent không bịa số liệu.",
    "Gõ / để mở mẫu nghiệp vụ: thông báo, biên bản, trộn thư, bảng tổng hợp…",
    "Kết quả luôn lưu thành tệp mới; bản gốc của bạn không bị ghi đè.",
    "Nói “kiểm tra lại số liệu so với file gốc” để có bảng đối chiếu.",
  ],
  design: [
    "Bấm 🎯 Chỉ vào để sửa rồi bấm thẳng vào phần cần đổi: không cần mô tả vị trí.",
    "Nói bằng cảm xúc và màu: “trẻ trung, tông cam – xanh” là đủ để bắt đầu.",
    "Gõ /bienthe để có phiên bản khác mà không mất bản cũ.",
    "Chọn khổ xem trước (A4, vuông, story, slide) ở góc trên khung bên phải.",
    "Dán 3–5 ý chính, agent sẽ viết nội dung hoàn chỉnh cho bạn.",
  ],
};

/** Tìm kiếm không phân biệt dấu/hoa thường trong tiêu đề, mô tả và câu mẫu. */
export function searchGuide(sections: GuideSection[], q: string): { section: GuideSection; items: GuideItem[] }[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return sections.map((section) => ({ section, items: section.items }));
  return sections
    .map((section) => ({ section, items: section.items.filter((i) => { const hay = norm(`${i.t} ${i.d} ${i.tryIt ?? ""} ${section.title}`); return terms.every((t) => hay.includes(t)); }) }))
    .filter((x) => x.items.length);
}
