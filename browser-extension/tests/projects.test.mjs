import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createBridge, decodeImage } from "../bridge/server.mjs";
import { projectIdFor } from "../bridge/projects.mjs";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
const otherImage = "data:image/jpeg;base64,/9j/2Q==";
const result = { title: "模板项目", observations: ["观察"], promptZh: "中文提示词", promptEn: "English prompt", negativePrompt: "排除项", uncertainties: [] };
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

async function setup(t, options = {}, prepare) {
  const dir = await mkdtemp(join(tmpdir(), "alchemy-projects-"));
  const skillPath = join(dir, "SKILL.md");
  await writeFile(skillPath, "---\nname: alchemy\n---\nTest skill");
  if (prepare) await prepare(dir);
  let app;
  async function start() {
    app = await createBridge({ dataDir: dir, skillPath, generationSkillPath: skillPath, agent: async () => result, generator: async () => ({ ...decodeImage(image) }), ...options });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
  }
  async function close() {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
  await start();
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }); });
  return {
    dir,
    restart: async () => { await close(); await start(); },
    request: (path, options = {}) => fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { ...options, headers: { Authorization: `Bearer ${app.token}`, "Content-Type": "application/json", ...options.headers } }),
  };
}

async function settled(request, id) {
  for (let i = 0; i < 100; i++) {
    const job = await (await request(`/jobs/${id}`)).json();
    if (job.status !== "running" && !(await (await request("/health")).json()).active) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Job did not settle");
}

test("registering templates validates images and authentication without invoking Codex", async (t) => {
  let calls = 0;
  const { request } = await setup(t, { agent: async () => { calls++; return result; }, skillPath: "/missing/skill" });
  assert.equal((await request("/projects", { headers: { Authorization: "" } })).status, 401);
  assert.equal((await request("/projects", { headers: { Origin: "https://pinterest.com" } })).status, 403);
  for (const body of [null, [], { image: "not-an-image" }, { image: "data:image/png;base64,aGVsbG8=" }]) {
    assert.equal((await request("/projects", post(body))).status, 400);
  }
  const project = await (await request("/projects", post({ image, sourceUrl: "https://pinterest.com/pin/1?secret=value#hash", capture: "screenshot" }))).json();
  assert.equal(project.id, projectIdFor(decodeImage(image).bytes));
  assert.equal(project.sourceUrl, "https://pinterest.com/pin/1");
  assert.equal(project.capture, "screenshot");
  assert.equal(project.jobCount, 0);
  assert.deepEqual(project.jobs, []);
  assert.deepEqual(project.modes, {});
  assert.deepEqual(await (await request("/jobs")).json(), []);
  assert.equal(calls, 0);
  const reference = await (await request(`/projects/${project.id}/reference`)).json();
  assert.deepEqual(reference, { id: project.id, projectId: project.id, image, sourceUrl: project.sourceUrl, capture: "screenshot" });
  assert.equal((await request(`/projects/${"0".repeat(64)}`)).status, 404);
  assert.equal((await request(`/projects/${"z".repeat(64)}/reference`)).status, 404);
  assert.equal((await request(`/projects/${project.id}/reference`, { headers: { Authorization: "" } })).status, 401);
});

test("duplicate registration and restart retain a template with no extraction jobs", async (t) => {
  const { request, restart, dir } = await setup(t);
  const responses = await Promise.all([
    request("/projects", post({ image, sourceUrl: "https://example.com/first" })),
    request("/projects", post({ image, sourceUrl: "https://example.com/second" })),
  ]);
  const [first, second] = await Promise.all(responses.map((response) => response.json()));
  assert.equal(first.id, second.id);
  assert.equal((await (await request("/projects")).json()).length, 1);
  await restart();
  const restored = await (await request(`/projects/${first.id}`)).json();
  assert.deepEqual(restored, first);
  assert.deepEqual(await (await request(`/projects/${first.id}/reference`)).json(), { id: first.id, projectId: first.id, image, sourceUrl: first.sourceUrl, capture: "original" });
  assert.deepEqual(await readFile(join(dir, `project-${first.id}.png`)), decodeImage(image).bytes);
  assert.equal((await (await request("/health")).json()).active, 0);
});

test("same template across URLs groups mode histories while each latest mode owns its outputs", async (t) => {
  const { request, restart, dir } = await setup(t);
  const create = async (mode, extra = {}) => {
    const response = await request("/jobs", post({ image, mode, sourceUrl: `https://example.com/${mode}`, ...(mode !== "recreate" ? { reenact: { subjectImage: otherImage, basePrompt: "保留主体" } } : {}), ...extra }));
    assert.equal(response.status, 202);
    return settled(request, (await response.json()).id);
  };
  const style = await create("style");
  await request(`/jobs/${style.id}/generations`, post({ language: "zh" }));
  const generated = await settled(request, style.id);
  const generation = generated.generations[0];
  assert.equal(generation.status, "completed");
  const path = `/projects/${style.projectId}`;
  const initial = await (await request(path)).json();
  assert.deepEqual(initial.modes, { style: { status: "completed", hasImage: true } });
  const reenact = await create("reenact");
  assert.equal(reenact.projectId, style.projectId);
  const twoModes = await (await request(path)).json();
  assert.deepEqual(twoModes.modes, { reenact: { status: "completed", hasImage: false }, style: { status: "completed", hasImage: true } });
  assert.equal(twoModes.modes.recreate, undefined);
  const recreate = await create("recreate");
  const newerStyle = await create("style");
  assert.equal(recreate.projectId, style.projectId);
  const project = await (await request(path)).json();
  assert.equal(project.jobCount, 4);
  assert.deepEqual(project.jobs.map((job) => job.id), [newerStyle.id, recreate.id, reenact.id, style.id]);
  assert.deepEqual(project.modes.style, { status: "completed", hasImage: false });
  assert.deepEqual(project.jobs.find((job) => job.id === style.id).generations, generated.generations);
  assert.deepEqual(project.jobs.find((job) => job.id === style.id).result, result);
  assert.equal((await (await request("/projects")).json()).length, 1);
  const imagePath = `/jobs/${style.id}/generations/${generation.id}/image`;
  assert.equal((await (await request(imagePath)).json()).image, image);
  await rm(join(dir, `${style.id}.png`));
  assert.equal((await (await request(`${path}/reference`)).json()).image, image, "project reference is independent from individual jobs");
  await restart();
  const restored = await (await request(path)).json();
  assert.equal(restored.jobCount, 4);
  assert.deepEqual(restored.jobs.find((job) => job.id === style.id).generations, generated.generations);
  assert.equal((await (await request(imagePath)).json()).image, image);
});

test("distinct template bytes stay separate and mismatched project submissions are rejected", async (t) => {
  let calls = 0;
  const { request } = await setup(t, { agent: async () => { calls++; return result; } });
  const first = await (await request("/projects", post({ image, sourceUrl: "https://example.com/same" }))).json();
  const second = await (await request("/projects", post({ image: otherImage, sourceUrl: "https://example.com/same" }))).json();
  assert.notEqual(first.id, second.id);
  for (const projectId of [first.id, "../../token", null]) {
    assert.equal((await request("/jobs", post({ image: otherImage, mode: "recreate", projectId }))).status, 400);
  }
  assert.equal(calls, 0);
  assert.deepEqual(await (await request("/jobs")).json(), []);
  const accepted = await request("/jobs", post({ image: otherImage, mode: "recreate", projectId: second.id }));
  assert.equal(accepted.status, 202);
  await settled(request, (await accepted.json()).id);
  const projects = await (await request("/projects")).json();
  assert.equal(projects.length, 2);
  assert.equal(projects.find((project) => project.id === first.id).jobCount, 0);
  assert.equal(projects.find((project) => project.id === second.id).jobCount, 1);
});

test("startup migrates every legacy job including more than 30 projects and missing images", async (t) => {
  const originals = [];
  const { request, dir, restart } = await setup(t, {}, async (dataDir) => {
    for (let index = 0; index < 36; index++) {
      const id = `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
      const job = { id, mode: index === 34 ? "reenact" : "style", status: "completed", createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), sourceUrl: `https://example.com/${index}`, result, ...(index === 0 ? { generations: [{ id: "old-generation", status: "completed", extension: "png" }] } : {}) };
      originals.push(job);
      await writeFile(join(dataDir, `${id}.json`), JSON.stringify(job));
      if (index !== 35) await writeFile(join(dataDir, `${id}.png`), Buffer.concat([decodeImage(image).bytes, Buffer.from([index === 34 ? 0 : index])]));
    }
    await writeFile(join(dataDir, "old-generation-generated.png"), decodeImage(image).bytes);
  });
  const projects = await (await request("/projects")).json();
  assert.equal(projects.length, 35, "project listing must not inherit the old 30-job limit");
  assert.equal(projects.reduce((count, project) => count + project.jobCount, 0), 36);
  assert.equal((await (await request("/jobs")).json()).length, 30, "legacy listing stays backwards compatible");
  const group = projects.find((project) => project.jobCount === 2);
  const detail = await (await request(`/projects/${group.id}`)).json();
  assert.deepEqual(detail.jobs.map((job) => job.id), [originals[34].id, originals[0].id]);
  for (const original of originals) {
    const persisted = JSON.parse(await readFile(join(dir, `${original.id}.json`), "utf8"));
    assert.match(persisted.projectId, /^[a-f0-9]{64}$/);
    const { projectId, ...unchanged } = persisted;
    assert.deepEqual(unchanged, original, "migration must preserve all prior job data");
  }
  assert.deepEqual(await readFile(join(dir, "old-generation-generated.png")), decodeImage(image).bytes);
  const missingJob = await (await request(`/jobs/${originals[35].id}`)).json();
  const missingProjectId = missingJob.projectId;
  assert.equal((await request(`/projects/${missingProjectId}/reference`)).status, 404);
  assert.deepEqual(missingJob.result, result);
  await restart();
  assert.equal((await (await request("/projects")).json()).length, 35);
  assert.equal((await (await request(`/jobs/${originals[35].id}`)).json()).projectId, missingProjectId);
  assert.equal((await (await request(`/projects/${group.id}`)).json()).jobCount, 2);
});
