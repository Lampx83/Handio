/** Thu nhỏ ảnh trong trình duyệt (canvas) để gửi cho mô hình đọc ảnh: cạnh dài ≤ maxSide, xuất JPEG. Trả null nếu trình duyệt không làm được. */
export async function shrinkImageBrowser(bytes: Uint8Array, mime: string, opts: { maxSide: number; quality: number }): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return null;
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const scale = Math.min(1, opts.maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = new OffscreenCanvas(w, h);
    const g = cv.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#fff"; // ảnh PNG trong suốt: nền trắng thay vì đen khi đổi sang JPEG
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await cv.convertToBlob({ type: "image/jpeg", quality: opts.quality });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg" };
  } catch {
    return null;
  }
}
