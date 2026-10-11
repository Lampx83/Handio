import type { loadZip } from "./docx-read";

/** Tiện ích dùng chung cho các tệp xử lý gói .pptx (tránh import vòng giữa pptx, pptx-edit, pptx-add). */
export type PptxZip = Awaited<ReturnType<typeof loadZip>>;

export const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const slideNum = (n: string): number => +/(\d+)\.xml$/.exec(n)![1];

/** Tên tệp slide theo ĐÚNG thứ tự trình chiếu (presentation.xml), không phải thứ tự tên tệp. */
export async function slideOrder(zip: PptxZip): Promise<string[]> {
  const byName = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideNum(a) - slideNum(b));
  try {
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    const target = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id && t) target.set(id, "ppt/" + t.replace(/^\/?(ppt\/)?/, ""));
    }
    const order = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => target.get(m[1])).filter((x): x is string => !!x && !!zip.file(x));
    return order.length === byName.length ? order : byName;
  } catch {
    return byName;
  }
}
