// Các bài eval. Viết tay, dữ liệu giả, mô phỏng các KIỂU hỏng đã thấy qua số liệu chẩn đoán và phiên người dùng tự chia sẻ; không chép nội dung người dùng.
// Mỗi bài gồm: đề (`prompt`), tệp sẵn có (`seed`/`setup`), bộ chấm (`grade`) và lời giải mẫu (`solve`).
// Lời giải mẫu để kiểm chứng bộ chấm (--self-test): đề chưa làm phải KHÔNG đạt, làm theo lời giải phải đạt.
// Trong seed/prompt: {{DIR}} là thư mục dự án, {{tên}} là cổng trống cấp riêng cho mỗi lần chạy (khai báo ở `ports`).
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import JSZip from "jszip";
import { office, type Profile } from "@neu/agent-core";
import type { Grader } from "./grade";
import type { Group } from "./stats";

export interface SolveCtx {
  dir: string;
  ports: Record<string, number>;
  write(p: string, data: string | Uint8Array): void;
  read(p: string): string;
  /** Bật tiến trình nền trong dự án; tự dừng sau khi chấm. Chờ cổng mở. */
  serve(cmd: string, cwd: string, port: string): Promise<void>;
  /** Lời cuối giả định của agent. */
  final: string;
}

export interface EvalTask {
  id: string;
  title: string;
  group: Group;
  profile: Profile;
  /** Kiểu hỏng mà bài này mô phỏng. */
  why: string;
  prompt: string;
  ports?: string[];
  seed?: Record<string, string>;
  /** Tạo tệp nhị phân sẵn có (Office) hoặc tệp ngoài dự án. */
  setup?: (dir: string) => Promise<void>;
  /** Cần trình duyệt ẩn để chấm (Electron); bộ `npx vitest run` bỏ qua các bài này. */
  browser?: boolean;
  /** Lệnh phải có trên máy thì agent mới làm được. */
  requires?: string;
  grade: (g: Grader) => Promise<unknown> | unknown;
  solve: (s: SolveCtx) => Promise<void> | void;
}

export function startProcess(cmd: string, cwd: string): ChildProcess {
  return spawn("bash", ["-lc", cmd], { cwd, detached: true, stdio: "ignore" });
}

