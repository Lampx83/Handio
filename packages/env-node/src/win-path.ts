// Windows: PATH của tiến trình ứng dụng là PATH lúc ứng dụng KHỞI ĐỘNG. Cài Python/Node khi ứng dụng đang mở (hoặc cài mà quên tick "Add to PATH")
// thì lệnh `python` vẫn ra "Python was not found" (bí danh Microsoft Store). Hàm thuần (chạy được ở mọi hệ điều hành) để kiểm thử:
//   - parseRegPath: đọc đầu ra `reg query … /v Path`;
//   - expandVars: mở rộng %BIẾN%;
//   - findPythonDirs: tìm thư mục cài Python thường gặp (kèm Scripts);
//   - mergeWindowsPath: ghép PATH (thư mục Python đứng ĐẦU để thắng bí danh WindowsApps).

export function parseRegPath(output: string): string {
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(output);
  return m ? m[1].trim() : "";
}

export function expandVars(s: string, env: Record<string, string | undefined>): string {
  const up = new Map(Object.entries(env).map(([k, v]) => [k.toUpperCase(), v ?? ""]));
  return s.replace(/%([^%]+)%/g, (_m, k: string) => up.get(k.toUpperCase()) ?? `%${k}%`);
}

const PY_DIR = /^python(\d)(\d+)?$/i;
/** Anaconda/Miniconda/Miniforge: python.exe nằm ngay ở gốc thư mục cài (C:\\Users\\<tên>\\Anaconda3). */
const CONDA_DIR = /^(?:ana|mini)conda\d*$|^(?:mini|mamba)forge\d*$/i;

/**
 * Thư mục cài Python (gốc + Scripts, và Library\\bin với conda), bản python.org mới nhất trước rồi tới conda.
 * `list(dir)` trả tên mục con; `has(file)` kiểm tra tệp tồn tại.
 */
export function findPythonDirs(roots: string[], list: (dir: string) => string[], has: (file: string) => boolean, sep = "\\"): string[] {
  const found: { dirs: string[]; ver: number; dir: string }[] = [];
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = list(root);
    } catch {
      continue;
    }
    for (const n of names) {
      const base = root.replace(/[\\/]+$/, "") + sep + n;
      const py = PY_DIR.exec(n);
      if (py && has(base + sep + "python.exe")) found.push({ dir: base, dirs: [base, base + sep + "Scripts"], ver: 100000 + Number(py[1]) * 1000 + Number(py[2] ?? 0) });
      else if (CONDA_DIR.test(n) && has(base + sep + "python.exe")) found.push({ dir: base, dirs: [base, base + sep + "Scripts", base + sep + "Library" + sep + "bin"], ver: 0 });
    }
  }
  found.sort((a, b) => b.ver - a.ver || a.dir.localeCompare(b.dir));
  return found.flatMap((f) => f.dirs);
}

/** Thư mục Python đứng đầu, rồi PATH hiện có của tiến trình, rồi PATH trong registry (người dùng + máy) chưa có; bỏ trùng (không phân biệt hoa/thường). */
export function mergeWindowsPath(parts: { pythonDirs: string[]; processPath: string; registryPaths: string[] }): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [parts.pythonDirs, parts.processPath.split(";"), ...parts.registryPaths.map((p) => p.split(";"))]) {
    for (const raw of list) {
      const d = raw.trim();
      const k = d.toLowerCase().replace(/[\\/]+$/, "");
      if (!d || seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
  }
  return out.join(";");
}
