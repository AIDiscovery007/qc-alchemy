import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const build = new URL("../.output/chrome-mv3/", import.meta.url);

test("model messages stay authenticated in background and only reach allowed endpoints", async () => {
  const calls = [];
  const { handlers } = await background(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ selected: null, models: [] }) };
  });
  const sender = { id: "test", frameId: 0, url: "https://pinterest.com/", tab: { id: 4 } };
  const send = message => new Promise(resolve => handlers.message(message, sender, resolve));
  assert.equal((await send({ type: "alchemy:query", path: "/models" })).ok, true);
  assert.equal((await send({ type: "alchemy:models-refresh" })).ok, true);
  assert.equal((await send({ type: "alchemy:model-verify", model: "vision-model" })).ok, true);
  assert.ok(calls.every(c => c.options.headers.Authorization === "Bearer test"));
  assert.ok(calls[0].url.endsWith("/models"));
  assert.ok(calls[1].url.endsWith("/models/refresh"));
  assert.deepEqual(JSON.parse(calls[2].options.body), { model: "vision-model" });
  assert.ok((await send({ type: "alchemy:model-verify", model: 42 })).error);
  assert.ok((await send({ type: "alchemy:query", path: "/models/../../token" })).error);
  assert.equal(calls.length, 3);
});

test("deleting projects validates ids and clears only the deleted active selection after success", async () => {
  const id = "a".repeat(64), other = "b".repeat(64);
  let fail = false;
  const calls = [];
  const { handlers, chrome } = await background(async (url, options) => {
    calls.push({ url, options });
    return { ok: !fail, json: async () => fail ? { error: "任务正在执行" } : { deletedIds: JSON.parse(options.body).ids } };
  });
  const storage = { preferences: { token: "secret" }, selection: { id, projectId: id, image: "saved image", jobId: "saved job" } };
  chrome.storage.local.get = async () => storage;
  chrome.storage.local.remove = async (key) => { delete storage[key]; };
  const sender = { id: "test", frameId: 0, url: "https://pinterest.com/", tab: { id: 4 } };
  const send = (ids) => new Promise((resolve) => handlers.message({ type: "alchemy:delete-projects", ids }, sender, resolve));
  for (const ids of [[], [id, "../token"], null, [7], Array(1001).fill(id)]) assert.ok((await send(ids)).error);
  assert.equal(calls.length, 0);
  assert.equal((await send([other])).ok, true);
  assert.equal(storage.selection.projectId, id);
  fail = true;
  assert.match((await send([id])).error, /任务正在执行/);
  assert.equal(storage.selection.image, "saved image");
  fail = false;
  assert.equal((await send([id])).ok, true);
  assert.equal(storage.selection, undefined);
  assert.ok(calls.every((call) => call.url.endsWith("/projects/delete") && call.options.headers.Authorization === "Bearer secret"));
  assert.equal(handlers.message({ type: "alchemy:delete-projects", ids: [id] }, { ...sender, id: "other" }, () => assert.fail("untrusted reply")), undefined);
});

test("generation messages keep credentials in background and constrain job endpoints", async () => {
  const calls = [];
  const { handlers } = await background(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ status: "running" }) };
  });
  const sender = { id: "test", frameId: 0, url: "https://www.pinterest.com/", tab: { id: 4 } };
  const send = (message) => new Promise((resolve) => handlers.message(message, sender, resolve));
  const id = "00000000-0000-0000-0000-000000000001";
  const generationId = "00000000-0000-0000-0000-000000000002";
  assert.equal((await send({ type: "alchemy:generate", id, language: "en" })).ok, true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { language: "en" });
  assert.equal(calls[0].options.headers.Authorization, "Bearer test");
  assert.ok(calls[0].url.endsWith(`/jobs/${id}/generations`));
  const subjectImage = "data:image/png;base64,iVBORw==";
  assert.equal((await send({ type: "alchemy:generate", id, language: "zh", subjectImage })).ok, true);
  assert.deepEqual(JSON.parse(calls[1].options.body), { language: "zh", subjectImage });
  assert.equal((await send({ type: "alchemy:generation-image", id, generationId })).ok, true);
  assert.ok(calls[2].url.endsWith(`/${generationId}/image`));
  assert.equal((await send({ type: "alchemy:generation-cancel", id, generationId })).ok, true);
  assert.ok(calls[3].url.endsWith(`/${generationId}/cancel`));
  for (const message of [
    { type: "alchemy:generate", id: "../token", language: "en" },
    { type: "alchemy:generate", id, language: "bad" },
    ...[null, "", 42, "file:///tmp/subject.png", "data:image/svg+xml;base64,PHN2Zz4=", `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`]
      .map((subjectImage) => ({ type: "alchemy:generate", id, language: "zh", subjectImage })),
    { type: "alchemy:generation-image", id, generationId: "../../token" },
  ]) assert.ok((await send(message)).error);
  assert.equal(calls.length, 4);
});

