/**
 * Client-side image compression for field photo capture.
 * Downscales to a max edge and re-encodes as JPEG to cut payload size
 * before upload — critical on 3G/4G in the field.
 */
export interface CompressOptions {
  maxEdge?: number;   // default 1600
  quality?: number;   // 0..1, default 0.78
  type?: string;      // default image/jpeg
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<Blob> {
  const { maxEdge = 1600, quality = 0.78, type = "image/jpeg" } = opts;
  if (!file.type.startsWith("image/")) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });

  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  if ("convertToBlob" in canvas) {
    return await (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  }
  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      type, quality,
    );
  });
}
