import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createBridge, decodeImage } from "../bridge/server.mjs";
import { projectIdFor } from "../bridge/projects.mjs";

test("deleting a project removes every lane and owned image, preserves others and stays deleted after restart", async (t) => {
  const { request, dir, restart } = await setup(t);
  const keep = await (await request("/projects", post({ image: otherImage }))).json();
  const token = await readFile(join(dir, "config", "token"));
  const removedJobs = [];
  for (const mode of ["style", "recreate", "reenact"]) {
    const response = await request("/jobs", post({ image, mode, ...(mode !== "recreate" ? { reenact: { subjectImage: otherImage, basePrompt: "保留主体" } } : {}) }));
    const job = await settled(request, (await response.json()).id);
    await request(`/jobs/${job.id}/generations`, post({ language: "zh" }));
    removedJobs.push(await settled(request, job.id));
  }
  const projectId = removedJobs[0].projectId;
  await writeFile(join(dir, "user-download.png"), "user file");
  const response = await request("/projects/delete", post({ ids: [projectId] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deletedIds: [projectId] });
  for (const job of removedJobs) {
    assert.equal((await request(`/jobs/${job.id}`)).status, 404);
    assert.equal((await request(`/jobs/${job.id}/reference`)).status, 404);
    assert.equal((await request(`/jobs/${job.id}/generations/${job.generations[0].id}/image`)).status, 404);
  }
  const files = await readdir(join(dir, "records"));
  assert.ok(!files.some((name) => name.includes(projectId) || removedJobs.some((job) => name.includes(job.id) || job.generations.some((item) => name.includes(item.id)))));
  assert.equal(await readFile(join(dir, "user-download.png"), "utf8"), "user file");
  assert.deepEqual(await readFile(join(dir, "config", "token")), token);
  await restart();
  assert.deepEqual((await (await request("/projects")).json()).map((item) => item.id), [keep.id]);
  assert.equal((await request(`/projects/${projectId}/reference`)).status, 404);
  assert.equal((await (await request(`/projects/${keep.id}/reference`)).json()).image, otherImage);
  const recreated = await (await request("/projects", post({ image }))).json();
  assert.equal(recreated.id, projectId);
  assert.equal(recreated.jobCount, 0);
  assert.deepEqual(recreated.jobs, []);
});

test("bulk deletion validates the full batch, requires authentication, and handles repeats", async (t) => {
  const { request, restart } = await setup(t);
  const first = await (await request("/projects", post({ image }))).json();
  const second = await (await request("/projects", post({ image: otherImage }))).json();
  const body = post({ ids: [first.id, second.id] });
  assert.equal((await request("/projects/delete", { ...body, headers: { Authorization: "" } })).status, 401);
  assert.equal((await request("/projects/delete", { ...body, headers: { Origin: "https://pinterest.com" } })).status, 403);
  for (const ids of [[], [first.id, "../token"], [null], first.id, Array(1001).fill(first.id)]) {
    assert.equal((await request("/projects/delete", post({ ids }))).status, 400);
    assert.equal((await (await request("/projects")).json()).length, 2);
  }
  const responses = await Promise.all([request("/projects/delete", body), request("/projects/delete", post({ ids: [first.id, first.id] }))]);
  assert.ok(responses.every((response) => response.status === 200));
  await restart();
  assert.deepEqual(await (await request("/projects")).json(), []);
});

for (const task of ["analysis", "generation"]) test(`a running ${task} blocks its whole deletion batch without touching other projects`, async (t) => {
  let finish;
  const wait = () => new Promise((resolve) => { finish = resolve; });
  const { request } = await setup(t, task === "analysis" ? { agent: wait } : { generator: wait });
  const keep = await (await request("/projects", post({ image: otherImage }))).json();
  const job = await (await request("/jobs", post({ image, mode: "recreate" }))).json();
  if (task === "generation") {
    await settled(request, job.id);
    await request(`/jobs/${job.id}/generations`, post({ language: "zh" }));
  }
  const ids = [keep.id, job.projectId];
  assert.equal((await request("/projects/delete", post({ ids }))).status, 409);
  assert.equal((await (await request("/projects")).json()).length, 2);
  assert.equal((await (await request(`/projects/${job.projectId}`)).json()).busy, true);
  // Unrelated idle projects remain deletable while Codex is working.
  assert.equal((await request("/projects/delete", post({ ids: [keep.id] }))).status, 200);
  finish(task === "analysis" ? result : decodeImage(image));
  await settled(request, job.id);
  assert.equal((await request("/projects/delete", post({ ids: [job.projectId] }))).status, 200);
});

test("startup finishes an interrupted deletion before importing its old jobs", async (t) => {
  const id = "00000000-0000-0000-0000-000000000007";
  const projectId = projectIdFor(decodeImage(image).bytes);
  const { request, dir } = await setup(t, {}, async (dir) => {
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ id, projectId, createdAt: new Date().toISOString(), status: "completed", mode: "style", result }));
    await writeFile(join(dir, `${id}.png`), decodeImage(image).bytes);
    await writeFile(join(dir, ".project-deletion.json"), JSON.stringify([`${id}.json`, `${id}.png`, `project-${projectId}.json`]));
  });
  assert.deepEqual(await (await request("/projects")).json(), []);
  assert.deepEqual(await (await request("/jobs")).json(), []);
  assert.ok(!(await readdir(join(dir, "records"))).includes(".project-deletion.json"));
});

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
const otherImage = "data:image/jpeg;base64,/9j/2Q==";
const result = { title: "模板项目", observations: ["观察"], promptZh: "中文提示词", promptEn: "English prompt", negativePrompt: "排除项", uncertainties: [] };
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

