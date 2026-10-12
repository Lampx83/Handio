// Kiểm thử không được gọi mạng ngoài: LocalController.create hỏi /quota của máy chủ mặc định mỗi lần tạo, nên mỗi lượt chạy bộ kiểm thử
// từng bắn hàng trăm yêu cầu không đăng nhập (401) lên máy chủ thật, làm nhiễu nhật ký và số liệu. Chỉ cho localhost; test nào cần
// giả lập fetch thì vẫn tự đặt (vi.stubGlobal / fetchImpl) và ghi đè cái này.
const real = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? input);
  if (/^https?:\/\//i.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u)) return Promise.reject(new TypeError("kiểm thử: không gọi mạng ngoài (" + u.replace(/^(https?:\/\/[^/]+).*/, "$1") + ")"));
  return real(input, init);
}) as typeof fetch;
