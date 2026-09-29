import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createBridge, decodeImage } from "../bridge/server.mjs";
import { agentInput, parseResult } from "../bridge/agent.mjs";
import { generationInput } from "../bridge/generation.mjs";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
const result = {
  title: "测试",
  observations: ["观察"],
  promptZh: "[SUBJECT]，柔和的色块",
  promptEn: "[SUBJECT], soft blocks of color",
  negativePrompt: "",
  uncertainties: [],
};
async function setup(t, agent = async () => result, generator) {
  const dir = await mkdtemp(join(tmpdir(), "alchemy-test-"));
  const skillPath = join(dir, "SKILL.md");
  await writeFile(skillPath, "---\nname: alchemy\n---\nTest skill");
  const app = await createBridge({ dataDir: dir, skillPath, agent, generator, generationSkillPath: skillPath });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return {
    ...app,
    dir,
    url,
    request: (path, options = {}) =>
      fetch(url + path, {
        ...options,
        headers: {
          Authorization: `Bearer ${app.token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      }),
  };
}

async function waitGeneration(request, id, status) {
  for (let i = 0; i < 100; i++) {
    const job = await (await request(`/jobs/${id}`)).json();
    if (job.generations?.at(-1)?.status === status && !(await (await request("/health")).json()).active) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Generation did not reach ${status}`);
}

test("imagegen receives exact prompt, exclusions, explicit skill and ordered real images", () => {
  const args = { imagePath: "/reference.png", subjectImagePath: "/subject.png", prompt: "保留图 1 的睁眼表情", negativePrompt: "不改变双手姿态", skillPath: "/imagegen/SKILL.md" };
  const input = generationInput(args);
  assert.deepEqual(input.filter((x) => x.type === "localImage").map((x) => x.path), [args.subjectImagePath, args.imagePath]);
  assert.deepEqual(input.at(-1), { type: "skill", name: "imagegen", path: args.skillPath });
  assert.ok(input[0].text.includes(JSON.stringify({ prompt: args.prompt, negativePrompt: args.negativePrompt })));
  assert.equal(generationInput({ ...args, subjectImagePath: undefined }).filter((x) => x.type === "localImage").length, 1);
  assert.throws(() => generationInput({ ...args, prompt: "Draw [SUBJECT]" }), /补充主体/);
});

for (const mode of ["style", "reenact", "recreate"]) test(`${mode} generates from saved inputs and preserves prompt and previous images`, async (t) => {
  const paired = mode !== "recreate";
  const finalResult = { ...result, promptZh: "中文生成提示词", promptEn: "English generation prompt", negativePrompt: "排除项" };
  const calls = [];
  const { request, dir, url } = await setup(t, async () => finalResult, async (args) => {
    calls.push(args);
    return { bytes: decodeImage(image).bytes, extension: "png", revisedPrompt: "actual image prompt" };
  });
  const created = await (await request("/jobs", submit({ mode, ...(paired ? { reenact: { subjectImage: image, basePrompt: "保留主体" } } : {}) }))).json();
  await waitFor(request, created.id, "completed");
  const path = `/jobs/${created.id}/generations`;
  assert.equal((await request(path, { method: "POST", body: JSON.stringify({ language: "other" }) })).status, 400);
  const generate = (language) => request(path, { method: "POST", body: JSON.stringify({ language, imagePath: "/ignored-user-path" }) });
  assert.equal((await generate("en")).status, 202);
  const first = await waitGeneration(request, created.id, "completed");
  assert.equal(calls[0].prompt, finalResult.promptEn);
  assert.equal(calls[0].negativePrompt, finalResult.negativePrompt);
  assert.deepEqual(await readFile(calls[0].imagePath), decodeImage(image).bytes);
  assert.equal(!!calls[0].subjectImagePath, paired);
  if (paired) assert.deepEqual(await readFile(calls[0].subjectImagePath), decodeImage(image).bytes);
  const generated = first.generations[0];
  const imagePath = `${path}/${generated.id}/image`;
  assert.equal((await fetch(url + imagePath)).status, 401);
  assert.equal((await request(imagePath, { headers: { Origin: "https://example.com" } })).status, 403);
  assert.equal((await (await request(imagePath)).json()).image, image);
  assert.equal((await generate("zh")).status, 202);
  const second = await waitGeneration(request, created.id, "completed");
  assert.equal(calls[1].prompt, finalResult.promptZh);
  assert.deepEqual(second.result, finalResult);
  assert.equal(second.generations.length, 2);
  assert.deepEqual(second.generations[0], first.generations[0]);
  assert.equal((await (await request(imagePath)).json()).image, image);
  assert.equal(JSON.parse(await readFile(join(dir, `${created.id}.json`))).generations.length, 2);
  await rm(join(dir, `${generated.id}-generated.png`));
  assert.equal((await request(imagePath)).status, 404);
  await rm(join(dir, `${created.id}${paired ? "-subject" : ""}.png`));
  assert.equal((await generate("zh")).status, 404);
  assert.equal(calls.length, 2);
});

test("generation rejects generic prompts, prevents duplicates and preserves cancelled jobs", async (t) => {
  let finish;
  const { request } = await setup(t, async () => ({ ...result, promptZh: "实际主体" }), () => new Promise((resolve) => { finish = resolve; }));
  const generic = await (await request("/jobs", submit())).json();
  await waitFor(request, generic.id, "completed");
  assert.equal((await request(`/jobs/${generic.id}/generations`, { method: "POST", body: '{"language":"zh"}' })).status, 400);
  const created = await (await request("/jobs", submit({ mode: "recreate" }))).json();
  await waitFor(request, created.id, "completed");
  const path = `/jobs/${created.id}/generations`;
  const body = { method: "POST", body: '{"language":"zh"}' };
  const responses = await Promise.all([request(path, body), request(path, body)]);
  assert.deepEqual(responses.map((x) => x.status).sort(), [202, 409]);
  assert.equal((await request("/jobs", submit())).status, 409);
  const job = await (await request(`/jobs/${created.id}`)).json();
  const generated = job.generations[0];
  assert.equal((await request(`${path}/${generated.id}/image`)).status, 409);
  const cancelled = await (await request(`${path}/${generated.id}/cancel`, { method: "POST" })).json();
  assert.equal(cancelled.generations[0].status, "cancelled");
  finish({ bytes: decodeImage(image).bytes, extension: "png" });
  const after = await waitGeneration(request, created.id, "cancelled");
  assert.equal(after.status, "completed");
  assert.equal(after.generations[0].extension, undefined);
});

test("generation failures preserve analysis and never invent an image", async (t) => {
  const { request } = await setup(t, async () => ({ ...result, promptZh: "确定的主体" }), async () => { throw new Error("当前 Codex 不支持内置生图"); });
  const created = await (await request("/jobs", submit({ mode: "recreate" }))).json();
  await waitFor(request, created.id, "completed");
  await request(`/jobs/${created.id}/generations`, { method: "POST", body: '{"language":"zh"}' });
  const failed = await waitGeneration(request, created.id, "failed");
  assert.equal(failed.status, "completed");
  assert.match(failed.generations[0].error, /不支持内置生图/);
  assert.equal(failed.generations[0].extension, undefined);
});
const submit = (extra) => ({
  method: "POST",
  body: JSON.stringify({ image, mode: "style", ...extra }),
});
async function waitFor(request, id, status) {
  for (let i = 0; i < 80; i++) {
    const job = await (await request(`/jobs/${id}`)).json();
    if (job.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Task did not reach ${status}`);
}

test("rejects unauthenticated, web-origin and DNS-rebinding requests", async (t) => {
  const { url, request } = await setup(t);
  assert.equal((await fetch(url + "/health")).status, 401);
  assert.equal(
    (await request("/health", { headers: { Origin: "https://pinterest.com" } }))
      .status,
    403,
  );
  const rebound = await new Promise((resolve) => {
    httpRequest(
      url + "/health",
      { headers: { Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    ).end();
  });
  assert.equal(rebound, 403);
  const health = await request("/health", {
    headers: { Origin: "chrome-extension://" + "a".repeat(32) },
  });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).skill, "alchemy");
});

test("validates image bytes and request shape before invoking agent", async (t) => {
  let calls = 0;
  const { request } = await setup(t, async () => {
    calls++;
    return result;
  });
  for (const body of [
    null,
    [],
    { image, mode: "bad" },
    { image: "data:image/png;base64,aGVsbG8=", mode: "style" },
  ]) {
    assert.equal(
      (await request("/jobs", { method: "POST", body: JSON.stringify(body) }))
        .status,
      400,
    );
  }
  assert.equal(calls, 0);
  assert.throws(() => decodeImage("data:image/svg+xml;base64,PHN2Zz4="));
});

test("sends actual image bytes to agent, persists result, strips URL query", async (t) => {
  let input;
  const { request, dir } = await setup(t, async (args) => {
    input = args;
    args.onProgress({ threadId: "test-thread" });
    return result;
  });
  const response = await request(
    "/jobs",
    submit({ sourceUrl: "https://example.com/pin/123?secret=value#fragment" }),
  );
  assert.equal(response.status, 202);
  const created = await response.json();
  const completed = await waitFor(request, created.id, "completed");
  assert.deepEqual(completed.result, result);
  assert.equal(completed.sourceUrl, "https://example.com/pin/123");
  assert.equal(completed.threadId, "test-thread");
  assert.equal(input.mode, "style");
  assert.deepEqual(await readFile(input.imagePath), decodeImage(image).bytes);
  // Persist finishes immediately after the in-memory transition.
  for (let i = 0; i < 80; i++) {
    try {
      if (
        JSON.parse(await readFile(join(dir, `${created.id}.json`))).status ===
        "completed"
      )
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Result was not persisted");
});

test("limits concurrent jobs and cancels a running agent", async (t) => {
  const { request } = await setup(
    t,
    ({ signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      ),
  );
  const job = await (await request("/jobs", submit())).json();
  assert.equal((await request("/jobs", submit())).status, 409);
  const cancelled = await (
    await request(`/jobs/${job.id}/cancel`, { method: "POST" })
  ).json();
  assert.equal(cancelled.status, "cancelled");
  await waitFor(request, job.id, "cancelled");
});

test("history restores the exact image for a new mode and preserves both results", async (t) => {
  const inputs = [];
  const { request, dir, url } = await setup(t, async ({ imagePath, mode }) => {
    inputs.push({ bytes: await readFile(imagePath), mode });
    return { ...result, title: mode };
  });
  const first = await (await request("/jobs", submit({ capture: "screenshot", sourceUrl: "https://example.com/art" }))).json();
  await waitFor(request, first.id, "completed");
  const path = `/jobs/${first.id}/reference`;
  assert.equal((await fetch(url + path)).status, 401);
  assert.equal((await request(path, { headers: { Origin: "https://example.com" } })).status, 403);
  const reference = await (await request(path)).json();
  assert.equal(reference.image, image);
  assert.equal(reference.capture, "screenshot");
  const second = await (await request("/jobs", submit({ ...reference, mode: "recreate" }))).json();
  await waitFor(request, second.id, "completed");
  assert.notEqual(first.id, second.id);
  assert.deepEqual(inputs.map(x => x.mode), ["style", "recreate"]);
  assert.deepEqual(inputs[0].bytes, inputs[1].bytes);
  const history = await (await request("/jobs")).json();
  assert.equal(history.length, 2);
  assert.equal(history.find(x => x.id === first.id).result.title, "style");
  assert.equal(history.find(x => x.id === second.id).result.title, "recreate");
  await rm(join(dir, `${first.id}.png`));
  const missing = await request(path);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /原图已不存在/);
  assert.equal((await request(`/jobs/${first.id}`)).status, 200);
});

test("reports agent failure without inventing a result", async (t) => {
  const { request } = await setup(t, async () => {
    throw new Error("Please log in to Codex");
  });
  const created = await (await request("/jobs", submit())).json();
  const failed = await waitFor(request, created.id, "failed");
  assert.match(failed.error, /log in/);
  assert.equal(failed.result, undefined);
});

for (const mode of ["style", "reenact"]) test(`${mode} validates supplied subject inputs and template/prompt pairing before calling Codex`, async (t) => {
  let calls = 0;
  const { request } = await setup(t, async () => { calls++; return result; });
  const source = await (await request("/jobs", submit())).json();
  await waitFor(request, source.id, "completed");
  const reenact = { subjectImage: image, basePrompt: result.promptZh, promptSourceJobId: source.id };
  for (const input of [
    ...(mode === "reenact" ? [undefined] : [null]), {}, { basePrompt: "test" }, { subjectImage: image, basePrompt: " " },
    { ...reenact, subjectImage: "data:image/png;base64,aGVsbG8=" },
    { ...reenact, basePrompt: "x".repeat(20001) },
    { ...reenact, promptSourceJobId: "../../token" },
  ]) {
    assert.equal((await request("/jobs", submit({ mode, reenact: input }))).status, 400);
  }
  const otherImage = "data:image/jpeg;base64,/9j/2Q==";
  const mismatch = await request("/jobs", submit({ image: otherImage, mode, reenact }));
  assert.equal(mismatch.status, 400);
  assert.match((await mismatch.json()).error, /来源不一致/);
  assert.equal(calls, 1);
});

for (const mode of ["style", "reenact"]) test(`${mode} sends two distinct images and edited instructions, restores history, and keeps old output`, async (t) => {
  const inputs = [];
  const { request, dir } = await setup(t, async (args) => {
    inputs.push({ mode: args.mode, template: await readFile(args.imagePath), subject: args.subjectImagePath && await readFile(args.subjectImagePath), prompt: args.basePrompt });
    return result;
  });
  const source = await (await request("/jobs", submit())).json();
  await waitFor(request, source.id, "completed");
  const subjectImage = "data:image/jpeg;base64,/9j/2Q==";
  const reenact = { subjectImage, basePrompt: "Edited [SUBJECT] prompt", promptSourceJobId: source.id };
  const response = await request("/jobs", submit({ mode, reenact }));
  assert.equal(response.status, 202);
  const job = await response.json();
  await waitFor(request, job.id, "completed");
  assert.equal(inputs[1].mode, mode);
  assert.deepEqual(inputs[1].template, decodeImage(image).bytes);
  assert.deepEqual(inputs[1].subject, decodeImage(subjectImage).bytes);
  assert.equal(inputs[1].prompt, reenact.basePrompt);
  const restored = await (await request(`/jobs/${job.id}/reference`)).json();
  assert.equal(restored.image, image);
  assert.deepEqual(restored.reenact, reenact);
  const history = await (await request("/jobs")).json();
  assert.equal(history.length, 2);
  assert.deepEqual(history.find(x => x.id === source.id).result, result);
  assert.equal(history.find(x => x.id === job.id).reenact.subjectImage, undefined, "history metadata must not include full images");
  assert.equal(JSON.parse(await readFile(join(dir, `${job.id}.json`))).reenact.basePrompt, reenact.basePrompt);
  const retry = await (await request("/jobs", submit({ ...restored, mode }))).json();
  await waitFor(request, retry.id, "completed");
  assert.deepEqual(inputs[2], inputs[1]);
  await rm(join(dir, `${job.id}-subject.jpeg`));
  const missing = await (await request(`/jobs/${job.id}/reference`)).json();
  assert.equal(missing.image, image, "a missing subject must not hide the template or result");
  assert.match(missing.subjectError, /主体图已不存在/);
  assert.equal(missing.reenact.subjectImage, "");
  const generic = await (await request("/jobs", submit())).json();
  await waitFor(request, generic.id, "completed");
  assert.equal(inputs[3].subject, undefined);
  assert.equal(generic.reenact, undefined);
});

test("reenact accepts default and custom task instructions without an earlier extraction", async (t) => {
  const inputs = [];
  const { request } = await setup(t, async (args) => { inputs.push(args.basePrompt); return result; });
  const instructions = [
    "以图 1 为主体，以图 2 为风格参考模板，生成基于图 1 的风格转换与主体重演提示词。",
    "保留图 1 的正面姿势和睁眼表情，只迁移图 2 的配色与笔触。",
  ];
  for (const basePrompt of instructions) {
    const response = await request("/jobs", submit({ mode: "reenact", reenact: { subjectImage: image, basePrompt } }));
    assert.equal(response.status, 202);
    const job = await response.json();
    await waitFor(request, job.id, "completed");
    const restored = await (await request(`/jobs/${job.id}/reference`)).json();
    assert.equal(restored.reenact.basePrompt, basePrompt);
    assert.equal(restored.reenact.promptSourceJobId, undefined);
  }
  assert.deepEqual(inputs, instructions, "send the submitted instruction without appending defaults or older results");
  assert.deepEqual((await (await request("/jobs")).json()).map(job => job.mode), ["reenact", "reenact"]);
});

test("Codex receives subject first, template second, and the submitted user task instruction", () => {
  const args = { name: "alchemy", skillPath: "/skill/SKILL.md", imagePath: "/template.png", subjectImagePath: "/subject.png", basePrompt: '保留图 1 的姿势\n只迁移图 2 的"笔触"' };
  const input = agentInput({ ...args, mode: "reenact" });
  assert.deepEqual(input.filter(x => x.type === "localImage").map(x => x.path), ["/subject.png", "/template.png"]);
  assert.ok(input.find(x => x.type === "skill" && x.name === "alchemy"));
  assert.ok(input.find(x => x.type === "text" && x.text.includes(JSON.stringify(args.basePrompt))));
  for (const mode of ["style", "recreate"]) {
    const single = agentInput({ ...args, mode, subjectImagePath: undefined });
    assert.deepEqual(single.filter(x => x.type === "localImage").map(x => x.path), ["/template.png"]);
    assert.ok(!single.some(x => x.text?.includes(args.basePrompt)));
  }
  const transfer = agentInput({ ...args, mode: "style" });
  assert.deepEqual(transfer.filter(x => x.type === "localImage").map(x => x.path), ["/subject.png", "/template.png"]);
  assert.ok(transfer.some(x => x.text?.includes(JSON.stringify(args.basePrompt))));
  assert.match(transfer[0].text, /保留结构，仅迁移风格/);
  assert.match(transfer[0].text, /默认由图 1 提供主体身份、内容、姿态/);
  assert.throws(() => agentInput({ ...args, mode: "style", basePrompt: " " }), /缺少/);
  assert.deepEqual(agentInput({ ...args, mode: "recreate" }).filter(x => x.type === "localImage").map(x => x.path), ["/template.png"]);
  assert.throws(() => agentInput({ ...args, mode: "reenact", subjectImagePath: undefined }), /缺少/);
});

test("rejects malformed model output instead of reporting success", () => {
  assert.deepEqual(parseResult(JSON.stringify(result)), result);
  assert.throws(() => parseResult(JSON.stringify({ ...result, promptZh: "" })));
  assert.throws(() =>
    parseResult(JSON.stringify({ ...result, observations: [3] })),
  );
  assert.throws(() => parseResult("not JSON"));
});

test("restart preserves completed output and marks interrupted jobs as failed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "alchemy-restart-"));
  const id = "00000000-0000-0000-0000-000000000001";
  await writeFile(
    join(dir, `${id}.json`),
    JSON.stringify({ id, status: "running", createdAt: "2026-01-01" }),
  );
  const doneId = "00000000-0000-0000-0000-000000000002";
  await writeFile(
    join(dir, `${doneId}.json`),
    JSON.stringify({
      id: doneId,
      status: "completed",
      createdAt: "2026-01-02",
      result,
      generations: [
        { id: "old", status: "completed", extension: "png" },
        { id: "interrupted", status: "running" },
      ],
    }),
  );
  await writeFile(join(dir, `${doneId}.png`), decodeImage(image).bytes);
  const { server, token } = await createBridge({ dataDir: dir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const jobs = await (
    await fetch(`http://127.0.0.1:${server.address().port}/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  assert.deepEqual(jobs.find((x) => x.id === doneId).result, result);
  assert.equal(jobs.find((x) => x.id === doneId).generations[0].status, "completed");
  assert.equal(jobs.find((x) => x.id === doneId).generations[1].status, "failed");
  assert.equal(jobs.find((x) => x.id === id).status, "failed");
  assert.match(jobs.find((x) => x.id === id).error, /重启/);
  const reference = await (await fetch(`http://127.0.0.1:${server.address().port}/jobs/${doneId}/reference`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  assert.equal(reference.image, image);
});