test("recreate then reenact stores exactly four distinct images and keeps both outputs after restart", async (t) => {
  const outputs = ["recreate-result", "reenact-result"].map((label) => ({ bytes: Buffer.concat([decodeImage(image).bytes, Buffer.from(label)]), extension: "png" }));
  const calls = [];
  const { request, dir, restart } = await setup(t, {
    generator: async (args) => { calls.push(args); return outputs[calls.length - 1]; },
  });
  const jobs = [];
  for (const mode of ["recreate", "reenact"]) {
    const created = await (await request("/jobs", post({ image, mode, ...(mode === "reenact" ? { reenact: { subjectImage: otherImage, basePrompt: "重演" } } : {}) }))).json();
    await settled(request, created.id);
    assert.equal((await request(`/jobs/${created.id}/generations`, post({ language: "zh", ...(mode === "reenact" ? { subjectImage: otherImage } : {}) }))).status, 202);
    jobs.push(await settled(request, created.id));
  }
  assert.equal(jobs[0].projectId, jobs[1].projectId);
  assert.equal(jobs[0].imageAsset, jobs[1].imageAsset);
  assert.equal(jobs[1].subjectAsset, jobs[1].generations[0].subjectAsset);
  assert.equal(calls[0].imagePath, undefined);
  assert.deepEqual(await readFile(calls[1].imagePath), decodeImage(image).bytes);
  assert.deepEqual(await readFile(calls[1].subjectImagePath), decodeImage(otherImage).bytes);
  assert.equal((await readdir(join(dir, "images"))).length, 4);
  assert.ok(!(await readdir(dir)).some((file) => /\.(png|jpeg|webp)$/.test(file)));
  await restart();
  for (const [index, job] of jobs.entries()) {
    const output = await (await request(`/jobs/${job.id}/generations/${job.generations[0].id}/image`)).json();
    assert.deepEqual(await readFile(output.path), outputs[index].bytes);
  }
  assert.equal((await readdir(join(dir, "images"))).length, 4);
});

test("deleting one project preserves images referenced as another project's subject and output", async (t) => {
  const { request, dir, restart } = await setup(t);
  const removed = await (await request("/projects", post({ image }))).json();
  const created = await (await request("/jobs", post({ image: otherImage, mode: "reenact", reenact: { subjectImage: image, basePrompt: "重演" } }))).json();
  await settled(request, created.id);
  await request(`/jobs/${created.id}/generations`, post({ language: "zh", subjectImage: image }));
  const job = await settled(request, created.id);
  assert.equal(job.subjectAsset, job.generations[0].imageAsset);
  assert.equal((await request("/projects/delete", post({ ids: [removed.id] }))).status, 200);
  await restart();
  assert.equal((await (await request(`/jobs/${job.id}/reference`)).json()).reenact.subjectImage, image);
  assert.equal((await (await request(`/jobs/${job.id}/generations/${job.generations[0].id}/image`)).json()).image, image);
  assert.equal((await readdir(join(dir, "images"))).length, 2);
  await request("/projects/delete", post({ ids: [job.projectId] }));
  assert.deepEqual(await readdir(join(dir, "images")), []);
});

