// Bộ chấm: mỗi hàm ghi một kiểm tra đạt/không vào kết quả. Chỉ nhìn kết quả cuối (tệp, máy chủ đang chạy, trang, lời cuối), không nhìn đường đi.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { office } from "@neu/agent-core";
import { runProbe, type ProbeStep } from "../code-bench/shared.mjs";
import type { CheckResult } from "./stats";

/** Những gì một bài cần biết về lần chạy: thư mục dự án, các cổng, lời cuối, số lỗi công cụ. */
export interface GradeCtx {
  dir: string;
  ports: Record<string, number>;
  final: string;
  /** Lỗi công cụ theo "công cụ:loại". */
  errKinds: Record<string, number>;
  /** Tệp của đề bài (để kiểm tra tệp không bị sửa). */
  seeded: Record<string, string>;
  root: string;
  tmpDir: string;
}

const LIVE_TRIES = 20;
const nfc = (s: string) => s.normalize("NFC");
const short = (s: string, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);

export class Grader {
  readonly results: CheckResult[] = [];
  constructor(readonly ctx: GradeCtx) {}

  add(name: string, ok: boolean, detail = ""): boolean {
    this.results.push({ name, ok, ...(ok || !detail ? {} : { detail: short(detail, 400) }) });
    return ok;
  }
  get ok(): boolean {
    return this.results.every((r) => r.ok);
  }
  private abs(p: string): string {
    return path.join(this.ctx.dir, p);
  }
  private bytes(p: string): Uint8Array | null {
    try {
      return new Uint8Array(fs.readFileSync(this.abs(p)));
    } catch {
      return null;
    }
  }
  /** Tệp có đủ các đoạn chữ (so theo NFC). */
  file(p: string, includes: string[] = []): boolean {
    const b = this.bytes(p);
    if (!b) return this.add(`có tệp ${p}`, false, "không có tệp");
    const t = nfc(new TextDecoder().decode(b));
    const miss = includes.filter((s) => !t.includes(nfc(s)));
    return this.add(includes.length ? `${p} có đủ nội dung` : `có tệp ${p}`, !miss.length, `thiếu: ${miss.join(" | ")}`);
  }
  /** Tệp của đề bài không bị sửa. */
  unchanged(p: string): boolean {
    const b = this.bytes(p);
    return this.add(`${p} giữ nguyên`, !!b && new TextDecoder().decode(b) === this.ctx.seeded[p], b ? "đã bị sửa" : "không còn tệp");
  }
  /** Mọi dòng của tệp vẫn xuống dòng kiểu Windows. */
  crlf(p: string): boolean {
    const b = this.bytes(p);
    const t = b ? new TextDecoder().decode(b) : "";
    const bare = t.replace(/\r\n/g, "").includes("\n");
    return this.add(`${p} vẫn xuống dòng CRLF`, !!t && t.includes("\r\n") && !bare, b ? "có dòng chỉ có LF" : "không có tệp");
  }
  /** Lệnh thoát mã 0 trong thư mục dự án. */
  async cmd(run: string, label = run): Promise<boolean> {
    const r = await sh(run, this.ctx.dir);
    return this.add(label, r.code === 0, r.out.split("\n").filter(Boolean).slice(-6).join(" ⏎ "));
  }
  /** Máy chủ đang chạy ở cổng `port` trả 200 với các đoạn chữ này. Chờ vài giây vì máy chủ có thể vừa được bật. */
  async http(port: string, urlPath: string, includes: string[], label: string): Promise<boolean> {
    const p = this.ctx.ports[port];
    let last = "";
    for (let i = 0; i < LIVE_TRIES; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${p}${urlPath}`, { signal: AbortSignal.timeout(5000) });
        const t = nfc(await r.text());
        const miss = includes.filter((s) => !t.includes(nfc(s)));
        return this.add(label, r.ok && !miss.length, `HTTP ${r.status}; thiếu: ${miss.join(" | ")}`);
      } catch (e) {
        last = (e as Error).message;
        await new Promise((d) => setTimeout(d, 500));
      }
    }
    return this.add(label, false, `không kết nối được cổng ${port}: ${last}`);
  }
  /** Mở trang trong trình duyệt ẩn (tệp trong dự án hoặc cổng đang chạy), đi hết các bước; không được có lỗi console, không trắng. */
  async page(target: { file: string } | { port: string; path?: string }, steps: ProbeStep[] = []): Promise<boolean> {
    const url = "file" in target ? pathToFileURL(this.abs(target.file)).href : `http://127.0.0.1:${this.ctx.ports[target.port]}${target.path ?? "/"}`;
    if ("file" in target && !fs.existsSync(this.abs(target.file))) return this.add(`có tệp ${target.file}`, false, "không có tệp");
    const r = await runProbe({ url, steps, root: this.ctx.dir }, { root: this.ctx.root, tmpDir: this.ctx.tmpDir });
    if (r.error) return this.add("mở được trang", false, r.error);
    const before = this.ok;
    this.add("trang tải được, không lỗi console", !!r.loaded && !r.errors?.length && !r.overlay, [...(r.errors ?? []).slice(0, 3), r.overlay ?? ""].join(" | "));
    this.add("trang không trắng", !r.blank);
    for (const st of r.steps ?? []) this.add(st.label, st.ok, st.note ?? "");
    return before && this.ok;
  }
  private async officeText(p: string, ext: string): Promise<{ label: string; text: string }[] | null> {
    const b = this.bytes(p);
    if (!b) return this.add(`có tệp ${p}`, false, "không có tệp"), null;
    try {
      return (await office.readDocumentSections(b, ext)).sections;
    } catch (e) {
      return this.add(`mở được ${p}`, false, (e as Error).message), null;
    }
  }
  /** Bài trình chiếu: số slide, có/không có chữ, các tiêu đề đúng thứ tự, slide cuối. */
  async pptx(p: string, o: { slides?: number; includes?: string[]; excludes?: string[]; titlesInOrder?: string[]; lastIncludes?: string }): Promise<boolean> {
    const s = await this.officeText(p, ".pptx");
    if (!s) return false;
    const before = this.ok;
    const all = nfc(s.map((x) => `${x.label}\n${x.text}`).join("\n"));
    if (o.slides !== undefined) this.add(`${p} có đúng ${o.slides} slide`, s.length === o.slides, `có ${s.length} slide`);
    for (const t of o.includes ?? []) this.add(`${p} có “${t}”`, all.includes(nfc(t)));
    for (const t of o.excludes ?? []) this.add(`${p} không còn “${t}”`, !all.includes(nfc(t)));
    if (o.titlesInOrder) {
      let at = 0;
      const miss: string[] = [];
      for (const t of o.titlesInOrder) {
        const i = all.indexOf(nfc(t), at);
        if (i < 0) miss.push(t);
        else at = i + t.length;
      }
      this.add(`${p} có đủ tiêu đề đúng thứ tự`, !miss.length, `thiếu hoặc sai thứ tự: ${miss.join(" | ")}`);
    }
    if (o.lastIncludes) this.add(`slide cuối có “${o.lastIncludes}”`, nfc(`${s.at(-1)?.label}\n${s.at(-1)?.text}`).includes(nfc(o.lastIncludes)));
    return before && this.ok;
  }
  /** Văn bản Word: có chữ, đủ số từ, có bảng. */
  async docx(p: string, o: { includes?: string[]; minWords?: number; minTables?: number }): Promise<boolean> {
    const s = await this.officeText(p, ".docx");
    if (!s) return false;
    const before = this.ok;
    const t = nfc(s.map((x) => x.text).join("\n"));
    for (const x of o.includes ?? []) this.add(`${p} có “${x}”`, t.includes(nfc(x)));
    if (o.minWords) {
      const n = t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
      this.add(`${p} từ ${o.minWords} từ trở lên`, n >= o.minWords, `có ${n} từ`);
    }
    if (o.minTables) {
      const n = t.split(/\n\s*\n/).filter((b) => /^\s*\|.*\|\s*$/m.test(b)).length;
      this.add(`${p} có bảng`, n >= o.minTables, `có ${n} bảng`);
    }
    return before && this.ok;
  }
  /** Bảng tính Excel qua exceljs: trả về trang tính đầu tiên. */
  async xlsxSheet(p: string): Promise<ExcelJS.Worksheet | null> {
    const b = this.bytes(p);
    if (!b) return this.add(`có tệp ${p}`, false, "không có tệp"), null;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(b) as never);
    } catch (e) {
      return this.add(`mở được ${p}`, false, (e as Error).message), null;
    }
    return wb.worksheets[0] ?? (this.add(`${p} có trang tính`, false), null);
  }
  /** CSV thành bảng khoá → giá trị theo tên hai cột; bỏ BOM và dấu ngoặc kép. */
  csvMap(p: string, key: string, value: string): Map<string, number> | null {
    const b = this.bytes(p);
    if (!b) return this.add(`có tệp ${p}`, false, "không có tệp"), null;
    const lines = nfc(new TextDecoder().decode(b)).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    const cells = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const head = cells(lines[0] ?? "");
    const ki = head.indexOf(key), vi = head.indexOf(value);
    if (ki < 0 || vi < 0) return this.add(`${p} có cột ${key}, ${value}`, false, `tiêu đề: ${head.join(", ")}`), null;
    return new Map(lines.slice(1).map((l) => [cells(l)[ki], Number(cells(l)[vi])]));
  }
  /** Lời cuối: có một mẫu trong `any`, không có mẫu nào trong `none`. */
  final(o: { any?: RegExp[]; none?: RegExp[]; label?: string }): boolean {
    const t = nfc(this.ctx.final);
    const okAny = !o.any || o.any.some((r) => r.test(t));
    const hit = (o.none ?? []).find((r) => r.test(t));
    return this.add(o.label ?? "lời cuối đúng", !!t.trim() && okAny && !hit, t.trim() ? `lời cuối: ${short(t)}` : "không có lời cuối");
  }
  /** Agent không lặp lỗi: tổng số lỗi của một công cụ không quá `max`. */
  maxErrors(tool: string, max: number): boolean {
    const n = Object.entries(this.ctx.errKinds).filter(([k]) => k.startsWith(tool + ":")).reduce((a, [, v]) => a + v, 0);
    return this.add(`${tool} lỗi không quá ${max} lần`, n <= max, `lỗi ${n} lần`);
  }
}

export function sh(cmd: string, cwd: string, ms = 120_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("bash", ["-lc", cmd], { cwd, env: { ...process.env, CI: "1" }, detached: true });
    let out = "";
    const add = (d: Buffer) => {
      out = (out + d).slice(-12_000);
    };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    const t = setTimeout(() => {
      try {
        process.kill(-p.pid!, "SIGKILL");
      } catch {
        /* đã thoát */
      }
      out += "\n[quá hạn]";
    }, ms);
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out });
    });
  });
}
