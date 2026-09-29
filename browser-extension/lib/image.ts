export async function canvasDataUrl(canvas: OffscreenCanvas, maxBytes = 4 * 1024 * 1024): Promise<string> {
  let blob = await canvas.convertToBlob({ type: "image/png" });
  if (blob.size > maxBytes)
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  if (blob.size > maxBytes) throw new Error("图片过大，请选择更小的图片");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

export async function normalizeImage(blob: Blob, maxBytes = 4 * 1024 * 1024) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasDataUrl(canvas, maxBytes);
  } finally {
    bitmap.close();
  }
}