test("deletion defers image collection while another project generates, including a reused output", async (t) => {
  let finish;
  const { request, dir } = await setup(t, { generator: () => new Promise((resolve) => { finish = resolve; }) });
  const removed = await (await request("/projects", post({ image }))).json();
  const unused = await (await request("/projects", post({ image: `data:image/png;base64,${Buffer.concat([decodeImage(image).bytes, Buffer.from("unused")]).toString("base64")}` }))).json();
  const created = await (await request("/jobs", post({ image: otherImage, mode: "recreate" }))).json();
  await settled(request, created.id);
  await request(`/jobs/${created.id}/generations`, post({ language: "zh" }));
  assert.equal((await request("/projects/delete", post({ ids: [removed.id, unused.id] }))).status, 200);
  assert.equal((await readdir(join(dir, "images"))).length, 3, "collection waits for inference to settle");
  finish(decodeImage(image));
  const job = await settled(request, created.id);
  assert.equal((await (await request(`/jobs/${job.id}/generations/${job.generations[0].id}/image`)).json()).image, image);
  // This POST also waits for any deferred collection ahead of it.
  await request("/projects", post({ image: otherImage }));
  assert.equal((await readdir(join(dir, "images"))).length, 2, "the last completed task triggers deferred collection");
  await request("/projects/delete", post({ ids: [job.projectId] }));
  assert.deepEqual(await readdir(join(dir, "images")), []);
});

for (const mode of ["style", "reenact"]) test(`${mode} generates with the latest uploaded subject, preserves earlier inputs, and restores after restart`, async (t) => {
  let analyses = 0;
  const calls = [];
  const originalSubject = `data:image/png;base64,${Buffer.concat([decodeImage(image).bytes, Buffer.from("original-subject")]).toString("base64")}`;
  const { request, dir, restart } = await setup(t, {
    agent: async () => { analyses++; return result; },
    generator: async (args) => { calls.push(args); return decodeImage(image); },
  });
  const created = await (await request("/jobs", post({ image, mode, reenact: { subjectImage: originalSubject, basePrompt: "保留主体" } }))).json();
  const job = await settled(request, created.id);
  const path = `/jobs/${job.id}/generations`;
  for (const subjectImage of [null, "", "bad-image", "data:image/png;base64,aGVsbG8=", `data:image/png;base64,${Buffer.concat([decodeImage(image).bytes, Buffer.alloc(2 * 1024 * 1024)]).toString("base64")}`]) {
    assert.equal((await request(path, post({ language: "zh", subjectImage }))).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await request(path, post({ language: "zh", subjectImage: otherImage }))).status, 202);
  const first = await settled(request, job.id);
  assert.deepEqual(await readFile(calls[0].subjectImagePath), decodeImage(otherImage).bytes);
  assert.deepEqual(await readFile(join(dir, "images", job.subjectAsset)), decodeImage(originalSubject).bytes, "reverse input remains unchanged");
  assert.equal(calls[0].prompt, result.promptZh);
  assert.equal(calls[0].negativePrompt, result.negativePrompt);
  assert.equal(first.generations[0].subjectExtension, "jpeg");
  await restart();
  const restored = await (await request(`/jobs/${job.id}/reference`)).json();
  assert.equal(restored.generationSubjectImage, otherImage);
  assert.equal(restored.reenact.subjectImage, originalSubject);
  // A fresh upload must also work when the original reverse subject is gone.
  await rm(join(dir, "images", job.subjectAsset));
  assert.equal((await request(path, post({ language: "en", subjectImage: image }))).status, 202);
  const second = await settled(request, job.id);
  assert.deepEqual(await readFile(calls[1].subjectImagePath), decodeImage(image).bytes);
  assert.notEqual(calls[0].subjectImagePath, calls[1].subjectImagePath);
  assert.deepEqual(await readFile(calls[0].subjectImagePath), decodeImage(otherImage).bytes, "new uploads never overwrite earlier generation snapshots");
  assert.deepEqual(second.generations[0], first.generations[0]);
  assert.equal((await (await request(`${path}/${first.generations[0].id}/reference`)).json()).image, otherImage);
  assert.equal((await (await request(`${path}/${second.generations[1].id}/reference`)).json()).image, image);
  assert.deepEqual(second.result, result);
  assert.equal(analyses, 1, "changing the generation subject does not rerun analysis");
  await restart();
  assert.equal((await (await request(`/jobs/${job.id}/reference`)).json()).generationSubjectImage, image);
  assert.equal((await request("/projects/delete", post({ ids: [job.projectId] }))).status, 200);
  for (const call of calls) await assert.rejects(readFile(call.subjectImagePath), { code: "ENOENT" });
});

