import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import sharp from "sharp";
import { createBridge } from "../bridge/server.mjs";

const raster = (width, height, background = "#fe7da8") => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
const post = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function setup(t, skipMigration = false) {
  const dir = await mkdtemp(join(tmpdir(), "qc-gallery-"));
  const reference = await raster(8, 8), otherReference = await raster(8, 8, "#27ccf3");
  const portrait = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#ffd440" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const jobs = [];
  for (const [index, title, source, outputs] of [
    [0, "花园初稿", reference, [{ bytes: await raster(40, 40), extension: "png" }, { bytes: portrait, extension: "jpeg" }]],
    [1, "花园更新", reference, [{ bytes: await raster(90, 30), extension: "png" }, { bytes: Buffer.from("corrupt"), extension: "png" }, { status: "failed" }, {}]],
    [2, "隐藏项目", otherReference, [{ bytes: await raster(50, 50), extension: "png" }]],
  ]) {
    const job = { id: randomUUID(), createdAt: `2026-10-0${index + 1}T00:00:00Z`, mode: "recreate", status: "completed", result: { title },
      generations: outputs.map((output, i) => ({ id: randomUUID(), status: output.status || "completed", extension: output.extension || "png", createdAt: `2026-10-0${index + 1}T00:00:0${i}Z`, prompt: "PRIVATE PROMPT", aspectRatio: { width: 1, height: 1 } })) };
    await writeFile(join(dir, `${job.id}.json`), JSON.stringify(job));
    await writeFile(join(dir, `${job.id}.png`), source);
    for (const [i, output] of outputs.entries()) if (output.bytes) await writeFile(join(dir, `${job.generations[i].id}-generated.${output.extension}`), output.bytes);
    jobs.push(job);
  }
  if (skipMigration) await writeFile(join(dir, `${randomUUID()}.json`), "damaged unrelated record");
  const app = await createBridge({ dataDir: dir, models: { close() {} }, cli: { close() {} } });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(async () => { const closed = new Promise(resolve => app.server.close(resolve)); app.server.closeAllConnections(); await closed; await rm(dir, { recursive: true, force: true }); });
  const request = (path, options = {}) => fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
    ...options, headers: { Authorization: `Bearer ${app.token}`, ...options.headers },
  });
  const projects = await (await request("/projects")).json();
  const hiddenId = projects.find(item => item.title === "隐藏项目").id;
  await request("/projects/visibility", post({ ids: [hiddenId], hidden: true }));
  return { request, jobs, dir, hiddenId, visibleId: projects.find(item => item.id !== hiddenId).id };
}

test("gallery returns paged metadata with EXIF dimensions, stable order and all prompt versions", async t => {
  const { request, jobs } = await setup(t);
  const all = await (await request("/gallery")).json();
  assert.equal(all.total, 3);
  assert.equal(all.totalWorks, 3);
  assert.equal(all.projectCount, 1);
  assert.equal(all.projects.length, 1);
  assert.deepEqual(all.items.map(item => item.id), [jobs[1].generations[0].id, jobs[0].generations[1].id, jobs[0].generations[0].id]);
  assert.deepEqual(all.items.map(item => [item.width, item.height, item.version]), [[90, 30, 2], [40, 80, 1], [40, 40, 1]]);
  assert.ok(!JSON.stringify(all).includes("PRIVATE PROMPT"));
  assert.ok(all.items.every(item => item.hidden === false));
  for (const item of all.items) for (const key of ["image", "imageAsset", "asset", "prompt", "path"]) assert.ok(!(key in item));
  const first = await (await request("/gallery?limit=1")).json();
  const rest = await (await request("/gallery?offset=1&limit=2")).json();
  assert.equal(first.revision, rest.revision);
  assert.deepEqual([...first.items, ...rest.items], all.items);
  assert.equal((await (await request("/gallery?offset=999")).json()).items.length, 0);
  assert.deepEqual((await (await request("/gallery?sort=oldest")).json()).items.map(item => item.id), [...all.items].reverse().map(item => item.id));
});

