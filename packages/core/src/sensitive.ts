import { basename } from "./path";

const NAME_RX: RegExp[] = [
  /^\.env(\..+)?$/i, /\.(pem|key|p12|pfx|jks|keystore|kdbx|ovpn|ppk|asc|gpg|crt)$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.(npmrc|pypirc|netrc|git-credentials|htpasswd|pgpass|my\.cnf)$/i, /^(credentials|secrets?|token|tokens|apikey|api[-_]?keys?)(\.\w+)?$/i,
  /^(service[-_]?account|client[-_]?secret).*\.json$/i, /^\.?(aws|ssh|gnupg|kube|docker)$/i,
];
const DIR_RX = /(^|\/)\.(aws|ssh|gnupg|kube|docker)(\/|$)/i;
const SAFE_SUFFIX = /\.(example|sample|template|dist|tpl)$/i;

/** Tệp có thể chứa bí mật (khoá, mật khẩu, token): agent chỉ đọc/ghi khi người dùng duyệt, và tìm kiếm hàng loạt bỏ qua. */
export function isSensitivePath(p: string): boolean {
  const norm = p.replace(/\\/g, "/");
  if (DIR_RX.test(norm)) return true;
  const name = basename(norm);
  if (SAFE_SUFFIX.test(name)) return false;
  return NAME_RX.some((r) => r.test(name));
}
