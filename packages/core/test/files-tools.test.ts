import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MemoryEnv, Permissions, ToolError, builtinTools, office, type ToolContext } from "../src";
import { makeController } from "./helpers";

const enc = new TextEncoder();
const bin = (n: number, seed = 7): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed + (i >> 3)) & 255);

const mk = (seed: Record<string, string> = {}) => {
  const env = new MemoryEnv("/ws", seed);
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [], turn: 1 };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  return { env, ctx, tools, run: (n: string, a: unknown) => tools.get(n)!.run(ctx, a) };
};

const bytesOf = async (env: MemoryEnv, p: string) => Array.from(await env.readBytes(p));
const rejects = async (p: Promise<unknown>, re: RegExp, kind?: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, "phải bị từ chối").toBeInstanceOf(ToolError);
  expect((e as ToolError).message).toMatch(re);
  if (kind) expect((e as ToolError).kind).toBe(kind);
};

describe("công cụ quản lý tệp: có đủ và đi qua hệ thống quyền", () => {
  it("bảy công cụ, loại đúng; chỉ file_info là chỉ-đọc", () => {
    const { tools } = mk();
    for (const n of ["copy_file", "move_file", "delete_file", "make_dir", "zip_files", "unzip_file", "file_info"]) expect(tools.has(n), n).toBe(true);
    expect([...tools.values()].filter((t) => ["copy_file", "move_file", "delete_file", "make_dir", "zip_files", "unzip_file"].includes(t.name)).every((t) => t.kind === "edit" && !t.readonly)).toBe(true);
    expect(tools.get("file_info")).toMatchObject({ kind: "read", readonly: true });
  });

  it("quyền: đích là .env/AGENTS.md thì hỏi, đích thường ở chế độ auto thì tự cho; chế độ plan chặn", () => {
    const { tools, ctx } = mk();
    const perms = new Permissions({ allow: [], deny: [] }, "auto", "/ws");
    const decide = (name: string, args: Record<string, unknown>) => {
      const t = tools.get(name)!;
      const raw = t.targetPath ? t.targetPath(args) : t.pathArg ? args[t.pathArg] : undefined;
      return perms.decide(t, args, { rel: String(raw), abs: "/ws/" + String(raw) }).decision;
    };
    void ctx;
    expect(decide("copy_file", { from: "a.txt", to: "b.txt" })).toBe("allow");
    expect(decide("copy_file", { from: ".env.example", to: ".env" })).toBe("ask");
    expect(decide("move_file", { from: "x.md", to: "AGENTS.md" })).toBe("ask");
    expect(decide("delete_file", { path: "a.txt" })).toBe("allow");
    expect(decide("delete_file", { path: ".git/config" })).toBe("ask");
    expect(decide("unzip_file", { path: "a.zip" })).toBe("allow"); // thư mục đích mặc định a
    expect(decide("unzip_file", { path: "a.zip", output_dir: ".git/hooks" })).toBe("ask");
    perms.setMode("plan");
    expect(decide("make_dir", { path: "x" })).toBe("deny");
    expect(decide("file_info", { path: "x" })).toBe("allow");
  });
});

