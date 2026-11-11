/**
 * Phát hiện mô hình rơi vào vòng lặp văn bản (cứ nhắc lại cùng một đoạn/câu, không làm gì) khi đang sinh dần câu trả lời.
 * Lặp như vậy tiêu hết token đầu ra (tới tối đa cho phép) mà không tiến triển, nên phải ngắt sớm. Chỉ dùng cho phần chữ trả lời, không phải đối số công cụ.
 */

const MIN_LEN = 60; // câu ngắn hơn không tính (tiêu đề, mục danh sách ngắn…)
const MIN_REPEATS = 4;
const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Nếu `text` có một câu/đoạn đủ dài lặp lại từ MIN_REPEATS lần trở lên, trả về vị trí cắt (ngay trước lần lặp thứ hai) để giữ lại một bản;
 * ngược lại null. Có thể gọi lặp lại trên chuỗi đang dài ra (người gọi nên giới hạn tần suất).
 */
export function findRepetition(text: string): { cut: number } | null {
  if (text.length < MIN_LEN * MIN_REPEATS) return null;
  const parts: { raw: string; at: number }[] = [];
  const re = /[^\n.!?。]+[.!?。]?/g;
  for (let m = re.exec(text); m; m = re.exec(text)) if (m[0].trim().length >= MIN_LEN) parts.push({ raw: m[0], at: m.index });
  const seen = new Map<string, number[]>();
  for (const p of parts) {
    const k = norm(p.raw);
    if (k.length < MIN_LEN) continue;
    const list = seen.get(k) ?? [];
    list.push(p.at);
    seen.set(k, list);
    if (list.length >= MIN_REPEATS) return { cut: list[1] };
  }
  return null;
}

/**
 * Nhóm của một lệnh bash "thăm dò máy chủ cục bộ" (curl, wget, Invoke-WebRequest): cùng địa chỉ là cùng nhóm dù đổi mẫu tìm, đổi cách lọc
 * (`curl URL | findstr a`, `curl URL > t.html && findstr b t.html`). Số trong đường dẫn gom lại, bỏ query. Không phải thăm dò thì undefined.
 */
export function probeKey(command: string): string | undefined {
  if (!/\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i.test(command)) return undefined;
  const m = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?([^\s"'<>|&;?\\]*)/i.exec(command);
  if (!m) return undefined;
  const path = m[1] || "/";
  return m[0].slice(0, m[0].length - m[1].length) + path.replace(/\d+/g, "#");
}