test("built extension uses a popup without declaring unsupported native side panels", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", build), "utf8"),
  );
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.side_panel, undefined);
  assert.ok(!manifest.permissions.includes("sidePanel"));
  assert.ok(!manifest.web_accessible_resources?.some((rule) => rule.resources.includes("popup.html")));
  assert.ok(
    (await readFile(new URL("popup.html", build), "utf8")).includes("root"),
  );
});

test("project messages restore a template and start only the explicitly chosen lane", async () => {
  const id = "a".repeat(64);
  const calls = [];
  const reference = { id, projectId: id, image: "saved-template", sourceUrl: "https://example.com/template", capture: "original" };
  const { handlers, chrome } = await background(async (url, options) => {
    calls.push({ url, options });
    const value = url.endsWith("/reference") ? reference : url.endsWith("/jobs") ? { id: "new-job", projectId: id, mode: "recreate", stage: "started" } : { id, jobs: [] };
    return { ok: true, json: async () => value };
  });
  const storage = { preferences: { token: "secret", mode: "style" }, selection: { id: "old", image: "old-template" } };
  chrome.storage.local.get = async () => storage;
  chrome.storage.local.set = async (value) => Object.assign(storage, value);
  const sender = { id: "test", frameId: 0, url: "https://www.pinterest.com/", tab: { id: 4 } };
  const send = (message) => new Promise(resolve => handlers.message(message, sender, resolve));
  assert.equal((await send({ type: "alchemy:query", path: "/projects" })).ok, true);
  assert.equal((await send({ type: "alchemy:open-project", id })).value.image, "saved-template");
  assert.equal(storage.selection.projectId, id);
  assert.equal(storage.selection.jobId, undefined);
  assert.ok(calls.every(call => !call.options.body), "opening a project does not start a model task");
  await send({ type: "alchemy:mode", mode: "reenact" });
  assert.equal(storage.selection.reenact, undefined, "mode selection must not copy another lane's subject");
  await send({ type: "alchemy:start", projectId: id, mode: "recreate", image: "untrusted-image" });
  const body = JSON.parse(calls.at(-1).options.body);
  assert.equal(body.image, "saved-template");
  assert.equal(body.projectId, id);
  assert.equal(body.mode, "recreate");
  assert.equal(storage.selection.jobId, "new-job");
  storage.selection = { id: "other-selection", projectId: "b".repeat(64), image: "other-template" };
  const independent = await send({ type: "alchemy:start", projectId: id, mode: "recreate" });
  assert.equal(independent.value.job.projectId, id);
  assert.equal(storage.selection.id, "other-selection", "submitting another project's job must not replace the selected project");
  const before = calls.length;
  for (const message of [
    { type: "alchemy:open-project", id: "../../token" },
    { type: "alchemy:project-reference", id: "a" },
    { type: "alchemy:query", path: `/projects/${id}/reference` },
    { type: "alchemy:query", path: "/projects/../token" },
    { type: "alchemy:start", projectId: "../../token", mode: "recreate" },
  ]) assert.match((await send(message)).error, /无效/);
  assert.equal(calls.length, before);
});

async function background(fetch = async () => ({ ok: true, json: async () => ({ status: "running" }) }), globals = {}) {
  const handlers = {};
  const messages = [];
  const tabs = [];
  const chrome = {
    runtime: {
      id: "test",
      getURL: (path) => `chrome-extension://test${path}`,
      onInstalled: {
        addListener: (fn) => {
          handlers.installed = fn;
        },
      },
      onMessage: {
        addListener: (fn) => {
          handlers.message = fn;
        },
      },
    },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({
          preferences: { token: "test" },
          selection: { id: "old", jobId: "active" },
        }),
        set: async (value) => {
          handlers.selection = value.selection;
        },
      },
    },
    contextMenus: {
      removeAll: async () => {},
      create: () => {},
      onClicked: {
        addListener: (fn) => {
          handlers.menu = fn;
        },
      },
    },
    tabs: {
      sendMessage: async (_tabId, message) => {
        messages.push(message);
      },
      create: async (tab) => {
        tabs.push(tab);
      },
    },
  };
  runInNewContext(await readFile(new URL("background.js", build), "utf8"), {
    chrome,
    console,
    crypto,
    AbortSignal,
    fetch,
    ...globals,
  });
  assert.equal(typeof handlers.message, "function");
  return { handlers, messages, tabs, chrome };
}

