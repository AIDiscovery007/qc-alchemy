import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBridge } from "../bridge/server.mjs";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function installation(t) {
  const dir = await mkdtemp(join(tmpdir(), "alchemy install "));
  const codex = join(dir, "codex-test");
  await writeFile(codex, '#!/usr/bin/env node\nconsole.log("codex-cli test");\n', { mode: 0o700 });
  const env = { ...process.env, ALCHEMY_DATA_DIR: dir, ALCHEMY_PORT: String(await unusedPort()),
    CODEX_BIN: codex, CODEX_HOME: join(dir, "codex-home"), IMAGEGEN_SKILL_PATH: join(dir, "missing-imagegen.md") };
  delete env.ALCHEMY_SKILL_PATH;
  const run = command => exec(process.execPath, [join(root, "scripts/manage.mjs"), command], { env, timeout: 15000 });
  t.after(async () => { await run("stop").catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  return { dir, env, run };
}

test("bundled Alchemy runs without author's external files and has no dangling runtime references", async () => {
  const skillRoot = join(root, ".agents/skills/alchemy");
  const files = ["SKILL.md", ...(await readdir(join(skillRoot, "references"))).map(name => `references/${name}`)];
  assert.ok(!files.some(file => /source-index|casebook|evidence/.test(file)));
  for (const file of files) {
    const text = await readFile(join(skillRoot, file), "utf8");
    assert.ok(!/\/Users\/qiaochao|Xiaohongshu_Style_Extraction/.test(text));
    for (const [, link] of text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g))
      if (!link.startsWith("https://")) await readFile(resolve(skillRoot, dirname(file), link));
  }
});

test("fresh local service starts detached, reuses pairing, stops and restarts without data loss", { skip: process.platform === "win32" }, async t => {
  const { dir, run } = await installation(t);
  assert.match((await run("doctor")).stdout, /可逆向提示词/);
  assert.match((await run("start")).stdout, /后台启动/);
  for (const directory of ["config", "records", "images", "logs", "runtime"]) assert.ok((await readdir(dir)).includes(directory));
  for (const file of ["token", "bridge.log", "model-settings.json", "runtime.json", "start.lock"]) assert.ok(!(await readdir(dir)).includes(file));
  const firstToken = (await readFile(join(dir, "config", "token"), "utf8")).trim();
  await writeFile(join(dir, "preserved-note.txt"), "user data");
  const again = await run("start");
  assert.match(again.stdout, /复用/);
  assert.ok(!again.stdout.includes(firstToken));
  assert.equal((await run("pair")).stdout.trim(), firstToken);
  const health = JSON.parse((await run("status")).stdout);
  assert.equal(health.version, JSON.parse(await readFile(join(root, "package.json"), "utf8")).version);
  assert.equal(health.service, "qc-alchemy");
  assert.equal(health.ready, true);
  assert.equal(health.managed, true);
  assert.ok(!(await readFile(join(dir, "logs", "bridge.log"), "utf8")).includes(firstToken));
  await run("stop");
  await assert.rejects(run("status"));
  await run("start");
  assert.equal((await readFile(join(dir, "config", "token"), "utf8")).trim(), firstToken);
  assert.equal(await readFile(join(dir, "preserved-note.txt"), "utf8"), "user data");
});

test("updated manager controls an old running service without moving data, then migrates on restart", { skip: process.platform === "win32" }, async t => {
  const { dir, env, run } = await installation(t);
  const token = "legacy-pairing";
  const version = JSON.parse(await readFile(join(root, "package.json"))).version;
  await writeFile(join(dir, "token"), token);
  await writeFile(join(dir, "runtime.json"), JSON.stringify({ CODEX_BIN: env.CODEX_BIN }));
  await writeFile(join(dir, "model-settings.json"), JSON.stringify({ model: "saved-model", accountKey: "test" }));
  const old = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/shutdown") {
      res.end('{"stopped":true}', () => { old.close(); old.closeIdleConnections(); });
      return;
    }
    res.end(JSON.stringify({ service: "qc-alchemy", version, ready: true, managed: true, active: 0 }));
  });
  old.listen(Number(env.ALCHEMY_PORT), "127.0.0.1");
  await once(old, "listening");
  t.after(() => { old.closeAllConnections(); old.close(); });
  assert.match((await run("start")).stdout, /复用/);
  assert.equal((await run("pair")).stdout.trim(), token);
  assert.equal(JSON.parse((await run("status")).stdout).ready, true);
  assert.ok(!(await readdir(dir)).includes("config"));
  await run("stop");
  await run("start");
  assert.equal((await run("pair")).stdout.trim(), token);
  assert.equal(JSON.parse((await run("status")).stdout).model, "saved-model");
  for (const file of ["token", "runtime.json", "model-settings.json"]) {
    await readFile(join(dir, "config", file));
    await assert.rejects(readFile(join(dir, file)), { code: "ENOENT" });
  }
});

