/** Đọc tham số công cụ do mô hình sinh. JSON đúng thì giữ nguyên; lỗi vặt hay gặp thì sửa một lần rồi đọc lại thay vì bắt mô hình gọi lại
 * (gọi lại một lời gọi dài tốn cả lượt và hay lặp lại đúng lỗi đó). JSON bị CẮT giữa chừng thì KHÔNG sửa: thiếu nội dung thật, cần chia nhỏ. */

export interface ParsedArgs {
  value: Record<string, unknown>;
  /** true = JSON gốc hỏng và đã được sửa. */
  repaired: boolean;
}

const asObject = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("tham số phải là object");
  return v as Record<string, unknown>;
};

/** Sửa các lỗi vặt: khối mã ```, chữ thừa trước/sau object, xuống dòng/tab thật trong chuỗi, thoát sai `\'`, dấu phẩy thừa. Không đoán gì thêm. */
function repair(raw: string): string {
  let s = raw.trim().replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) return s;
  s = s.slice(a, b + 1);
  let out = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") {
        const n = s[i + 1];
        if (n === "'") out += "'";
        else out += c + (n ?? "");
        i++;
      } else if (c === '"') {
        inStr = false;
        out += c;
      } else if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else out += c;
    } else {
      if (c === '"') inStr = true;
      // dấu phẩy thừa: , rồi (khoảng trắng) } hoặc ]
      if (c === ",") {
        const m = /^,\s*([}\]])/.exec(s.slice(i));
        if (m) continue;
      }
      out += c;
    }
  }
  return out;
}

/** Ném lỗi (có thông điệp tiếng Việt) nếu không đọc được thành object. */
export function parseToolArgs(raw: string): ParsedArgs {
  if (!raw.trim()) return { value: {}, repaired: false };
  try {
    return { value: asObject(JSON.parse(raw)), repaired: false };
  } catch (first) {
    if ((first as Error).message === "tham số phải là object") throw first;
    let fixed: string;
    try {
      fixed = repair(raw);
      return { value: asObject(JSON.parse(fixed)), repaired: true };
    } catch (second) {
      // báo lỗi của bản GỐC (đúng vị trí mô hình đã viết sai)
      throw (second as Error).message === "tham số phải là object" ? second : first;
    }
  }
}
