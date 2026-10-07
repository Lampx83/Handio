import { build } from "esbuild";
import fs from "node:fs";

fs.mkdirSync("dist", { recursive: true });
const common = { bundle: true, target: "es2022", sourcemap: process.env.NODE_ENV !== "production", minify: process.env.NODE_ENV === "production", logLevel: "info" };
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist", { recursive: true });
await build({ ...common, entryPoints: ["src/main.ts"], outdir: "dist", entryNames: "app", chunkNames: "chunks/[name]-[hash]", splitting: true, format: "esm", loader: { ".css": "css" }, define: { "process.env.NODE_ENV": '"production"' } });
await build({ ...common, entryPoints: ["src/sandbox-worker.ts"], outfile: "dist/sandbox-worker.js", format: "iife" });
for (const f of ["index.html"]) fs.copyFileSync(f, "dist/" + f);