test("startup refuses an unrelated listener without changing its files or stopping it", { skip: process.platform === "win32" }, async t => {
  const { dir, env, run } = await installation(t);
  const other = createServer((req, res) => { res.writeHead(401); res.end("other service"); });
  other.listen(Number(env.ALCHEMY_PORT), "127.0.0.1");
  await once(other, "listening");
  t.after(() => { other.closeAllConnections(); other.close(); });
  await assert.rejects(run("start"), error => /已被其他服务/.test(error.stderr));
  assert.ok(other.listening);
  assert.ok(!(await readdir(dir)).includes("token"));
});

test("doctor stays strict while startup permits managing missing and logged-out CLI", { skip: process.platform === "win32" }, async t => {
  const { env, run } = await installation(t);
  await writeFile(env.CODEX_BIN, '#!/usr/bin/env node\nconsole.log("not a compatible tool");\n');
  await assert.rejects(run("doctor"), error => /找不到 Codex CLI/.test(error.stderr));
  await writeFile(env.CODEX_BIN, '#!/usr/bin/env node\nconsole.log("codex-cli test");if(process.argv[2]==="login")process.exit(1);\n');
  await assert.rejects(run("doctor"), error => /尚未登录/.test(error.stderr));
  assert.match((await run("start")).stderr, /仅启动本机管理服务/);
  assert.equal(JSON.parse((await run("status")).stdout).ready, true);
  await run("stop");
  await rm(env.CODEX_BIN);
  assert.match((await run("start")).stderr, /找不到 Codex CLI/);
  assert.equal(JSON.parse((await run("status")).stdout).ready, true);
});

test("managed shutdown requires authentication and refuses while a model task is active", async t => {
  const dir = await mkdtemp(join(tmpdir(), "alchemy-shutdown-"));
  await writeFile(join(dir, "model-settings.json"), JSON.stringify({ model: "test-model", accountKey: "test" }));
  let finish;
  const app = await createBridge({ dataDir: dir, allowShutdown: true, agent: () => new Promise(resolve => { finish = resolve; }) });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { Authorization: `Bearer ${app.token}`, "Content-Type": "application/json" };
  t.after(async () => { app.server.closeAllConnections(); app.server.close(); await rm(dir, { recursive: true, force: true }); });
  assert.equal((await fetch(`${url}/shutdown`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${url}/shutdown`, { method: "POST", headers: { ...headers, Origin: "https://example.com" } })).status, 403);
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
  const job = await fetch(`${url}/jobs`, { method: "POST", headers, body: JSON.stringify({ image, mode: "style" }) });
  assert.equal(job.status, 202);
  assert.equal((await fetch(`${url}/shutdown`, { method: "POST", headers })).status, 409);
  finish({ title: "test", observations: [], promptZh: "test", promptEn: "test", negativePrompt: "", uncertainties: [] });
  for (let i = 0; i < 100; i++) {
    if (!(await (await fetch(`${url}/health`, { headers })).json()).active) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const closed = once(app.server, "close");
  assert.equal((await fetch(`${url}/shutdown`, { method: "POST", headers })).status, 200);
  await closed;
});