describe("copy_file / move_file / delete_file / make_dir", () => {
  it("sao chép tệp văn bản và nhị phân: nội dung y hệt, bản gốc còn nguyên", async () => {
    const { env, run } = mk({ "a.txt": "Xin chào\n" });
    await env.writeBytes("/ws/img.png", bin(4096));
    const r = await run("copy_file", { from: "a.txt", to: "sao/a-copy.txt" });
    expect(r).toContain("sao/a-copy.txt");
    await run("copy_file", { from: "img.png", to: "sao/img.png" });
    expect(await bytesOf(env, "/ws/sao/a-copy.txt")).toEqual(Array.from(enc.encode("Xin chào\n")));
    expect(await bytesOf(env, "/ws/sao/img.png")).toEqual(Array.from(bin(4096)));
    expect(await env.stat("/ws/a.txt")).not.toBeNull();
    expect(await env.stat("/ws/img.png")).not.toBeNull();
  });

  it("đích là thư mục có sẵn (hoặc kết thúc bằng /): đặt vào trong với tên cũ", async () => {
    const { env, run } = mk({ "a.txt": "A", "dir/.keep": "" });
    expect(await run("copy_file", { from: "a.txt", to: "dir" })).toContain("dir/a.txt");
    expect(await run("move_file", { from: "dir/a.txt", to: "moi/" })).toContain("moi/a.txt");
    expect((await env.stat("/ws/moi/a.txt"))?.isFile).toBe(true);
    expect(await env.stat("/ws/dir/a.txt")).toBeNull();
  });

  it("sao chép cả thư mục: giữ cấu trúc; bỏ qua tệp nhạy cảm/cấu hình bên trong và báo", async () => {
    const { env, run } = mk({ "p/a.txt": "1", "p/sub/b.txt": "2", "p/.env": "SECRET=1", "p/AGENTS.md": "x", "p/.git/config": "y", "p/khoa.pem": "k" });
    await env.mkdirp("/ws/p/rong");
    const r = await run("copy_file", { from: "p", to: "q" });
    expect(r).toContain("2 tệp");
    expect(r).toMatch(/Bỏ qua 4 mục/);
    expect(Object.keys(env.snapshot()).filter((k) => k.startsWith("/ws/q/")).sort()).toEqual(["/ws/q/a.txt", "/ws/q/sub/b.txt"]);
    expect((await env.stat("/ws/q/rong"))?.isDir).toBe(true);
  });

  it("từ chối ghi đè: đích có sẵn, ghi đè khi chưa xem, đã đổi sau khi xem; ghi đè hợp lệ hoàn tác được", async () => {
    const { env, ctx, run } = mk({ "a.txt": "MỚI", "b.txt": "CŨ" });
    await rejects(run("copy_file", { from: "a.txt", to: "b.txt" }), /đã tồn tại/);
    await rejects(run("copy_file", { from: "a.txt", to: "b.txt", overwrite: true }), /chưa xem/, "read_first");
    await run("file_info", { path: "b.txt" });
    await env.writeText("/ws/b.txt", "NGƯỜI DÙNG SỬA"); // đổi sau khi xem
    await rejects(run("copy_file", { from: "a.txt", to: "b.txt", overwrite: true }), /đã thay đổi/, "stale");
    await run("file_info", { path: "b.txt" });
    expect(await run("copy_file", { from: "a.txt", to: "b.txt", overwrite: true })).toContain("ghi đè");
    expect(await env.readBytes("/ws/b.txt").then((b) => new TextDecoder().decode(b))).toBe("MỚI");
    const last = ctx.undoStack.at(-1)!;
    expect(last.path).toBe("/ws/b.txt");
    expect(new TextDecoder().decode(last.old as Uint8Array)).toBe("NGƯỜI DÙNG SỬA");
  });

  it("đọc bằng read_document cũng đủ điều kiện ghi đè; file_info không làm write_file bỏ qua việc đọc", async () => {
    const { env, run } = mk({ "a.txt": "A", "b.txt": "B", "c.txt": "C" });
    await run("read_document", { path: "b.txt" });
    await run("copy_file", { from: "a.txt", to: "b.txt", overwrite: true });
    // chỉ xem thông tin (file_info) KHÔNG được coi là đã đọc nội dung với write_file
    await run("file_info", { path: "c.txt" });
    await expect(run("write_file", { path: "c.txt", content: "ghi mù" })).rejects.toThrow(/đọc/);
    expect(await env.readBytes("/ws/c.txt").then((b) => new TextDecoder().decode(b))).toBe("C");
  });

  it("thư mục vào thư mục có sẵn thì thành thư mục con; trùng tên con thì từ chối", async () => {
    const { env, run } = mk({ "d/x.txt": "1", "e/y.txt": "2" });
    expect(await run("copy_file", { from: "d", to: "e" })).toContain("e/d");
    expect(await env.stat("/ws/e/d/x.txt")).not.toBeNull();
    await rejects(run("copy_file", { from: "d", to: "e" }), /đã có/);
    await rejects(run("move_file", { from: "d", to: "d/con" }), /chính nó/, "bad_args");
    await rejects(run("move_file", { from: "d/x.txt", to: "d/x.txt" }), /trùng nhau/, "bad_args");
  });

  it("đổi tên và di chuyển tệp; nguồn mất, đích có nội dung", async () => {
    const { env, run } = mk({ "bao-cao.docx": "NỘI DUNG" });
    const r = await run("move_file", { from: "bao-cao.docx", to: "luu-tru/bao-cao-2024.docx" });
    expect(r).toContain("luu-tru/bao-cao-2024.docx");
    expect(await env.stat("/ws/bao-cao.docx")).toBeNull();
    expect(await env.readBytes("/ws/luu-tru/bao-cao-2024.docx").then((b) => new TextDecoder().decode(b))).toBe("NỘI DUNG");
  });

  it("di chuyển cả thư mục: mọi tệp sang đích, thư mục nguồn biến mất", async () => {
    const { env, run } = mk({ "cu/a.txt": "1", "cu/s/b.txt": "2" });
    await env.mkdirp("/ws/cu/trong");
    await run("move_file", { from: "cu", to: "moi" });
    expect(await env.stat("/ws/cu")).toBeNull();
    expect(Object.keys(env.snapshot()).sort()).toEqual(["/ws/moi/a.txt", "/ws/moi/s/b.txt"]);
    expect((await env.stat("/ws/moi/trong"))?.isDir).toBe(true);
  });

  it("di chuyển thư mục có tệp nhạy cảm bên trong: từ chối nguyên thư mục, không đụng gì", async () => {
    const { env, run } = mk({ "cfg/a.txt": "1", "cfg/.env": "S=1" });
    await rejects(run("move_file", { from: "cfg", to: "cfg2" }), /nhạy cảm/);
    expect(Object.keys(env.snapshot()).sort()).toEqual(["/ws/cfg/.env", "/ws/cfg/a.txt"]);
  });

  it("xoá tệp: biến mất và hoàn tác được; thư mục có nội dung bị từ chối; thư mục rỗng xoá được", async () => {
    const { env, ctx, run } = mk({ "a.txt": "NỘI DUNG", "d/x.txt": "1" });
    await env.mkdirp("/ws/rong");
    expect(await run("delete_file", { path: "a.txt" })).toContain("Hoàn tác");
    expect(await env.stat("/ws/a.txt")).toBeNull();
    expect(ctx.undoStack.at(-1)).toMatchObject({ path: "/ws/a.txt" });
    expect(new TextDecoder().decode(ctx.undoStack.at(-1)!.old as Uint8Array)).toBe("NỘI DUNG");
    await rejects(run("delete_file", { path: "d" }), /không rỗng/);
    expect(await env.stat("/ws/d/x.txt")).not.toBeNull();
    await run("delete_file", { path: "rong" });
    expect(await env.stat("/ws/rong")).toBeNull();
    await rejects(run("delete_file", { path: "." }), /gốc/);
    await rejects(run("delete_file", { path: "khong-co.txt" }), /Không có/, "not_found");
  });

  it("tạo thư mục lồng nhau; đã có thì không lỗi; trùng tên tệp thì báo", async () => {
    const { env, run } = mk({ "t.txt": "x" });
    expect(await run("make_dir", { path: "a/b/c" })).toContain("a/b/c");
    expect((await env.stat("/ws/a/b/c"))?.isDir).toBe(true);
    expect(await run("make_dir", { path: "a/b" })).toContain("đã có");
    await rejects(run("make_dir", { path: "t.txt" }), /đã là một tệp/, "wrong_type");
  });
});

