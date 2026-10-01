import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createImageStore } from "../bridge/images.mjs";

const image = { bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64"), extension: "png" };
const other = { bytes: Buffer.from([255, 216, 255, 217]), extension: "jpeg" };
const id = "00000000-0000-0000-0000-000000000001";
const generationId = "00000000-0000-0000-0000-000000000002";
const record = { id, createdAt: "2026-01-01T00:00:00.000Z", mode: "reenact", status: "completed", result: { promptZh: "保留提示词" } };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "qc-images-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: await createImageStore(dir) };
}

test("concurrent identical writes share an immutable file; distinct bytes remain separate", async (t) => {
  const { dir, store } = await setup(t);
  const assets = await Promise.all(Array.from({ length: 20 }, () => store.put(image)));
  assert.equal(new Set(assets).size, 1);
  assert.deepEqual(await store.read(assets[0]), image.bytes);
  const second = await store.put(other);
  assert.notEqual(second, assets[0]);
  assert.deepEqual((await readdir(join(dir, "images"))).sort(), [assets[0], second].sort());
  await writeFile(store.path(assets[0]), "damaged");
  await assert.rejects(store.read(assets[0]), /校验失败/);
  await assert.rejects(store.put(image), /校验失败/);
});

test("migration deduplicates all image roles, preserves metadata, and resumes after metadata commit", async (t) => {
  const { dir, store } = await setup(t);
  const asset = await store.put(image);
  const projectId = asset.slice(0, 64);
  const project = { id: projectId, createdAt: record.createdAt, extension: "png", imageAsset: asset };
  const job = { ...record, imageAsset: asset, generations: [{ id: generationId, status: "completed", extension: "png", subjectExtension: "jpeg", prompt: "snapshot" }] };
  // Simulate a restart after some refs were committed but before old files were removed.
  await writeFile(join(dir, `project-${projectId}.json`), JSON.stringify(project));
  await writeFile(join(dir, `${id}.json`), JSON.stringify(job));
  for (const name of [`project-${projectId}.png`, `${id}.png`, `${generationId}-generated.png`]) await writeFile(join(dir, name), image.bytes);
  for (const name of [`${id}-subject.jpeg`, `${generationId}-subject.jpeg`]) await writeFile(join(dir, name), other.bytes);
  await store.migrate();
  const migrated = JSON.parse(await readFile(join(dir, `${id}.json`)));
  assert.deepEqual(migrated.result, job.result);
  assert.equal(migrated.generations[0].prompt, "snapshot");
  assert.equal(migrated.imageAsset, migrated.generations[0].imageAsset);
  assert.equal(migrated.subjectAsset, migrated.generations[0].subjectAsset);
  assert.deepEqual(await store.read(migrated.subjectAsset), other.bytes);
  assert.equal((await readdir(join(dir, "images"))).length, 2);
  assert.deepEqual((await readdir(dir)).sort(), [`${id}.json`, "images", `project-${projectId}.json`].sort());
  const persisted = await readFile(join(dir, `${id}.json`), "utf8");
  await (await createImageStore(dir)).migrate();
  assert.equal(await readFile(join(dir, `${id}.json`), "utf8"), persisted);
});

test("failed migration leaves legacy files and metadata available for retry", async (t) => {
  const { dir, store } = await setup(t);
  await writeFile(join(dir, `${id}.json`), JSON.stringify(record));
  await writeFile(join(dir, `${id}.png`), image.bytes);
  await writeFile(join(dir, `${id}-subject.jpeg`), other.bytes);
  const badAsset = await store.put(other);
  await writeFile(store.path(badAsset), "corrupt");
  await assert.rejects(store.migrate(), /校验失败/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, `${id}.json`))), record);
  assert.deepEqual(await readFile(join(dir, `${id}.png`)), image.bytes);
  assert.deepEqual(await readFile(join(dir, `${id}-subject.jpeg`)), other.bytes);
  await rm(store.path(badAsset));
  await store.migrate();
  assert.equal((await readdir(join(dir, "images"))).length, 2);
});