test("background starts and opens results when sidePanel API is absent", async () => {
  const { handlers, messages, tabs, chrome } = await background();
  const send = () =>
    new Promise((resolve) =>
      handlers.message(
        {
          type: "alchemy:select",
          target: { src: "https://example.com/image.png" },
        },
        {
          id: "test",
          frameId: 0,
          tab: { id: 1, windowId: 1, url: "https://example.com/" },
        },
        resolve,
      ),
    );
  assert.equal((await send()).ok, true);
  assert.equal(messages[0].type, "alchemy:hide");
  assert.equal(messages.at(-1).type, "alchemy:show");
  assert.equal(handlers.selection.jobId, undefined);
  assert.match(handlers.selection.error, /原图无法读取/);
  chrome.tabs.sendMessage = async () => {
    throw new Error("No content script");
  };
  assert.equal((await send()).ok, true);
  assert.equal(tabs[0].url, "chrome-extension://test/popup.html?view=tab");
});

test("reruns the current or historical image with the explicitly selected mode", async () => {
  const submitted = [];
  const oldJob = "00000000-0000-0000-0000-000000000001";
  const historical = { id: oldJob, jobId: oldJob, image: "historical-image", capture: "original", sourceUrl: "https://example.com/old" };
  const { handlers, chrome } = await background(async (url, options) => {
    if (url.endsWith(`/jobs/${oldJob}/reference`)) return { ok: true, json: async () => historical };
    assert.ok(url.endsWith("/jobs"));
    submitted.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: `new-${submitted.length}`, mode: submitted.at(-1).mode, status: "running", stage: "started" }) };
  });
  const storage = { preferences: { token: "secret", mode: "style" }, selection: { id: "current", image: "current-image", sourceUrl: "https://example.com/current", capture: "original" } };
  chrome.storage.local.get = async () => storage;
  chrome.storage.local.set = async (value) => Object.assign(storage, value);
  const sender = { id: "test", frameId: 0, url: "https://www.pinterest.com/", tab: { id: 4, windowId: 1 } };
  const send = (message) => new Promise(resolve => handlers.message(message, sender, resolve));
  const current = await send({ type: "alchemy:start", id: "current", mode: "recreate" });
  assert.equal(current.value.job.mode, "recreate");
  assert.equal(submitted[0].image, "current-image");
  assert.equal(submitted[0].mode, "recreate");
  assert.equal(storage.selection.jobId, "new-1");
  const restored = await send({ type: "alchemy:reference", id: oldJob });
  assert.equal(restored.value.image, "historical-image");
  assert.equal(storage.selection.id, "current", "opening history must not replace the current image");
  const rerun = await send({ type: "alchemy:start", id: oldJob, referenceJobId: oldJob, mode: "recreate" });
  assert.equal(rerun.value.job.id, "new-2");
  assert.equal(submitted[1].image, "historical-image");
  assert.equal(submitted[1].mode, "recreate");
  assert.equal(submitted[1].sourceUrl, historical.sourceUrl);
  assert.notEqual(storage.selection.id, "current");
  assert.match((await send({ type: "alchemy:reference", id: "../../token" })).error, /无效/);
  assert.match((await send({ type: "alchemy:start", id: "current", mode: "style" })).error, /已变化/);
  const reenact = { subjectImage: "subject-image", basePrompt: "edited prompt", promptSourceJobId: oldJob };
  const replay = await send({ type: "alchemy:start", referenceJobId: oldJob, mode: "reenact", reenact });
  assert.equal(replay.value.job.mode, "reenact");
  assert.deepEqual(submitted[2].reenact, reenact);
  assert.equal(submitted[2].image, "historical-image");
  assert.equal(storage.selection.reenact.subjectImage, "subject-image");
  const withoutInputs = await send({ type: "alchemy:start", id: storage.selection.id, mode: "reenact" });
  assert.match(withoutInputs.error, /主体图/);
  assert.equal(submitted.length, 3);
  const transfer = { subjectImage: "style-subject", basePrompt: "Keep the subject structure; transfer only rendering." };
  const style = await send({ type: "alchemy:start", referenceJobId: oldJob, mode: "style", reenact: transfer });
  assert.equal(style.value.job.mode, "style");
  assert.deepEqual(submitted[3].reenact, transfer);
  assert.equal(submitted[3].image, "historical-image");
  assert.equal(storage.selection.reenact.subjectImage, "style-subject");
  assert.match((await send({ type: "alchemy:start", id: storage.selection.id, mode: "style", reenact: { basePrompt: "missing subject" } })).error, /主体图/);
  assert.equal(submitted.length, 4);
  await send({ type: "alchemy:start", id: storage.selection.id, mode: "style" });
  assert.equal(submitted[4].reenact, undefined, "generic extraction must not receive stale subject inputs");
  assert.equal(storage.selection.reenact, undefined);
  await send({ type: "alchemy:start", id: storage.selection.id, mode: "recreate", reenact: transfer });
  assert.equal(submitted[5].reenact, undefined, "recreation uses only the reference even if subject inputs are supplied");
});

