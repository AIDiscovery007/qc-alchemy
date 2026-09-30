import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm, link, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureStorage, migrateStorage, readStoredConfig, rotateServiceLog } from "../bridge/storage.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "qc-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("fresh storage has five directories and migration preserves all known files without touching other data", async (t) => {
  const root = await setup(t);
  const paths = await ensureStorage(root);
  assert.deepEqual((await readdir(root)).sort(), ["config", "images", "logs", "records", "runtime"]);
  const files = {
    token: "existing-pairing", "runtime.json": '{"CODEX_BIN":"/saved/codex"}',
    "model-settings.json": '{"model":"saved-model"}', "bridge.log": "previous log\n",
    "00000000-0000-0000-0000-000000000001.json": '{"result":"keep prompt"}',
    [`project-${"a".repeat(64)}.json`]: '{"title":"keep project"}',
    ".project-deletion.json": "[]",
  };
  for (const [file, content] of Object.entries(files)) await writeFile(join(root, file), content);
  await writeFile(join(root, "private-note.json"), "untouched");
  await writeFile(join(paths.images, "existing.png"), "same image path");
  assert.equal(await readStoredConfig(root, "token"), files.token);
  await migrateStorage(root);
  for (const [file, content] of Object.entries(files)) {
    const folder = ["token", "runtime.json", "model-settings.json"].includes(file) ? "config" : file === "bridge.log" ? "logs" : "records";
    assert.equal(await readFile(join(root, folder, file), "utf8"), content);
    await assert.rejects(readFile(join(root, file)), { code: "ENOENT" });
  }
  assert.equal(await readStoredConfig(root, "token"), files.token);
  await migrateStorage(root);
  assert.equal(await readFile(join(root, "private-note.json"), "utf8"), "untouched");
  assert.equal(await readFile(join(paths.images, "existing.png"), "utf8"), "same image path");
});

test("interrupted file moves resume; conflicting destination files never overwrite old data", async (t) => {
  const root = await setup(t);
  const paths = await ensureStorage(root);
  await writeFile(join(root, "token"), "same");
  await link(join(root, "token"), paths.token);
  await migrateStorage(root);
  await assert.rejects(readFile(join(root, "token")), { code: "ENOENT" });
  await writeFile(join(root, "model-settings.json"), "old");
  await writeFile(paths.models, "different");
  await assert.rejects(migrateStorage(root), /保留双方数据/);
  assert.equal(await readFile(join(root, "model-settings.json"), "utf8"), "old");
  assert.equal(await readFile(paths.models, "utf8"), "different");
});

test("storage rejects symlink directories and files without moving their targets", async (t) => {
  const root = await setup(t);
  const outside = await setup(t);
  await symlink(outside, join(root, "records"));
  await assert.rejects(ensureStorage(root), /目录无效/);
  await rm(join(root, "records"));
  await ensureStorage(root);
  await writeFile(join(outside, "secret"), "private");
  await symlink(join(outside, "secret"), join(root, "token"));
  await assert.rejects(migrateStorage(root), /文件无效/);
  assert.equal(await readFile(join(outside, "secret"), "utf8"), "private");
  await assert.rejects(readStoredConfig(root, "../secret"), /名称无效/);
});

test("log rotation retains one previous log and leaves small logs intact", async (t) => {
  const root = await setup(t);
  const { log, logs } = await ensureStorage(root);
  await rotateServiceLog(log);
  await writeFile(log, "small");
  await rotateServiceLog(log);
  assert.equal(await readFile(log, "utf8"), "small");
  const large = Buffer.alloc(5 * 1024 * 1024, 120);
  await writeFile(log, large);
  await rotateServiceLog(log);
  assert.deepEqual(await readFile(`${log}.1`), large);
  await writeFile(log, Buffer.alloc(large.length, 121));
  await rotateServiceLog(log);
  assert.equal((await readFile(`${log}.1`))[0], 121);
  assert.deepEqual(await readdir(logs), ["bridge.log.1"]);
});
