import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile, rename, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const cachePattern = /^[a-f0-9]{64}\.(png|jpeg|webp)\.webp$/;

export async function createThumbnailStore({ dataDir, images }) {
  const directory = join(dataDir, "cache", "thumbnails", "v1");
  for (const path of [join(dataDir, "cache"), join(dataDir, "cache", "thumbnails"), directory]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!(await lstat(path)).isDirectory()) throw new Error("缩略图目录无效");
  }
  const pending = new Map();
  const waiting = [];
  let active = 0;

  async function generate(asset) {
    // Reserve at most two slots, including disk reads; queued requests retain no image bytes.
    if (active >= 2) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    const file = join(directory, `${asset}.webp`);
    try {
      if (!(await lstat(images.path(asset))).isFile()) throw new Error("图片文件无效");
      try {
        const stat = await lstat(file);
        if (!stat.isFile()) throw new Error("缩略图文件无效");
        if (stat.size <= 1024 * 1024) {
          const cached = await readFile(file);
          const metadata = await sharp(cached).metadata().catch(() => ({}));
          if (metadata.format === "webp" && metadata.width <= 480 && metadata.height <= 480) return cached;
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const bytes = await sharp(await images.read(asset), { limitInputPixels: 40_000_000, failOn: "error" })
        .rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78, effort: 3 }).toBuffer();
      const temporary = join(directory, `.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
      return bytes;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }

  return {
    async read(asset) {
      images.path(asset);
      if (pending.has(asset)) return pending.get(asset);
      if (pending.size >= 128) throw new Error("缩略图读取繁忙，请稍后重试");
      const operation = generate(asset).then((bytes) => ({ image: `data:image/webp;base64,${bytes.toString("base64")}` }));
      pending.set(asset, operation);
      try { return await operation; } finally { pending.delete(asset); }
    },
    // Run after images.collect(): only derived files whose immutable source is gone are removed.
    async collect() {
      for (const file of await readdir(directory)) {
        if (!cachePattern.test(file)) continue;
        const asset = file.slice(0, -5);
        if (pending.has(asset)) continue;
        try { await lstat(images.path(asset)); }
        catch (error) {
          if (error.code !== "ENOENT") throw error;
          if ((await lstat(join(directory, file))).isFile()) await rm(join(directory, file), { force: true });
        }
      }
    },
  };
}
