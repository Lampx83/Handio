// Bẫy phiên bản thư viện: mô hình biết API cũ nhưng `npm install <gói>` (không ghi phiên bản) cài bản MỚI NHẤT với API khác hẳn.
// Dữ liệu thật: bài thử Chakra UI (agent cài v3, viết mã v2, 120 bước loay hoay trong node_modules rồi báo xong khi build còn hỏng).
// Chặn lệnh cài MƠ HỒ và bắt chọn phiên bản có chủ ý (không tự sửa lệnh: cái người dùng thấy/duyệt là cái được chạy).

const INSTALL = /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b/;
// gói đứng một mình (không có @phiên-bản), không phải tiền tố của gói khác như @chakra-ui/react-use-…
const CHAKRA = /(?:^|[\s'"=])@chakra-ui\/react(?![@\w./-])/;

export function installPitfall(command: string): string | null {
  if (!INSTALL.test(command)) return null;
  if (CHAKRA.test(command))
    return (
      "Chưa chạy lệnh. `@chakra-ui/react` không ghi phiên bản sẽ cài v3, mà API v3 khác hẳn v2 (ChakraProvider chỉ nhận `value={system}`, không có " +
      "extendTheme / useColorMode / useToast / InputLeftElement / Tabs kiểu cũ…). Mã bạn quen viết là v2: chạy lại với " +
      "`npm install @chakra-ui/react@2 @emotion/react @emotion/styled framer-motion`. Chỉ dùng `@chakra-ui/react@3` khi chủ ý, và khi đó đọc tài liệu v3 trước khi viết."
    );
  return null;
}
