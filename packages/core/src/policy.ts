import { MODES, type Mode } from "./permissions";

/**
 * Chính sách quản trị (tệp do quản trị viên đặt ở nơi người dùng thường KHÔNG sửa được, vd /Library/Application Support/NEU Agent/policy.json).
 * Mọi trường đều tuỳ chọn; có mặt nghĩa là KHOÁ giá trị đó, người dùng không đổi được trong Cài đặt.
 */
export interface Policy {
  /** Khoá địa chỉ API (https). */
  baseUrl?: string;
  /** false = cấm hẳn HTTP không mã hoá (kể cả khi người dùng tự bật). */
  allowInsecureHttp?: boolean;
  /** false = bỏ chế độ "Toàn quyền". */
  allowBypass?: boolean;
  /** false = lệnh do agent chạy không được ra mạng (chỉ hiệu lực khi có sandbox hệ điều hành). */
  bashNetwork?: boolean;
  /** true = tab Code không có công cụ chạy lệnh. */
  disableBash?: boolean;
  /** Lời nhắn hiển thị cho người dùng (vd liên hệ hỗ trợ). */
  notice?: string;
  /** false = tắt hẳn chẩn đoán/báo lỗi ẩn danh (người dùng không bật lại được). Xem docs/DIAGNOSTICS.md. */
  diagnostics?: boolean;
}

/** Làm sạch tệp chính sách đọc từ đĩa: chỉ giữ các trường biết, đúng kiểu. */
export function parsePolicy(raw: unknown): Policy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p: Policy = {};
  if (typeof r.baseUrl === "string" && r.baseUrl.length < 500 && /^https?:\/\//.test(r.baseUrl)) p.baseUrl = r.baseUrl.replace(/\/+$/, "");
  if (typeof r.allowInsecureHttp === "boolean") p.allowInsecureHttp = r.allowInsecureHttp;
  if (typeof r.allowBypass === "boolean") p.allowBypass = r.allowBypass;
  if (typeof r.bashNetwork === "boolean") p.bashNetwork = r.bashNetwork;
  if (typeof r.disableBash === "boolean") p.disableBash = r.disableBash;
  if (typeof r.notice === "string") p.notice = r.notice.slice(0, 500);
  if (typeof r.diagnostics === "boolean") p.diagnostics = r.diagnostics;
  return p;
}

export const allowedModes = (modes: readonly Mode[], p: Policy | undefined): Mode[] => modes.filter((m) => m !== "bypass" || p?.allowBypass !== false).filter((m) => (MODES as readonly string[]).includes(m));
