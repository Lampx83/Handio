# packages/ui — giao diện dùng chung (web + Desktop)

- DOM thuần với `h()` (`dom.ts`). **Không dùng `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`** cho dữ liệu từ người dùng hay mô hình: dùng `textContent`/`h()`. Markdown đi qua `markdown.ts` (đã lọc); không tự tạo HTML từ chuỗi.
- Bản xem trước Design chạy trong `iframe sandbox="allow-same-origin"` (`preview.ts`): **không có `allow-scripts`** nên thiết kế không chạy được mã nào (không form, popup, điều hướng trang cha); `allow-same-origin` chỉ để mã của ứng dụng đọc DOM trong khung cho "Chỉ vào để sửa". Tài nguyên ngoài bị CSP của trang chặn (iframe `srcdoc` kế thừa CSP). **Không bao giờ thêm `allow-scripts`** (cùng với `allow-same-origin` là thoát sandbox) và đừng nới CSP. Mảnh HTML gửi cho agent đi qua `redactHtml` (`point-edit.ts`).
- Giao diện ít chữ, tiếng Việt có dấu, nhãn ngắn; đừng thêm đoạn giải thích dài vào màn hình chính (người dùng đã phàn nàn về chữ thừa). Có bản sáng/tối: dùng biến CSS ở `style.css`, không tô màu cứng.
- Phải dùng được bằng bàn phím và có `aria-*` cho thành phần tương tác mới; kiểm tra ở khổ điện thoại (cạnh bên thu gọn dưới 800px).
- Một thành phần dùng cả hai bản: không giả định `window.neu` (chỉ có ở Desktop) hay `localStorage` luôn dùng được (bọc try/catch).
- Thay đổi người dùng thấy → ghi `CHANGELOG.md`; thay đổi bố cục → xem thử bằng trình duyệt thật (`npm run dev:web`) ở cả sáng/tối.