test("page panel can read results without receiving the pairing token", async () => {
  const { handlers, chrome } = await background();
  chrome.storage.local.get = async () => ({
    preferences: { token: "private-token", mode: "style" },
    selection: { id: "image", image: "data:image/png;base64,test", jobId: "active", reenact: { subjectImage: "subject", basePrompt: "prompt" } },
  });
  const sender = { id: "test", frameId: 0, url: "https://www.pinterest.com/", tab: { id: 4, windowId: 1 } };
  const send = (message) => new Promise(resolve => handlers.message(message, sender, resolve));
  const state = (await send({ type: "alchemy:state" })).value;
  assert.equal(state.preferences.paired, true);
  assert.equal(state.preferences.token, undefined);
  assert.equal(state.selection.image, "data:image/png;base64,test");
  const unchanged = (await send({ type: "alchemy:state", selectionId: "image", selectionJobId: "active" })).value;
  assert.equal(unchanged.selection.image, undefined);
  assert.equal(unchanged.selection.reenact, undefined);
  assert.equal(unchanged.selection.jobId, "active");
  const changed = (await send({ type: "alchemy:state", selectionId: "image", selectionJobId: "previous" })).value;
  assert.equal(changed.selection.reenact.subjectImage, "subject", "new jobs must restore the new pair of images");
  assert.equal((await send({ type: "alchemy:query", path: "/jobs/active" })).value.status, "running");
  assert.match((await send({ type: "alchemy:query", path: "https://example.com" })).error, /无效/);
  assert.match((await send({ type: "alchemy:mode", mode: "unknown" })).error, /无效/);
  assert.equal(handlers.message({ type: "alchemy:state" }, { ...sender, id: "another-extension" }, () => assert.fail("untrusted reply")), undefined);
  assert.equal(handlers.message({ type: "alchemy:state" }, { ...sender, frameId: 1 }, () => assert.fail("iframe reply")), undefined);
});

for (const mode of ["style", "reenact", "recreate"]) test(`hover in ${mode} mode selects another template while the previous task is active`, async () => {
  const calls = [];
  const { handlers, chrome } = await background(async (url) => {
    calls.push(url);
    if (url.endsWith("/projects")) return { ok: true, json: async () => ({ id: "a".repeat(64), jobs: [] }) };
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  }, {
    Blob, Uint8Array, btoa,
    createImageBitmap: async () => ({ width: 320, height: 400, close() {} }),
    OffscreenCanvas: class {
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }); }
    },
  });
  const storage = { preferences: { token: "test", mode }, selection: { id: "previous", jobId: "active", projectId: "b".repeat(64) } };
  chrome.storage.local.get = async () => storage;
  chrome.storage.local.set = async (value) => Object.assign(storage, value);
  const sender = { id: "test", frameId: 0, tab: { id: 4, windowId: 1, url: "https://example.com" } };
  const reply = await new Promise(resolve => handlers.message({ type: "alchemy:select", target: { src: "https://example.com/template.png" } }, sender, resolve));
  assert.equal(reply.ok, true);
  assert.equal(storage.selection.error, undefined);
  assert.match(storage.selection.image, /^data:image\/png;base64,/);
  assert.equal(storage.selection.jobId, undefined);
  assert.match(storage.selection.stage, /参考模板/);
  assert.equal(storage.selection.projectId, "a".repeat(64));
  assert.deepEqual(calls, ["https://example.com/template.png", "http://127.0.0.1:43187/projects"]);
});


test("prompt edits are validated, authenticated and limited to prompt fields", async () => {
  const calls = [];
  const { handlers } = await background(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ status: "completed" }) };
  });
  const sender = { id: "test", frameId: 0, url: "https://pinterest.com/", tab: { id: 4 } };
  const send = message => new Promise(resolve => handlers.message(message, sender, resolve));
  const id = "00000000-0000-0000-0000-000000000001";
  const edits = { promptZh: "修改后的中文", promptEn: "Edited prompt", negativePrompt: "" };
  assert.equal((await send({ type: "alchemy:save-prompt", id, ...edits, title: "ignored" })).ok, true);
  assert.ok(calls[0].url.endsWith(`/jobs/${id}/prompt`));
  assert.equal(calls[0].options.headers.Authorization, "Bearer test");
  assert.deepEqual(JSON.parse(calls[0].options.body), edits);
  for (const invalid of [{ id: "../token" }, { promptZh: " " }, { promptEn: null }, { negativePrompt: 42 }, { promptEn: "x".repeat(20001) }])
    assert.ok((await send({ type: "alchemy:save-prompt", id, ...edits, ...invalid })).error);
  assert.equal(calls.length, 1);
  assert.equal(handlers.message({ type: "alchemy:save-prompt", id, ...edits }, { ...sender, id: "other" }, () => assert.fail("untrusted reply")), undefined);
});
