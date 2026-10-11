import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Bước "Cài đặt và khởi động lại" của bộ cập nhật: chỉ chạy khi NGƯỜI DÙNG bấm nút, trên tệp đã tải và đã kiểm tra mã băm.
 * - Windows: chạy trình cài NSIS ở chế độ im lặng (/S) cho người dùng hiện tại; nó tự mở lại ứng dụng (--force-run).
 * - macOS: một đoạn shell nhỏ (chạy sau khi ứng dụng thoát) gắn .dmg, thay .app đang cài rồi mở lại; không được thì mở .dmg để kéo-thả.
 */

export type SpawnFn = (cmd: string, args: string[], opts: { detached: boolean; stdio: "ignore" }) => Pick<ChildProcess, "unref" | "on">;

export const MAC_SCRIPT = `#!/bin/bash
# $1 = pid của ứng dụng đang chạy, $2 = tệp .dmg đã tải (đã kiểm mã băm), $3 = ứng dụng .app đang cài, $4 = 1 nếu mở lại sau khi cài
PID="$1"; DMG="$2"; APP="$3"; RELAUNCH="$4"
LOG="\${TMPDIR:-/tmp}/neu-update.log"
exec >>"$LOG" 2>&1
echo "== $(date) cập nhật $APP từ $DMG"
for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done
MNT="$(mktemp -d /tmp/neu-upd.XXXXXX)"
fail() { echo "LỖI: $1"; hdiutil detach "$MNT" -quiet 2>/dev/null; open "$DMG"; exit 1; }
hdiutil attach "$DMG" -nobrowse -readonly -noverify -mountpoint "$MNT" -quiet || fail "không mở được dmg"
SRC="$(ls -d "$MNT"/*.app 2>/dev/null | head -1)"
[ -n "$SRC" ] || fail "không thấy .app trong dmg"
NEW="$APP.update-new"; OLD="$APP.update-old"
rm -rf "$NEW" "$OLD"
ditto "$SRC" "$NEW" || { rm -rf "$NEW"; fail "không chép được"; }
if mv "$APP" "$OLD" && mv "$NEW" "$APP"; then rm -rf "$OLD"; else [ -d "$OLD" ] && [ ! -d "$APP" ] && mv "$OLD" "$APP"; rm -rf "$NEW"; fail "không thay được ứng dụng"; fi
hdiutil detach "$MNT" -quiet
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
[ "$RELAUNCH" = "1" ] && open "$APP"
echo "xong"
`;

/** "/X.app/Contents/MacOS/Y" → "/X.app"; null nếu không chạy từ một gói .app thật. */
export function macBundleOf(execPath: string): string | null {
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return m ? m[1] : null;
}

/** Có thể tự cài trên máy này không (đúng loại tệp, ứng dụng nằm ở nơi ghi được, không phải bản chạy tạm từ ổ đĩa ảnh). */
export function canInstallHere(platform: string, fileName: string, execPath: string, writable: (dir: string) => boolean): boolean {
  if (platform === "win32") return /\.exe$/i.test(fileName);
  if (platform === "darwin") {
    const bundle = macBundleOf(execPath);
    return !!bundle && /\.dmg$/i.test(fileName) && !bundle.includes("/AppTranslocation/") && !bundle.startsWith("/Volumes/") && writable(path.dirname(bundle));
  }
  return false;
}

export interface LaunchOpts {
  platform: string;
  file: string;
  execPath: string;
  pid: number;
  tmpDir: string;
  /** Mở lại ứng dụng sau khi cài (false khi cài lúc người dùng đóng ứng dụng). */
  relaunch?: boolean;
  spawn?: SpawnFn;
}

/** Chạy trình cài; true = đã khởi chạy (người gọi sẽ thoát ứng dụng). Không bao giờ ném lỗi. */
export function launchInstaller(o: LaunchOpts): boolean {
  const spawn: SpawnFn = o.spawn ?? ((c, a, op) => nodeSpawn(c, a, op));
  try {
    if (!path.isAbsolute(o.file) || !fs.existsSync(o.file)) return false;
    if (o.platform === "win32") {
      if (!/\.exe$/i.test(o.file)) return false;
      const child = spawn(o.file, ["/S", "--updated", ...(o.relaunch === false ? [] : ["--force-run"])], { detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
      return true;
    }
    if (o.platform === "darwin") {
      const bundle = macBundleOf(o.execPath);
      if (!bundle || !/\.dmg$/i.test(o.file)) return false;
      const script = path.join(o.tmpDir, `neu-update-${o.pid}.sh`);
      fs.writeFileSync(script, MAC_SCRIPT, { mode: 0o700 });
      const child = spawn("/bin/bash", [script, String(o.pid), o.file, bundle, o.relaunch === false ? "0" : "1"], { detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
      return true;
    }
  } catch {
    /* rơi về cách cũ: mở thư mục chứa tệp */
  }
  return false;
}