describe("ranh giới dự án và tệp nhạy cảm", () => {
  it("mọi đường dẫn ra ngoài dự án đều bị từ chối (nguồn, đích, .., tuyệt đối)", async () => {
    const { env, run } = mk({ "a.txt": "A" });
    await env.writeText("/other.txt", "ngoài");
    await rejects(run("copy_file", { from: "../other.txt", to: "x.txt" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("copy_file", { from: "/other.txt", to: "x.txt" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("copy_file", { from: "a.txt", to: "../thoat.txt" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("move_file", { from: "a.txt", to: "/etc/a.txt" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("delete_file", { path: "../other.txt" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("make_dir", { path: "../moi" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("zip_files", { paths: ["../other.txt"], output: "x.zip" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("zip_files", { paths: ["a.txt"], output: "../x.zip" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("unzip_file", { path: "../x.zip" }), /ngoài thư mục dự án/, "outside_project");
    await rejects(run("file_info", { path: "../other.txt" }), /ngoài thư mục dự án/, "outside_project");
    expect(await env.stat("/other.txt")).not.toBeNull();
    expect(await env.stat("/thoat.txt")).toBeNull();
  });

  it("tệp nhạy cảm/cấu hình: không sao chép, di chuyển, xoá, nén; .env.example thì được", async () => {
    const { env, run } = mk({ ".env": "SECRET=1", "AGENTS.md": "luật", "khoa.pem": "KEY", ".git/config": "x", "ok.txt": "ok", ".env.example": "SECRET=" });
    for (const f of [".env", "AGENTS.md", "khoa.pem", ".git/config", ".git"]) {
      await rejects(run("copy_file", { from: f, to: "bao/x" }), /nhạy cảm hoặc cấu hình/);
      await rejects(run("move_file", { from: f, to: "bao/x" }), /nhạy cảm hoặc cấu hình/);
      await rejects(run("delete_file", { path: f }), /nhạy cảm hoặc cấu hình/);
      await rejects(run("zip_files", { paths: [f], output: "bao.zip" }), /nhạy cảm hoặc cấu hình/);
    }
    expect(Object.keys(env.snapshot()).sort()).toEqual(["/ws/.env", "/ws/.env.example", "/ws/.git/config", "/ws/AGENTS.md", "/ws/khoa.pem", "/ws/ok.txt"]);
    await run("copy_file", { from: ".env.example", to: ".env.local-mau" });
    expect(await env.stat("/ws/.env.local-mau")).not.toBeNull();
  });

  it("đích nằm trong vùng cấu hình qua thư mục có sẵn cũng bị chặn", async () => {
    const { env, run } = mk({ "a.md": "x", ".claude/rules/.keep": "" });
    await rejects(run("copy_file", { from: "a.md", to: ".claude/rules" }), /nhạy cảm hoặc cấu hình/);
    expect(await env.stat("/ws/.claude/rules/a.md")).toBeNull();
  });
});

describe("nén và giải nén", () => {
  const rich = async () => {
    const m = mk({ "bc/thang1.txt": "Tháng một\nSố liệu", "bc/con/thang2.csv": "a,b\n1,2\n" });
    await m.env.writeBytes("/ws/bc/anh.png", bin(70_000));
    await m.env.mkdirp("/ws/bc/rong");
    await m.env.writeText("/ws/le.txt", "tệp lẻ");
    return m;
  };

  it("nén rồi giải nén: nội dung giống hệt từng byte, kể cả nhị phân, thư mục rỗng và tên tiếng Việt", async () => {
    const { env, run } = await rich();
    const z = await run("zip_files", { paths: ["bc", "le.txt"], output: "luu/bc.zip" });
    expect(z).toContain("4 tệp");
    const r = await run("unzip_file", { path: "luu/bc.zip", output_dir: "ra" });
    expect(r).toContain("4 tệp");
    for (const [a, b] of [["bc/thang1.txt", "ra/bc/thang1.txt"], ["bc/con/thang2.csv", "ra/bc/con/thang2.csv"], ["bc/anh.png", "ra/bc/anh.png"], ["le.txt", "ra/le.txt"]])
      expect(await bytesOf(env, "/ws/" + b), b).toEqual(await bytesOf(env, "/ws/" + a));
    expect((await env.stat("/ws/ra/bc/rong"))?.isDir).toBe(true);
  });

  it("thư mục đích mặc định là thư mục cùng tên với tệp zip", async () => {
    const { env, run } = await rich();
    await run("zip_files", { paths: ["le.txt"], output: "gui/bo-tai-lieu.zip" });
    const r = await run("unzip_file", { path: "gui/bo-tai-lieu.zip" });
    expect(r).toContain("gui/bo-tai-lieu/");
    expect(await env.stat("/ws/gui/bo-tai-lieu/le.txt")).not.toBeNull();
  });

  it("paths gửi dạng chuỗi JSON vẫn nhận (mô hình hay gửi vậy)", async () => {
    const { env, run } = await rich();
    await run("zip_files", { paths: JSON.stringify(["le.txt", "bc/thang1.txt"]), output: "j.zip" });
    const zip = await JSZip.loadAsync(await env.readBytes("/ws/j.zip"));
    expect(Object.keys(zip.files).sort()).toEqual(["le.txt", "thang1.txt"]);
  });

  it("nén: bỏ tệp nhạy cảm trong thư mục và báo; không tự đưa chính tệp zip vào; không ghi đè zip có sẵn", async () => {
    const { env, run } = mk({ "d/a.txt": "1", "d/.env": "S=1", "d/AGENTS.md": "x" });
    const r = await run("zip_files", { paths: ["d"], output: "d/d.zip" });
    expect(r).toMatch(/Bỏ qua 2 tệp/);
    const zip = await JSZip.loadAsync(await env.readBytes("/ws/d/d.zip"));
    expect(Object.keys(zip.files).filter((n) => !n.endsWith("/"))).toEqual(["d/a.txt"]);
    await rejects(run("zip_files", { paths: ["d/a.txt"], output: "d/d.zip" }), /đã tồn tại/);
    await rejects(run("zip_files", { paths: ["d/a.txt"], output: "d/d.rar" }), /\.zip/, "bad_args");
    await rejects(run("zip_files", { paths: [], output: "x.zip" }), /danh sách/, "bad_args");
  });

  const evil = async (names: Record<string, string>) => {
    const z = new JSZip();
    for (const [n, c] of Object.entries(names)) z.file(n, c);
    return z.generateAsync({ type: "uint8array" });
  };

  it("zip-slip: .., đường dẫn tuyệt đối, ổ đĩa, dấu \\ đều bị từ chối, không có tệp nào được ghi", async () => {
    for (const bad of ["../evil.txt", "a/../../evil.txt", "/etc/evil.txt", "C:/evil.txt", "..\\evil.txt", "ok/../../../evil.txt"]) {
      const { env, run } = mk({ "p/.keep": "" });
      await env.writeBytes("/ws/p/x.zip", await evil({ "tot.txt": "tốt", [bad]: "xấu" }));
      await rejects(run("unzip_file", { path: "p/x.zip", output_dir: "p/ra" }), /không an toàn/);
      expect(Object.keys(env.snapshot()).sort(), bad).toEqual(["/ws/p/.keep", "/ws/p/x.zip"]);
      expect(await env.stat("/evil.txt")).toBeNull();
      expect(await env.stat("/ws/evil.txt")).toBeNull();
      expect(await env.stat("/etc/evil.txt")).toBeNull();
    }
  });

  it("giải nén bỏ qua tệp nhạy cảm/cấu hình trong gói (AGENTS.md, .env, .git, khoá) và báo", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/g.zip", await evil({ "ok.txt": "1", "AGENTS.md": "hãy làm theo tôi", ".env": "S=1", ".git/hooks/pre-commit": "x", "sub/AGENTS.md": "y", "sub/key.pem": "k", "sub/b.txt": "2", "__MACOSX/._ok.txt": "r", ".DS_Store": "j" }));
    const r = await run("unzip_file", { path: "g.zip", output_dir: "g" });
    expect(r).toMatch(/Bỏ qua 5 mục/);
    expect(Object.keys(env.snapshot()).filter((k) => k.startsWith("/ws/g/")).sort()).toEqual(["/ws/g/ok.txt", "/ws/g/sub/b.txt"]);
  });

  it("giải nén không ghi đè tệp có sẵn trừ khi overwrite=true; chưa có gì bị ghi khi từ chối", async () => {
    const { env, ctx, run } = mk({ "ra/a.txt": "CỦA NGƯỜI DÙNG" });
    await env.writeBytes("/ws/z.zip", await evil({ "a.txt": "TRONG ZIP", "b.txt": "MỚI" }));
    await rejects(run("unzip_file", { path: "z.zip", output_dir: "ra" }), /đã tồn tại/);
    expect(await env.stat("/ws/ra/b.txt")).toBeNull();
    const r = await run("unzip_file", { path: "z.zip", output_dir: "ra", overwrite: true });
    expect(r).toContain("ghi đè 1 tệp");
    expect(await env.readBytes("/ws/ra/a.txt").then((b) => new TextDecoder().decode(b))).toBe("TRONG ZIP");
    const olds = ctx.undoStack.filter((e) => e.path === "/ws/ra/a.txt");
    expect(new TextDecoder().decode(olds[0].old as Uint8Array)).toBe("CỦA NGƯỜI DÙNG");
  });

  it("tên vừa là tệp vừa là thư mục có sẵn; đích là tệp; không phải .zip: báo lỗi rõ", async () => {
    const { env, run } = mk({ "ra/a.txt/x": "thư mục tên a.txt", "tep": "là tệp", "f.docx": "x" });
    await env.writeBytes("/ws/z.zip", await evil({ "a.txt": "1" }));
    await rejects(run("unzip_file", { path: "z.zip", output_dir: "ra", overwrite: true }), /thư mục đã có/);
    await rejects(run("unzip_file", { path: "z.zip", output_dir: "tep" }), /không phải thư mục/);
    await rejects(run("unzip_file", { path: "f.docx" }), /chỉ giải nén được tệp \.zip/, "unsupported");
    await env.writeBytes("/ws/hong.zip", new Uint8Array([1, 2, 3, 4]));
    await rejects(run("unzip_file", { path: "hong.zip" }), /Không mở được/);
  });

  it("zip quá nhiều tệp bị từ chối; khai gian kích thước trong tiêu đề vẫn bị chặn khi giải nén thật", async () => {
    const { env, run } = mk();
    const many = new JSZip();
    for (let i = 0; i < 2001; i++) many.file(`f${i}.txt`, "x");
    await env.writeBytes("/ws/nhieu.zip", await many.generateAsync({ type: "uint8array" }));
    await rejects(run("unzip_file", { path: "nhieu.zip" }), /quá lớn hoặc có quá nhiều tệp/);
    expect(await env.stat("/ws/nhieu")).toBeNull();

    // một tệp 60 MB toàn số 0 (zip chỉ ~60 KB) nhưng tiêu đề khai chỉ 100 byte → loadZip không bắt được, đếm byte thật phải bắt
    const z = new JSZip();
    z.file("bom.bin", new Uint8Array(60 * 1024 * 1024), { compression: "DEFLATE" });
    const data = await z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let patched = 0;
    for (let i = 0; i + 46 < data.length; i++) if (dv.getUint32(i, true) === 0x02014b50) { dv.setUint32(i + 24, 100, true); patched++; }
    expect(patched).toBe(1);
    await env.writeBytes("/ws/bom.zip", data);
    await rejects(run("unzip_file", { path: "bom.zip" }), /quá lớn/);
    expect(await env.stat("/ws/bom")).toBeNull();
  });
});

describe("file_info", () => {
  it("tệp: loại, kích thước; docx/xlsx/pptx có số từ/sheet/slide", async () => {
    const { env, run } = mk({ "ghi-chu.txt": "xin chào" });
    expect(await run("file_info", { path: "ghi-chu.txt" })).toMatch(/Loại: Văn bản[\s\S]*Kích thước: 9 B \(9 byte\)/);
    await run("create_docx", { path: "tl.docx", content: "# Tiêu đề\n\nMột hai ba bốn năm." });
    expect(await run("file_info", { path: "tl.docx" })).toMatch(/Loại: Word[\s\S]*Số từ: ≈?\d+/);
    await run("create_xlsx", { path: "so.xlsx", sheets: [{ name: "Tháng 1", rows: [["a"], [1]] }, { name: "Tháng 2", rows: [["b"]] }] });
    expect(await run("file_info", { path: "so.xlsx" })).toContain("Số sheet: 2 (Tháng 1, Tháng 2)");
    await run("create_pptx", { path: "bc.pptx", content: "# Bìa\n\n---\n\n## Một\n- a\n\n---\n\n## Hai\n- b" });
    expect(await run("file_info", { path: "bc.pptx" })).toContain("Số slide: 3");
    void env;
  });

  it("PDF: đếm trang", async () => {
    const { env, run } = mk();
    const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n";
    await env.writeBytes("/ws/hai-trang.pdf", enc.encode(pdf));
    expect(await run("file_info", { path: "hai-trang.pdf" })).toContain("Số trang: 2");
  });

  it("thư mục: số tệp, dung lượng, thống kê theo đuôi; bỏ node_modules", async () => {
    const { env, run } = mk({ "d/a.docx": "1", "d/b.docx": "22", "d/s/c.xlsx": "333", "d/ghi": "4444", "d/node_modules/x/y.js": "bỏ" });
    const r = await run("file_info", { path: "d" });
    expect(r).toContain("4 tệp, 1 thư mục con");
    expect(r).toContain(".docx: 2 tệp");
    expect(r).toContain(".xlsx: 1 tệp");
    expect(r).toContain("(không đuôi): 1 tệp");
    expect(r).toContain("node_modules");
    expect(r).not.toContain(".js");
    void env;
  });

  it("không có: báo not_found", async () => {
    const { run } = mk({ "bao-cao.docx": "x" });
    await rejects(run("file_info", { path: "bao-cao.doc" }), /Không có/, "not_found");
  });
});

describe("hoàn tác (undo) qua agent thật", () => {
  const work = async (steps: { name: string; args: unknown }[], seed: Record<string, string>) => {
    const r = await makeController([{ calls: steps }, { text: "xong" }], { seed, profile: "work" });
    await r.c.send("làm");
    return r;
  };

  it("một lần /undo hoàn tác cả lần di chuyển thư mục", async () => {
    const { c, env } = await work([{ name: "move_file", args: { from: "cu", to: "moi/cu2" } }], { "cu/a.txt": "1", "cu/s/b.txt": "2" });
    expect(await env.stat("/ws/cu")).toBeNull();
    expect(Object.keys(env.snapshot()).filter((k) => k.startsWith("/ws/moi"))).toHaveLength(2);
    await c.currentSession.undo();
    expect(Object.keys(env.snapshot()).sort()).toEqual(["/ws/cu/a.txt", "/ws/cu/s/b.txt"]);
    expect(await env.stat("/ws/moi")).toBeNull(); // thư mục đích mới tạo cũng được dọn
    expect(await env.readBytes("/ws/cu/s/b.txt").then((b) => new TextDecoder().decode(b))).toBe("2");
  });

  it("/undo hoàn tác di chuyển một tệp (đích mất, nguồn trở lại) và xoá tệp", async () => {
    const { c, env } = await work([{ name: "move_file", args: { from: "a.txt", to: "b.txt" } }, { name: "delete_file", args: { path: "c.txt" } }], { "a.txt": "A", "c.txt": "C" });
    expect(Object.keys(env.snapshot())).toEqual(["/ws/b.txt"]);
    await c.currentSession.undo(); // xoá c.txt
    expect(Object.keys(env.snapshot()).sort()).toEqual(["/ws/b.txt", "/ws/c.txt"]);
    await c.currentSession.undo(); // di chuyển a → b
    expect(Object.keys(env.snapshot()).sort()).toEqual(["/ws/a.txt", "/ws/c.txt"]);
  });

  it("/undo sau giải nén xoá sạch thư mục đã tạo; sau nén xoá tệp zip", async () => {
    const z = new JSZip();
    z.file("x/1.txt", "1");
    z.file("2.txt", "2");
    const { c, env } = await makeController(
      [{ calls: [{ name: "unzip_file", args: { path: "g.zip" } }] }, { text: "xong" }],
      { seed: {}, profile: "work" },
    );
    await env.writeBytes("/ws/g.zip", await z.generateAsync({ type: "uint8array" }));
    await c.send("giải nén");
    expect(await env.stat("/ws/g/x/1.txt")).not.toBeNull();
    await c.currentSession.undo();
    expect(await env.stat("/ws/g")).toBeNull();
    expect(await env.stat("/ws/g.zip")).not.toBeNull();
  });

  it("make_dir hoàn tác được: thư mục mới tạo bị gỡ", async () => {
    const { c, env } = await work([{ name: "make_dir", args: { path: "a/b/c" } }], {});
    expect((await env.stat("/ws/a/b/c"))?.isDir).toBe(true);
    await c.currentSession.undo();
    expect(await env.stat("/ws/a")).toBeNull();
  });
});