const put = (dir: string, p: string, data: string | Uint8Array) => {
  const f = path.join(dir, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
};

// --- Dự án frontend + backend ---
const MON = '[{ ma: "KTVM", ten: "Kinh tế vi mô" }, { ma: "CSDL", ten: "Cơ sở dữ liệu" }]';
const beServer = (cors: boolean) => `const http = require("node:http");
const MON_HOC = ${MON};
http.createServer((req, res) => {
  ${cors ? 'res.setHeader("Access-Control-Allow-Origin", "*");\n  ' : ""}if (req.url === "/api/mon-hoc") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(MON_HOC));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen({{be}}, "127.0.0.1", () => console.log("backend chạy ở cổng {{be}}"));
`;
const feServer = `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(__dirname, "index.html")));
}).listen({{fe}}, "127.0.0.1", () => console.log("frontend chạy ở cổng {{fe}}"));
`;
const feHtml = (url: string) => `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Môn học</title><link rel="icon" href="data:,"></head>
<body><h1>Danh sách môn học</h1><ul id="ds"></ul>
<script>
fetch("${url}")
  .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then((ds) => { document.getElementById("ds").innerHTML = ds.map((m) => "<li>" + m.ten + "</li>").join(""); })
  .catch(() => { document.getElementById("ds").innerHTML = "<li>Lỗi tải dữ liệu</li>"; });
</script></body></html>
`;
const devPkg = (name: string) => JSON.stringify({ name, private: true, scripts: { dev: "node server.js" } }, null, 2) + "\n";
const feBeSeed = (cors: boolean, url: string): Record<string, string> => ({
  "be/package.json": devPkg("be"),
  "be/server.js": beServer(cors),
  "fe/package.json": devPkg("fe"),
  "fe/server.js": feServer,
  "fe/index.html": feHtml(url),
});

// --- Bài trình chiếu: chữ bị PowerPoint tách thành nhiều đoạn (run), như tệp người dùng thật ---
const DECK = `# Báo cáo kinh doanh\nKhoa Thử nghiệm\n\n---\n\n## Mở đầu\n- Doanh thu quý 3 tăng 12%\n- Chi nhánh TP HCM dẫn đầu\n\n---\n\n## Số liệu\n- Doanh thu quý 3 đạt 40 tỉ\n- Khách hàng mới: 1.200\n\n---\n\n## Kết luận\n- Tiếp tục mở rộng tại TP HCM`;

async function splitRuns(pptx: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(pptx);
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async("string");
    zip.file(name, xml.replace(/<a:r>(<a:rPr[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))<a:t>([^<]*?Doanh thu )(quý 3[^<]*)<\/a:t><\/a:r>/g, "<a:r>$1<a:t>$2</a:t></a:r><a:r>$1<a:t>$3</a:t></a:r>"));
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

// --- Dữ liệu tính được, đủ dài để không tính nhẩm ---
const KHU_VUC = ["Hà Nội", "Đà Nẵng", "TP. Hồ Chí Minh"];
const REVENUE = Array.from({ length: 60 }, (_, i) => ({ kv: KHU_VUC[i % 3], dt: 100 + ((i * 37) % 91) }));
const revenueTotal = (kv: string) => REVENUE.filter((r) => r.kv === kv).reduce((n, r) => n + r.dt, 0);
const SCORES = Array.from({ length: 25 }, (_, i) => ({ ten: `Sinh viên ${String(i + 1).padStart(2, "0")}`, gk: 4 + (i * 3) % 7, ck: 3 + (i * 5) % 8 }));

const TITLES = ["Giới thiệu chương trình", "Mục tiêu đào tạo", "Chuẩn đầu ra", "Khung chương trình", "Học phần bắt buộc", "Học phần tự chọn", "Thực tập doanh nghiệp", "Đội ngũ giảng viên", "Cơ sở vật chất", "Cơ hội nghề nghiệp", "Học phí và học bổng", "Thông tin liên hệ"];
const DOC_HEADINGS = ["Đặc điểm tình hình", "Hoạt động đào tạo", "Kết quả học tập", "Nghiên cứu khoa học", "Hợp tác doanh nghiệp", "Phương hướng năm tới"];

const HOC_PHI_BUG = ["// Tính học phí theo số tín chỉ", "const DON_GIA = 450000;", "", "function tinhHocPhi(soTinChi, mienGiam) {", "\tconst goc = soTinChi * DON_GIA;", "\t// mienGiam tính theo phần trăm", "\treturn goc - mienGiam;", "}", "", "module.exports = { tinhHocPhi };", ""].join("\r\n");

export const TASKS: EvalTask[] = [
  {
    id: "01-fe-be-song-song",
    title: "Bật cả frontend và backend",
    group: "regression",
    profile: "code",
    why: "Bật backend làm tắt frontend vì hai lệnh cùng là `npm run dev` ở hai thư mục.",
    ports: ["be", "fe"],
    seed: feBeSeed(true, "http://127.0.0.1:{{be}}/api/mon-hoc"),
    prompt: "Dự án có backend ở thư mục be/ (cổng {{be}}) và frontend ở thư mục fe/ (cổng {{fe}}). Mỗi bên bật bằng npm run dev. Bật cả hai và để chúng chạy nền để mình dùng luôn. Khi cả hai cùng chạy thì báo mình.",
    grade: async (g) => {
      await g.http("be", "/api/mon-hoc", ["Kinh tế vi mô"], "backend vẫn đang chạy");
      await g.http("fe", "/", ["Danh sách môn học"], "frontend vẫn đang chạy");
    },
    solve: async (s) => {
      await s.serve("node server.js", "be", "be");
      await s.serve("node server.js", "fe", "fe");
      s.final = "Cả hai đang chạy.";
    },
  },
  {
    id: "02-fe-goi-api-loi",
    title: "Sửa lỗi frontend không gọi được backend",
    group: "capability",
    profile: "code",
    why: "Nhiều lượt thăm dò bằng curl mà không tìm ra lỗi chỉ thấy trên trình duyệt (sai đường dẫn, thiếu CORS).",
    ports: ["be", "fe"],
    browser: true,
    seed: feBeSeed(false, "http://127.0.0.1:{{be}}/api/monhoc"),
    prompt: "Dự án có backend ở be/ (cổng {{be}}) và frontend ở fe/ (cổng {{fe}}), mỗi bên bật bằng npm run dev. Mở trang frontend thì thấy báo \"Lỗi tải dữ liệu\". Sửa giúp mình, rồi để cả hai chạy nền: mình cần thấy danh sách môn học trên trang.",
    grade: async (g) => {
      await g.page({ port: "fe" }, [{ wait: 500 }, { eval: 'document.body.innerText.includes("Kinh tế vi mô") && !document.body.innerText.includes("Lỗi tải dữ liệu")', label: "trang hiện danh sách môn học" }]);
    },
    solve: async (s) => {
      s.write("be/server.js", s.read("be/server.js").replace("http.createServer((req, res) => {", 'http.createServer((req, res) => {\n  res.setHeader("Access-Control-Allow-Origin", "*");'));
      s.write("fe/index.html", s.read("fe/index.html").replace("/api/monhoc", "/api/mon-hoc"));
      await s.serve("node server.js", "be", "be");
      await s.serve("node server.js", "fe", "fe");
      s.final = "Đã sửa.";
    },
  },
  {
    id: "03-python-tieng-viet",
    title: "Chạy Python in tiếng Việt",
    group: "regression",
    profile: "code",
    why: "Lỗi mã hoá khi Python in tiếng Việt làm phí nhiều bước. Chỉ thật sự bộc lộ trên Windows.",
    requires: "python3 --version || py -3 --version",
    seed: { "bao_cao.py": 'tong = sum([500, 450, 300])\nprint("Báo cáo doanh thu năm học")\nprint(f"Tổng doanh thu: {tong} triệu đồng")\n' },
    prompt: "Chạy bao_cao.py rồi ghi nguyên văn những gì nó in ra vào tệp ket-qua.txt.",
    grade: (g) => g.file("ket-qua.txt", ["Báo cáo doanh thu năm học", "Tổng doanh thu: 1250 triệu đồng"]),
    solve: (s) => {
      s.write("ket-qua.txt", "Báo cáo doanh thu năm học\nTổng doanh thu: 1250 triệu đồng\n");
      s.final = "Xong.";
    },
  },
  {
    id: "04-loi-chi-khi-bam",
    title: "Sửa lỗi chỉ nổ khi bấm nút",
    group: "capability",
    profile: "code",
    why: "Trang tải sạch nhưng bấm nút mới lỗi; agent báo xong mà không đi thử luồng.",
    browser: true,
    seed: {
      "index.html": '<!doctype html>\n<html lang="vi"><head><meta charset="utf-8"><title>Tính tổng</title><link rel="icon" href="data:,"></head>\n<body><input id="a" placeholder="Số a"><input id="b" placeholder="Số b"><button id="tinh">Tính tổng</button><p id="kq"></p><script src="app.js"></script></body></html>\n',
      "app.js": 'function cong(a, b) {\n  return a + b;\n}\ndocument.getElementById("tinh").addEventListener("click", () => {\n  const a = document.getElementById("a").value;\n  const b = document.getElementById("b").value;\n  document.getElementById("kq").textContent = "Tổng: " + congHaiSo(a, b);\n});\n',
    },
    prompt: 'Trên trang index.html, nhập hai số rồi bấm nút "Tính tổng" thì không ra kết quả. Sửa giúp mình, tự kiểm tra rồi báo. Kết quả phải hiện dạng "Tổng: 12" khi nhập 5 và 7.',
    grade: async (g) => {
      await g.page({ file: "index.html" }, [{ fill: { placeholder: "Số a" }, value: "5" }, { fill: { placeholder: "Số b" }, value: "7" }, { click: { text: "Tính tổng" } }, { eval: 'document.body.innerText.includes("Tổng: 12")', label: "5 + 7 hiện “Tổng: 12”" }]);
    },
    solve: (s) => {
      s.write("app.js", s.read("app.js").replace("congHaiSo(a, b)", "cong(Number(a), Number(b))"));
      s.final = "Đã sửa.";
    },
  },
  {
    id: "05-pptx-sua-chu",
    title: "Sửa chữ trong bài trình chiếu có sẵn",
    group: "capability",
    profile: "work",
    why: "pptx_edit hay báo no_match (45/144 lần gọi trong 30 ngày), nhất là chữ bị tách đoạn.",
    setup: async (dir) => {
      const { bytes } = await office.createPptx({ content: DECK, auto: false });
      put(dir, "bao-cao.pptx", await splitRuns(bytes));
    },
    prompt: 'Trong bao-cao.pptx: đổi mọi chỗ "Doanh thu quý 3" thành "Doanh thu quý 4", đổi mọi chỗ "TP HCM" thành "TP. Hồ Chí Minh", và thêm một slide cuối tiêu đề "Cảm ơn". Sửa ngay trên tệp này.',
    grade: (g) => g.pptx("bao-cao.pptx", { slides: 5, includes: ["Doanh thu quý 4 tăng 12%", "Doanh thu quý 4 đạt 40 tỉ", "TP. Hồ Chí Minh", "Khách hàng mới: 1.200", "Mở đầu", "Kết luận"], excludes: ["quý 3", "TP HCM"], lastIncludes: "Cảm ơn" }),
    solve: async (s) => {
      const content = DECK.replaceAll("Doanh thu quý 3", "Doanh thu quý 4").replaceAll("TP HCM", "TP. Hồ Chí Minh") + "\n\n---\n\n## Cảm ơn\n- Xin cảm ơn";
      s.write("bao-cao.pptx", (await office.createPptx({ content, auto: false })).bytes);
      s.final = "Xong.";
    },
  },
  {
    id: "06-pptx-dai",
    title: "Tạo bài trình chiếu 12 slide",
    group: "capability",
    profile: "work",
    why: "create_pptx lỗi bad_json 20/88 lần: tham số dài bị hỏng JSON.",
    prompt: `Tạo tệp gioi-thieu.pptx giới thiệu chương trình đào tạo giả định "Cử nhân Khoa học dữ liệu" của Khoa Thử nghiệm, đúng 12 slide tính cả bìa, tiêu đề các slide theo đúng thứ tự: ${TITLES.join("; ")}. Mỗi slide (trừ bìa) có 3 đến 5 gạch đầu dòng. Thông tin chưa biết thì ghi [cần bổ sung], không cần hỏi lại.`,
    grade: (g) => g.pptx("gioi-thieu.pptx", { slides: 12, titlesInOrder: TITLES }),
    solve: async (s) => {
      const content = TITLES.map((t, i) => (i === 0 ? `# ${t}\nKhoa Thử nghiệm` : `## ${t}\n- Ý một\n- Ý hai\n- Ý ba`)).join("\n\n---\n\n");
      s.write("gioi-thieu.pptx", (await office.createPptx({ content, auto: false })).bytes);
      s.final = "Xong.";
    },
  },
  {
    id: "07-docx-dai",
    title: "Tạo văn bản Word dài",
    group: "capability",
    profile: "work",
    why: "create_docx lỗi bad_json: một lần gọi không chở nổi văn bản dài, phải chia nhiều lần ghi nối.",
    prompt: `Soạn tệp bao-cao-nam-hoc.docx: báo cáo tổng kết năm học của Khoa Thử nghiệm (đơn vị giả định), dài ít nhất 1500 từ, gồm đúng 6 mục theo thứ tự: ${DOC_HEADINGS.join("; ")}. Mục "Kết quả học tập" có một bảng. Số liệu chưa biết thì ghi [cần bổ sung], không cần hỏi lại.`,
    grade: (g) => g.docx("bao-cao-nam-hoc.docx", { includes: DOC_HEADINGS, minWords: 1200, minTables: 1 }),
    solve: async (s) => {
      const para = "Trong năm học vừa qua đơn vị đã triển khai đầy đủ các nhiệm vụ theo kế hoạch đề ra và tiếp tục nâng cao chất lượng hoạt động. ".repeat(12);
      const content = DOC_HEADINGS.map((h, i) => `## ${h}\n\n${para}${i === 2 ? "\n\n| Chỉ tiêu | Kết quả |\n|---|---|\n| Tốt nghiệp | [cần bổ sung] |" : ""}`).join("\n\n");
      s.write("bao-cao-nam-hoc.docx", await office.createDocx({ content }));
      s.final = "Xong.";
    },
  },
  {
    id: "08-doc-duong-dan-day-du",
    title: "Đọc tệp trong dự án theo đường dẫn tuyệt đối",
    group: "capability",
    profile: "work",
    why: "read_document lỗi outside_project 44/276 lần; một khả năng là mô hình đưa đường dẫn đầy đủ.",
    setup: async (dir) => put(dir, "tai-lieu/quy-che.docx", await office.createDocx({ content: "## Điều 5. Học phí\n\nMức học phí năm học là 27.500.000 đồng mỗi sinh viên.\n\n## Điều 6. Miễn giảm\n\nSinh viên diện chính sách được miễn giảm theo quy định." })),
    prompt: "Đọc tệp {{DIR}}/tai-lieu/quy-che.docx và cho mình biết mức học phí năm học là bao nhiêu.",
    grade: (g) => {
      g.final({ any: [/27[.,]?500[.,]?000/, /27[,.]5\s*triệu/i], label: "trả lời đúng mức học phí" });
      g.maxErrors("read_document", 2);
    },
    solve: (s) => {
      s.final = "Mức học phí là 27.500.000 đồng.";
    },
  },
  {
    id: "09-doc-ngoai-du-an",
    title: "Được yêu cầu đọc tệp ngoài dự án",
    group: "regression",
    profile: "work",
    why: "Khi tệp nằm ngoài dự án agent phải nói rõ và chỉ cách làm, không thử đi thử lại, không đoán nội dung.",
    setup: async (dir) => put(dir, "../ngoai-du-an/luong.docx", await office.createDocx({ content: "Mức lương của ông An là 38.000.000 đồng." })),
    prompt: "Đọc tệp ../ngoai-du-an/luong.docx rồi cho mình biết mức lương của ông An.",
    grade: (g) => {
      g.final({ any: [/ngoài|không (thể|đọc|truy|mở|có quyền)|chép|sao chép|đưa .*vào|đính kèm/i], none: [/38[.,]?000[.,]?000/, /38\s*triệu/i], label: "nói rõ không đọc được, không đoán nội dung" });
      g.maxErrors("read_document", 3);
    },
    solve: (s) => {
      s.final = "Tệp này nằm ngoài thư mục dự án nên mình không đọc được. Hãy chép tệp vào thư mục làm việc.";
    },
  },
  {
    id: "10-sua-tep-crlf",
    title: "Sửa tệp xuống dòng kiểu Windows, có tiếng Việt",
    group: "capability",
    profile: "code",
    why: "edit_file lỗi no_match 53/654 lần; tệp từ Windows dùng CRLF và tab.",
    seed: {
      "lib/hoc-phi.js": HOC_PHI_BUG,
      "test.js": 'const assert = require("node:assert");\nconst { tinhHocPhi } = require("./lib/hoc-phi");\nassert.strictEqual(tinhHocPhi(10, 0), 4500000);\nassert.strictEqual(tinhHocPhi(10, 50), 2250000);\nconsole.log("đạt");\n',
    },
    prompt: "Chạy node test.js đang báo sai. Sửa lib/hoc-phi.js cho đúng (mienGiam là phần trăm), không sửa test.js và giữ nguyên kiểu xuống dòng của tệp.",
    grade: async (g) => {
      await g.cmd("node test.js", "node test.js đạt");
      g.unchanged("test.js");
      g.crlf("lib/hoc-phi.js");
    },
    solve: (s) => {
      s.write("lib/hoc-phi.js", HOC_PHI_BUG.replace("return goc - mienGiam;", "return goc - (goc * mienGiam) / 100;"));
      s.final = "Đã sửa.";
    },
  },
  {
    id: "11-csv-tong-hop",
    title: "Tổng hợp số liệu từ CSV",
    group: "capability",
    profile: "work",
    why: "run_javascript lỗi 77/209 lần (28 lần do sandbox); agent cần cách tính đúng thay vì tính nhẩm.",
    seed: { "doanh-thu.csv": "khu_vuc,doanh_thu\n" + REVENUE.map((r) => `${r.kv},${r.dt}`).join("\n") + "\n" },
    prompt: "Từ doanh-thu.csv tính tổng doanh thu theo từng khu vực, ghi ra tong-hop.csv có đúng 2 cột khu_vuc,tong.",
    grade: (g) => {
      const m = g.csvMap("tong-hop.csv", "khu_vuc", "tong");
      if (!m) return;
      for (const kv of KHU_VUC) g.add(`tổng ${kv} đúng`, m.get(kv) === revenueTotal(kv), `nhận ${m.get(kv)}, đúng là ${revenueTotal(kv)}`);
    },
    solve: (s) => {
      s.write("tong-hop.csv", "khu_vuc,tong\n" + KHU_VUC.map((kv) => `${kv},${revenueTotal(kv)}`).join("\n") + "\n");
      s.final = "Xong.";
    },
  },
  {
    id: "12-luong-nhieu-buoc",
    title: "Làm trang trắc nghiệm có nhiều bước",
    group: "capability",
    profile: "code",
    why: "Trang đầu chạy nhưng luồng sau lỗi; cần tự kiểm tra bằng check_page có steps.",
    browser: true,
    prompt: 'Làm trang trắc nghiệm index.html bằng HTML, CSS, JavaScript thuần. Lúc đầu chỉ có nút "Bắt đầu làm bài". Bấm vào thì hiện 2 câu: câu 1 "Thủ đô Việt Nam?" với đáp án "Hà Nội" và "Huế"; câu 2 "2 + 3 bằng mấy?" với đáp án "5" và "6". Mỗi đáp án là một nút hoặc nhãn bấm được. Có nút "Nộp bài"; nộp thì hiện "Điểm: x/2".',
    grade: async (g) => {
      await g.page({ file: "index.html" }, [
        { eval: '!document.body.innerText.includes("Thủ đô Việt Nam")', label: "lúc đầu chưa hiện câu hỏi" },
        { click: { text: "Bắt đầu làm bài" } },
        { eval: 'document.body.innerText.includes("Thủ đô Việt Nam")', label: "bấm bắt đầu thì hiện câu hỏi" },
        { click: { text: "Hà Nội" } },
        { click: { text: "5" } },
        { click: { text: "Nộp bài" } },
        { eval: 'document.body.innerText.includes("Điểm: 2/2")', label: "đúng cả hai câu hiện “Điểm: 2/2”" },
      ]);
    },
    solve: (s) => {
      s.write("index.html", `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Trắc nghiệm</title><link rel="icon" href="data:,"></head><body>
<button id="bd">Bắt đầu làm bài</button><div id="q" hidden><p>Thủ đô Việt Nam?</p><button data-c="1" data-d="1">Hà Nội</button><button data-c="1" data-d="0">Huế</button><p>2 + 3 bằng mấy?</p><button data-c="2" data-d="1">5</button><button data-c="2" data-d="0">6</button><br><button id="nop">Nộp bài</button><p id="kq"></p></div>
<script>const dap={};document.getElementById("bd").onclick=()=>{document.getElementById("q").hidden=false;};
document.querySelectorAll("[data-c]").forEach((b)=>{b.onclick=()=>{dap[b.dataset.c]=b.dataset.d==="1";};});
document.getElementById("nop").onclick=()=>{document.getElementById("kq").textContent="Điểm: "+Object.values(dap).filter(Boolean).length+"/2";};</script></body></html>`);
      s.final = "Xong.";
    },
  },
  {
    id: "13-xlsx-cong-thuc",
    title: "Tạo bảng điểm Excel bằng công thức",
    group: "capability",
    profile: "work",
    why: "Bảng tính phải có công thức sống; gõ sẵn kết quả thì sai khi người dùng sửa điểm.",
    seed: { "diem.csv": "ho_ten,giua_ky,cuoi_ky\n" + SCORES.map((d) => `${d.ten},${d.gk},${d.ck}`).join("\n") + "\n" },
    prompt: 'Từ diem.csv tạo tệp bang-diem.xlsx: giữ 3 cột, thêm cột "Tổng kết" = 40% giữa kỳ + 60% cuối kỳ bằng công thức Excel (không gõ sẵn kết quả). Mỗi sinh viên một dòng, tiêu đề ở dòng đầu.',
    grade: async (g) => {
      const ws = await g.xlsxSheet("bang-diem.xlsx");
      if (!ws) return;
      const headers = Array.from(ws.getRow(1).values as unknown[], (v) => String(v ?? ""));
      const col = headers.findIndex((h) => h.normalize("NFC").includes("Tổng kết"));
      g.add("có cột “Tổng kết”", col > 0, `tiêu đề: ${headers.join(", ")}`);
      if (col <= 0) return;
      let formulas = 0, students = 0;
      ws.eachRow((row, n) => {
        if (n === 1 || !String(row.getCell(1).value ?? "").startsWith("Sinh viên")) return;
        students++;
        if (row.getCell(col).formula) formulas++;
      });
      g.add(`đủ ${SCORES.length} sinh viên`, students === SCORES.length, `có ${students}`);
      g.add("cột Tổng kết là công thức ở mọi dòng", formulas === SCORES.length && formulas > 0, `${formulas}/${students} dòng có công thức`);
    },
    solve: async (s) => {
      const rows = [["ho_ten", "giua_ky", "cuoi_ky", "Tổng kết"], ...SCORES.map((d, i) => [d.ten, d.gk, d.ck, `=0.4*B${i + 2}+0.6*C${i + 2}`])];
      s.write("bang-diem.xlsx", (await office.createXlsx([{ name: "Bảng điểm", rows }])).bytes);
      s.final = "Xong.";
    },
  },
  {
    id: "14-design-poster",
    title: "Thiết kế poster HTML",
    group: "capability",
    profile: "design",
    why: "Tab Design chỉ có 38 lượt trong 30 ngày, chưa biết chất lượng; đo mốc đầu.",
    browser: true,
    prompt: 'Thiết kế poster hội thảo dạng tệp poster.html, khổ dọc, không dùng tài nguyên ngoài mạng. Nội dung bắt buộc: "AI trong giáo dục", "20/11/2026", "Hội trường A2", "Khoa Thử nghiệm". Không cần hỏi lại.',
    grade: async (g) => {
      await g.page({ file: "poster.html" }, ["AI trong giáo dục", "20/11/2026", "Hội trường A2", "Khoa Thử nghiệm"].map((t) => ({ eval: `document.body.innerText.includes(${JSON.stringify(t)})`, label: `có “${t}”` })).concat([{ eval: "document.documentElement.scrollWidth <= window.innerWidth + 1", label: "không tràn ngang" }]));
    },
    solve: (s) => {
      s.write("poster.html", '<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Poster</title><link rel="icon" href="data:,"></head><body><h1>AI trong giáo dục</h1><p>20/11/2026</p><p>Hội trường A2</p><p>Khoa Thử nghiệm</p></body></html>');
      s.final = "Xong.";
    },
  },
];
