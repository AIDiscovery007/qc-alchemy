import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createBridge } from "../bridge/server.mjs";
import { openGeneratedImage } from "../bridge/image-actions.mjs";

test("macOS image actions pass paths as literal arguments and report launch failures", async () => {
  const calls = [];
  const execute = async (...args) => calls.push(args);
  const path = '/tmp/中文 空格/$(touch unwanted); image.png';
  for (const action of ["open", "reveal"]) await openGeneratedImage(path, action, { platform: "darwin", execute });
  assert.deepEqual(calls, [
    ["/usr/bin/open", [path], { timeout: 5000 }],
    ["/usr/bin/open", ["-R", path], { timeout: 5000 }],
  ]);
  await assert.rejects(openGeneratedImage(path, "delete", { platform: "darwin", execute }), /无效/);
  await assert.rejects(openGeneratedImage(path, "open", { platform: "linux", execute }), /暂不支持/);
  assert.equal(calls.length, 2);
  await assert.rejects(openGeneratedImage(path, "open", { platform: "darwin", execute: async () => { throw new Error("launch failed"); } }), /无法打开/);
});

test("image actions authenticate, resolve the selected saved result, and reject unsafe or missing files", async t => {
  const dir = await mkdtemp(join(tmpdir(), "reframe-image-actions-"));
  const id = randomUUID(), first = randomUUID(), second = randomUUID(), failed = randomUUID(), corrupt = randomUUID();
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64");
  const job = { id, createdAt: new Date().toISOString(), mode: "recreate", status: "completed", result: { title: "Test" }, generations:
    [first, second, failed, corrupt].map((id, i) => ({ id, status: i === 2 ? "failed" : "completed", extension: "png" })) };
  await writeFile(join(dir, `${id}.json`), JSON.stringify(job));
  await writeFile(join(dir, `${id}.png`), bytes);
  await writeFile(join(dir, `${first}-generated.png`), bytes);
  await writeFile(join(dir, `${second}-generated.png`), Buffer.concat([bytes, Buffer.from("second")]));
  // Legacy migration hashes bytes as-is; a matching hash alone is not proof of an image.
  await writeFile(join(dir, `${corrupt}-generated.png`), "not an image");
  const calls = [];
  let fail = false;
  const app = await createBridge({ dataDir: dir, models: { close() {} }, cli: { close() {} }, imageAction: async (...args) => {
    if (fail) throw new Error("无法打开本机图片");
    calls.push(args);
  } });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(async () => { const closed = new Promise(resolve => app.server.close(resolve)); app.server.closeAllConnections(); await closed; await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}/jobs/${id}/generations`;
  const request = (suffix, options = {}) => fetch(`${base}/${suffix}`, { method: "POST", body: "{}", ...options,
    headers: { Authorization: `Bearer ${app.token}`, "Content-Type": "application/json", ...options.headers } });
  const asset = await (await request(`${first}/image`, { method: "GET", body: undefined })).json();
  for (const action of ["open", "reveal"]) assert.equal((await request(`${first}/${action}`)).status, 200);
  assert.deepEqual(calls, [[asset.path, "open"], [asset.path, "reveal"]]);
  assert.equal((await request(`${second}/open`)).status, 200);
  assert.notEqual(calls[2][0], asset.path);
  assert.equal((await request(`${first}/open`, { headers: { Authorization: "Bearer invalid" } })).status, 401);
  assert.equal((await request(`${first}/open`, { headers: { Origin: "https://example.com" } })).status, 403);
  assert.equal((await request(`${first}/open`, { method: "GET", body: undefined })).status, 404);
  assert.equal((await request(`${first}/open`, { body: JSON.stringify({ path: "/tmp/other.png" }) })).status, 400);
  assert.equal((await request(`${first}/open`, { body: JSON.stringify({ command: "anything" }) })).status, 400);
  assert.equal((await request(`${failed}/open`)).status, 409);
  assert.equal((await request(`${corrupt}/open`)).status, 400);
  assert.equal((await request(`${randomUUID()}/open`)).status, 404);
  fail = true;
  const failure = await request(`${first}/open`);
  assert.equal(failure.status, 503);
  assert.match((await failure.json()).error, /无法打开/);
  fail = false;
  await writeFile(asset.path, "corrupt");
  assert.notEqual((await request(`${first}/open`)).status, 200);
  await rm(asset.path);
  assert.equal((await request(`${first}/reveal`)).status, 404);
  const external = join(dir, "external.png");
  await writeFile(external, bytes);
  await symlink(external, asset.path);
  assert.notEqual((await request(`${first}/open`)).status, 200);
  assert.equal(calls.length, 3);
});