test("gallery filters after hidden exclusion and revises on visibility and deletion", async t => {
  const { request, hiddenId, visibleId } = await setup(t);
  for (const ratio of ["portrait", "landscape", "square"]) {
    const result = await (await request(`/gallery?ratio=${ratio}`)).json();
    assert.equal(result.total, 1);
    assert.equal(result.totalWorks, 3);
  }
  assert.equal((await (await request("/gallery?search=初稿")).json()).total, 2);
  assert.equal((await (await request(`/gallery?projectId=${hiddenId}`)).json()).total, 0);
  assert.equal((await (await request("/gallery?search=隐藏")).json()).total, 0);
  const included = await (await request("/gallery?includeHidden=true")).json();
  assert.equal(included.totalWorks, 4);
  assert.equal(included.projectCount, 2);
  assert.ok(included.items.every(item => item.hidden === (item.projectId === hiddenId)));
  await request("/projects/visibility", post({ ids: [hiddenId], hidden: false }));
  const shown = await (await request("/gallery")).json();
  assert.notEqual(shown.revision, included.revision);
  assert.equal(shown.total, 4);
  assert.ok(shown.items.every(item => item.hidden === false));
  await request("/projects/delete", post({ ids: [visibleId] }));
  const removed = await (await request("/gallery")).json();
  assert.notEqual(removed.revision, shown.revision);
  assert.equal(removed.total, 1);
  assert.equal(removed.projectCount, 1);
});

test("gallery requires authentication and validates pagination and filters", async t => {
  const { request } = await setup(t);
  assert.equal((await request("/gallery", { headers: { Authorization: "" } })).status, 401);
  assert.equal((await request("/gallery", { headers: { Origin: "https://example.com" } })).status, 403);
  for (const query of ["offset=-1", "offset=1.2", "offset=9007199254740992", "limit=0", "limit=101", "projectId=../secret", "ratio=invalid", "sort=invalid", "includeHidden=1", "search=" + "a".repeat(201), "limit=1&limit=2", "path=secret"]) {
    assert.equal((await request(`/gallery?${query}`)).status, 400, query);
  }
});

test("gallery and thumbnails retain legacy results when unrelated damage blocks image migration", async t => {
  const { request, jobs, dir } = await setup(t, true);
  const recordPath = join(dir, "records", `${jobs[0].id}.json`);
  const before = await readFile(recordPath);
  assert.equal(JSON.parse(before).generations[0].imageAsset, undefined);
  const gallery = await (await request("/gallery")).json();
  assert.equal(gallery.total, 3, "valid PNG/JPEG results remain visible while broken and missing files are excluded");
  for (const item of gallery.items) {
    const path = `/jobs/${item.jobId}/generations/${item.generationId}`;
    const originalResponse = await request(`${path}/image`);
    assert.equal(originalResponse.status, 200);
    const original = await originalResponse.json();
    assert.deepEqual([item.width, item.height], [original.width, original.height]);
    const bytes = await readFile(original.path);
    const thumbnailResponse = await request(`${path}/thumbnail`);
    assert.equal(thumbnailResponse.status, 200);
    const thumbnail = await thumbnailResponse.json();
    const metadata = await sharp(Buffer.from(thumbnail.image.split(",")[1], "base64")).metadata();
    assert.deepEqual([metadata.width, metadata.height], [item.width, item.height]);
    assert.deepEqual(await readFile(original.path), bytes);
    assert.deepEqual(await (await request(`${path}/thumbnail`)).json(), thumbnail, "legacy derived cache is reusable");
  }
  assert.deepEqual(await readFile(recordPath), before, "browsing must not migrate or rewrite old generations");
  assert.equal((await request(`/jobs/${jobs[1].id}/generations/${jobs[1].generations[3].id}/thumbnail`)).status, 404);
});
