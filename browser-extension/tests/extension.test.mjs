import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const build = new URL("../.output/chrome-mv3/", import.meta.url);

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
  assert.equal(messages[0].type, "alchemy:show");
  assert.equal(handlers.selection.jobId, "active");
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
  await send({ type: "alchemy:start", id: storage.selection.id, mode: "style" });
  assert.equal(submitted[3].reenact, undefined, "single-image modes must not receive stale subject inputs");
  assert.equal(storage.selection.reenact, undefined);
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

test("hover in reenact mode captures the template without starting an incomplete job", async () => {
  const calls = [];
  const { handlers, chrome } = await background(async (url) => {
    calls.push(url);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  }, {
    Blob, Uint8Array, btoa,
    createImageBitmap: async () => ({ width: 320, height: 400, close() {} }),
    OffscreenCanvas: class {
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }); }
    },
  });
  const storage = { preferences: { token: "test", mode: "reenact" } };
  chrome.storage.local.get = async () => storage;
  chrome.storage.local.set = async (value) => Object.assign(storage, value);
  const sender = { id: "test", frameId: 0, tab: { id: 4, windowId: 1, url: "https://example.com" } };
  const reply = await new Promise(resolve => handlers.message({ type: "alchemy:select", target: { src: "https://example.com/template.png" } }, sender, resolve));
  assert.equal(reply.ok, true);
  assert.equal(storage.selection.error, undefined);
  assert.match(storage.selection.image, /^data:image\/png;base64,/);
  assert.equal(storage.selection.jobId, undefined);
  assert.match(storage.selection.stage, /补充主体图/);
  assert.deepEqual(calls, ["https://example.com/template.png"]);
});
