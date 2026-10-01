import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createImageStore } from "../bridge/images.mjs";
import { createThumbnailStore } from "../bridge/thumbnails.mjs";

const raster = (width, height, background = "#fe7da8") => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
const decode = ({ image }) => Buffer.from(image.split(",")[1], "base64");
async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "qc-thumbnails-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const images = await createImageStore(dataDir);
  const thumbnails = await createThumbnailStore({ dataDir, images });
  const cache = join(dataDir, "cache", "thumbnails", "v1");
  const put = async (bytes) => images.put({ bytes, extension: "png" });
  return { dataDir, images, thumbnails, cache, put };
}

test("thumbnails resize real pixels without cropping or enlarging and leave original bytes unchanged", async (t) => {
  const { images, thumbnails, put } = await setup(t);
  for (const [width, height, expected] of [[1920, 1080, [480, 270]], [200, 100, [200, 100]], [400, 1200, [160, 480]]]) {
    const source = await raster(width, height);
    const asset = await put(source);
    const bytes = decode(await thumbnails.read(asset));
    const result = await sharp(bytes).metadata();
    assert.deepEqual([result.width, result.height], expected);
    assert.equal(result.format, "webp");
    assert.ok(bytes.length < source.length);
    assert.deepEqual(await images.read(asset), source);
  }
});

test("concurrent requests share one conversion, with disk reuse after restart and repair of damaged cache", async (t) => {
  const { dataDir, images, cache, put } = await setup(t);
  const asset = await put(await raster(1280, 720));
  let reads = 0;
  const wrapped = { ...images, read: (asset) => { reads++; return images.read(asset); } };
  const store = await createThumbnailStore({ dataDir, images: wrapped });
  const results = await Promise.all(Array.from({ length: 20 }, () => store.read(asset)));
  assert.equal(reads, 1);
  assert.ok(results.every(({ image }) => image === results[0].image));
  const restarted = await createThumbnailStore({ dataDir, images: wrapped });
  assert.deepEqual(await restarted.read(asset), results[0]);
  assert.equal(reads, 1);
  await writeFile(join(cache, `${asset}.webp`), "corrupt cache");
  assert.deepEqual(await restarted.read(asset), results[0]);
  assert.equal(reads, 2);
  assert.deepEqual(await readdir(cache), [`${asset}.webp`]);
});

test("malformed or missing source fails without caching and can be retried after restoring source", async (t) => {
  const { thumbnails, images, cache, put } = await setup(t);
  const malformed = await put(Buffer.from("not an image"));
  await assert.rejects(thumbnails.read(malformed));
  assert.deepEqual(await readdir(cache), []);
  const original = await raster(640, 640);
  const asset = await put(original);
  await rm(images.path(asset));
  await assert.rejects(thumbnails.read(asset), { code: "ENOENT" });
  await put(original);
  assert.equal((await sharp(decode(await thumbnails.read(asset))).metadata()).width, 480);
  await rm(images.path(asset));
  await assert.rejects(thumbnails.read(asset), { code: "ENOENT" });
  await thumbnails.collect();
  assert.deepEqual(await readdir(cache), []);
});

test("collection preserves live cache and unrelated files, and image or cache symlinks are rejected", async (t) => {
  const { thumbnails, images, dataDir, cache, put } = await setup(t);
  const asset = await put(await raster(64, 64));
  await thumbnails.read(asset);
  await writeFile(join(cache, "unrelated.txt"), "keep");
  await thumbnails.collect();
  assert.equal((await readdir(cache)).length, 2);
  await assert.rejects(thumbnails.read("../private.png"), /引用无效/);
  const file = join(cache, `${asset}.webp`);
  await rm(file);
  await symlink(images.path(asset), file);
  await assert.rejects(thumbnails.read(asset), /缩略图文件无效/);
  assert.equal((await readFile(images.path(asset))).length > 0, true);
  await rm(images.path(asset));
  await symlink(join(dataDir, "private.png"), images.path(asset));
  await assert.rejects(thumbnails.read(asset), /图片文件无效/);
});

test("at most two source reads run concurrently and excessive queued requests fail without retaining bytes", async (t) => {
  const { dataDir, images, put } = await setup(t);
  const bytes = await raster(16, 16);
  const asset = await put(bytes);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const twoStarted = new Promise((resolve) => { started = resolve; });
  let active = 0;
  let maximum = 0;
  const store = await createThumbnailStore({ dataDir, images: {
    path: () => images.path(asset),
    read: async () => {
      maximum = Math.max(maximum, ++active);
      if (active === 2) started();
      await gate;
      active--;
      return bytes;
    },
  } });
  const requests = Array.from({ length: 128 }, (_, i) => store.read(`${i.toString(16).padStart(64, "0")}.png`));
  await twoStarted;
  assert.equal(maximum, 2);
  await assert.rejects(store.read(`${"f".repeat(64)}.png`), /繁忙/);
  release();
  await Promise.all(requests);
  assert.equal(maximum, 2);
});