test("collection retains every role and project-only reference, then removes only unused managed images", async (t) => {
  const { dir, store } = await setup(t);
  const asset = await store.put(image);
  const subject = await store.put(other);
  const projectId = asset.slice(0, 64);
  const projectFile = join(dir, `project-${projectId}.json`);
  await writeFile(projectFile, JSON.stringify({ id: projectId, createdAt: record.createdAt, imageAsset: asset }));
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ ...record, subjectAsset: asset, generations: [{ id: generationId, imageAsset: asset, subjectAsset: subject }] }));
  await writeFile(join(dir, "images", "user.png"), "keep");
  await writeFile(join(dir, "outside.png"), "keep");
  await store.collect();
  assert.deepEqual(await store.read(subject), other.bytes);
  await rm(join(dir, `${id}.json`));
  await store.collect();
  assert.deepEqual(await store.read(asset), image.bytes);
  await assert.rejects(store.read(subject), { code: "ENOENT" });
  await rm(projectFile);
  await store.collect();
  assert.deepEqual(await readdir(join(dir, "images")), ["user.png"]);
  assert.equal(await readFile(join(dir, "outside.png"), "utf8"), "keep");
});

test("damaged metadata prevents destructive migration and collection", async (t) => {
  const { dir, store } = await setup(t);
  const asset = await store.put(image);
  await writeFile(join(dir, `${id}.json`), "{broken");
  await writeFile(join(dir, `${id}.png`), image.bytes);
  await store.migrate();
  await store.collect();
  assert.deepEqual(await store.read(asset), image.bytes);
  assert.deepEqual(await readFile(join(dir, `${id}.png`)), image.bytes);
});

test("multi-image subjects survive migration and collection across reverse and generation snapshots", async (t) => {
  const { dir, store } = await setup(t);
  const original = await store.put(image);
  const replacement = await store.put(other);
  const unrelated = await store.put({ ...other, bytes: Buffer.concat([other.bytes, Buffer.from("unused")]) });
  const subjects = (asset) => [{ id: "one", subjectAsset: asset, role: "人物", detail: "" }, { id: "two", subjectAsset: asset, role: "物品", detail: "" }];
  const job = { ...record, mode: "multi-reenact", reenact: { subjects: subjects(original), basePrompt: "融合" }, generations: [{ id: generationId, subjects: subjects(replacement) }] };
  const path = join(dir, `${id}.json`);
  await writeFile(path, JSON.stringify(job));
  const restarted = await createImageStore(dir);
  await restarted.migrate();
  await restarted.collect();
  assert.deepEqual(JSON.parse(await readFile(path)), job);
  assert.deepEqual(await restarted.read(original), image.bytes);
  assert.deepEqual(await restarted.read(replacement), other.bytes);
  await assert.rejects(restarted.read(unrelated), { code: "ENOENT" });
  await writeFile(path, JSON.stringify({ ...job, generations: [] }));
  await restarted.collect();
  assert.deepEqual(await restarted.read(original), image.bytes);
  await assert.rejects(restarted.read(replacement), { code: "ENOENT" });
  await rm(path);
  await restarted.collect();
  await assert.rejects(restarted.read(original), { code: "ENOENT" });
});

test("malformed multi-image references block collection instead of deleting potentially owned assets", async (t) => {
  const { dir, store } = await setup(t);
  const asset = await store.put(image);
  for (const subjects of [null, {}, [{ id: "one" }], [{ subjectAsset: asset }, null]]) {
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ ...record, reenact: { subjects } }));
    await store.migrate();
    await store.collect();
    assert.deepEqual(await store.read(asset), image.bytes);
  }
});

test("asset refs, legacy names, symlinks and corrupt metadata cannot escape the image directory", async (t) => {
  const { dir, store } = await setup(t);
  await writeFile(join(dir, "private.png"), "private");
  for (const ref of ["../private.png", "/tmp/private.png", null, "a".repeat(64) + ".svg"]) {
    await assert.rejects(store.read(ref), /引用无效/);
  }
  await assert.rejects(store.legacy("../private"), /路径无效/);
  const asset = await store.put(image);
  await rm(store.path(asset));
  await symlink(join(dir, "private.png"), store.path(asset));
  await assert.rejects(store.read(asset), /文件无效/);
  await assert.rejects(store.put(image), /文件无效/);
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ ...record, imageAsset: "../private.png" }));
  await assert.rejects(store.migrate(), /引用无效/);
  await store.collect();
  assert.equal(await readFile(join(dir, "private.png"), "utf8"), "private");
  const nested = join(dir, "nested");
  await mkdir(nested);
  await symlink(join(dir, "images"), join(nested, "images"));
  await assert.rejects(createImageStore(nested), /目录无效/);
});
