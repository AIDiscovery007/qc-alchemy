import { browser } from "wxt/browser";
import type { ImageTarget } from "./types";
import { canvasDataUrl, normalizeImage } from "./image";

async function readImage(src: string): Promise<Blob> {
  if (!/^(https?:|data:image\/)/i.test(src))
    throw new Error("无法直接读取此图片");
  const response = await fetch(src, {
    credentials: "omit",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok || !response.body) throw new Error("图片站点拒绝读取");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20 * 1024 * 1024) throw new Error("原图过大");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

export async function captureImage(
  target: ImageTarget,
  tabId: number,
  windowId: number,
) {
  try {
    return { image: await normalizeImage(await readImage(target.src)), capture: "original" as const };
  } catch {
    // The page may move while fetching, so use the image's current bounds.
    const r = target.rect
      ? ((await browser.tabs.sendMessage(tabId, {
          type: "alchemy:rect",
          src: target.src,
        })) as ImageTarget["rect"])
      : undefined;
    if (
      !r ||
      r.width < 1 ||
      r.height < 1 ||
      r.x < 0 ||
      r.y < 0 ||
      r.x + r.width > r.viewportWidth + 1 ||
      r.y + r.height > r.viewportHeight + 1
    ) {
      throw new Error(
        "原图无法读取。请将整张图片移入可见区域，再使用图片上的悬浮按钮。",
      );
    }
    const [active] = await browser.tabs.query({ active: true, windowId });
    if (active?.id !== tabId) throw new Error("请回到图片所在标签页后重试");
    const screenshot = await browser.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
    const [stillActive] = await browser.tabs.query({ active: true, windowId });
    if (stillActive?.id !== tabId)
      throw new Error("截图时切换了标签页，请回到图片页面后重试");
    const current = await browser.tabs.sendMessage(tabId, {
      type: "alchemy:rect",
      src: target.src,
    });
    if (
      !current ||
      ["x", "y", "width", "height", "viewportWidth", "viewportHeight"].some(
        (key) => Math.abs(current[key] - r[key as keyof typeof r]) > 1,
      )
    ) {
      throw new Error("页面位置发生变化，请保持图片可见后重试");
    }
    const bitmap = await createImageBitmap(
      await (await fetch(screenshot)).blob(),
    );
    try {
      const scaleX = bitmap.width / r.viewportWidth;
      const scaleY = bitmap.height / r.viewportHeight;
      const scale = Math.min(
        1,
        2560 / Math.max(r.width * scaleX, r.height * scaleY),
      );
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(r.width * scaleX * scale)),
        Math.max(1, Math.round(r.height * scaleY * scale)),
      );
      canvas
        .getContext("2d")!
        .drawImage(
          bitmap,
          r.x * scaleX,
          r.y * scaleY,
          r.width * scaleX,
          r.height * scaleY,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      return { image: await canvasDataUrl(canvas), capture: "screenshot" as const };
    } finally {
      bitmap.close();
    }
  }
}