async function setup(t, options = {}, prepare) {
  const dir = await mkdtemp(join(tmpdir(), "alchemy-projects-"));
  const skillPath = join(dir, "SKILL.md");
  await writeFile(join(dir, "model-settings.json"), JSON.stringify({ model: "test-model", accountKey: "test" }));
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
    if (job.status !== "running" && !job.generations?.some((item) => item.status === "running") && !(await (await request("/health")).json()).active) return job;
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
  assert.deepEqual(await readFile(join(dir, "images", `${first.id}.png`)), decodeImage(image).bytes);
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
  assert.equal(style.imageAsset, newerStyle.imageAsset, "versions share the template file");
  assert.equal((await (await request(`${path}/reference`)).json()).image, image, "project and jobs resolve the same template");
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
    const persisted = JSON.parse(await readFile(join(dir, "records", `${original.id}.json`), "utf8"));
    assert.match(persisted.projectId, /^[a-f0-9]{64}$/);
    const { projectId, imageAsset, ...unchanged } = persisted;
    if (unchanged.generations) unchanged.generations = unchanged.generations.map(({ imageAsset, subjectAsset, ...generation }) => generation);
    assert.deepEqual(unchanged, original, "migration must preserve all prior job data");
  }
  const migrated = JSON.parse(await readFile(join(dir, "records", `${originals[0].id}.json`)));
  assert.deepEqual(await readFile(join(dir, "images", migrated.generations[0].imageAsset)), decodeImage(image).bytes);
  await assert.rejects(readFile(join(dir, "old-generation-generated.png")), { code: "ENOENT" });
  const missingJob = await (await request(`/jobs/${originals[35].id}`)).json();
  const missingProjectId = missingJob.projectId;
  assert.equal((await request(`/projects/${missingProjectId}/reference`)).status, 404);
  assert.deepEqual(missingJob.result, result);
  await restart();
  assert.equal((await (await request("/projects")).json()).length, 35);
  assert.equal((await (await request(`/jobs/${originals[35].id}`)).json()).projectId, missingProjectId);
  assert.equal((await (await request(`/projects/${group.id}`)).json()).jobCount, 2);
  assert.equal((await request("/projects/delete", post({ ids: [group.id] }))).status, 200, "legacy generation IDs remain deletable");
  await assert.rejects(readFile(join(dir, "old-generation-generated.png")), { code: "ENOENT" });
});

for (const mode of ["recreate", "style", "reenact"]) test(`${mode} saves edited prompts, isolates versions, and preserves submitted generation inputs`, async (t) => {
  const calls = [];
  let finish;
  const { request, restart } = await setup(t, {
    generator: (args) => { calls.push(args); return new Promise((resolve) => { finish = () => resolve(decodeImage(image)); }); },
  });
  const input = { image, mode, ...(mode !== "recreate" ? { reenact: { subjectImage: otherImage, basePrompt: "原始任务指令" } } : {}) };
  const job = await settled(request, (await (await request("/jobs", post(input))).json()).id);
  const other = await settled(request, (await (await request("/jobs", post(input))).json()).id);
  const path = `/jobs/${job.id}/prompt`;
  const edits = { promptZh: "自定义中文\n保留换行", promptEn: "Custom English prompt", negativePrompt: "自定义排除项" };
  assert.equal((await request(path, { ...post(edits), headers: { Authorization: "" } })).status, 401);
  for (const invalid of [null, 7, "", "   ", "x".repeat(20001)])
    assert.equal((await request(path, post({ ...edits, promptZh: invalid }))).status, 400);
  assert.equal((await request(path, post({ ...edits, negativePrompt: null }))).status, 400);
  assert.deepEqual((await (await request(`/jobs/${job.id}`)).json()).result, result);
  assert.equal((await request(path, post({ ...edits, title: "ignored", observations: [] }))).status, 200);
  assert.equal((await request(`/jobs/${job.id}/generations`, post({ language: "zh" }))).status, 202);
  assert.equal(calls[0].prompt, edits.promptZh);
  assert.equal(calls[0].negativePrompt, edits.negativePrompt);
  const later = { ...edits, promptZh: "下一张图的提示词", negativePrompt: "" };
  assert.equal((await request(path, post(later))).status, 200);
  finish();
  const saved = await settled(request, job.id);
  assert.deepEqual(saved.result, { ...result, ...later });
  assert.equal(saved.generations[0].prompt, edits.promptZh);
  assert.equal(saved.generations[0].negativePrompt, edits.negativePrompt);
  assert.deepEqual((await (await request(`/jobs/${other.id}`)).json()).result, result);
  await restart();
  assert.deepEqual((await (await request(`/jobs/${job.id}`)).json()).result, { ...result, ...later });
  assert.equal((await request(`/jobs/${job.id}/generations`, post({ language: "en" }))).status, 202);
  assert.equal(calls[1].prompt, later.promptEn);
  assert.equal(calls[1].negativePrompt, "");
  finish();
  await settled(request, job.id);
});
