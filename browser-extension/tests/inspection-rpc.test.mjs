import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { withCodex } from "../bridge/codex-rpc.mjs";
import { runAgent, runCodex } from "../bridge/agent.mjs";
import { readModelCatalog } from "../bridge/models.mjs";

async function fakeCodex(t, turnCode) {
  const dir = await mkdtemp(join(tmpdir(), "alchemy-inspection-rpc-"));
  const file = join(dir, "codex");
  const log = join(dir, "calls.jsonl");
  await writeFile(file, `#!/usr/bin/env node
const fs = require('node:fs');
const send = x => process.stdout.write(JSON.stringify(x) + '\\n');
const done = () => {
  send({method:'item/completed',params:{threadId:'test',item:{type:'agentMessage',text:JSON.stringify({title:'test',observations:[],promptZh:'猫',promptEn:'cat',negativePrompt:'',uncertainties:[]})}}});
  send({method:'turn/completed',params:{threadId:'test',turn:{status:'completed'}}});
};
let start, expectedReplies = 1;
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line); fs.appendFileSync(${JSON.stringify(log)},line+'\\n');
  if (m.id === undefined) return;
  if (!m.method) { if (--expectedReplies === 0) done(); return; }
  let result = {};
  if (m.method === 'account/read') result={account:{type:'chatgpt',email:'inspection@example.com',planType:'test'},requiresOpenaiAuth:true};
  if (m.method === 'config/read') result={config:{model_provider:'openai'}};
  if (m.method === 'model/list') result={data:[{model:'vision',defaultReasoningEffort:'low',isDefault:true}],nextCursor:null};
  if (m.method === 'modelProvider/capabilities/read') result={imageGeneration:true};
  if (m.method === 'thread/start') { start=m.params; result={thread:{id:'test'},model:m.params.model,modelProvider:m.params.modelProvider}; }
  send({id:m.id,result});
  if (m.method === 'turn/start') { ${turnCode} }
});
`, { mode: 0o700 });
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = file;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, calls: async () => (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse) };
}

test("runAgent registers input-scoped inspection and RPC delivers actual ordered image pixels and recoverable tool errors", async t => {
  const { dir, calls } = await fakeCodex(t, `
    expectedReplies = 3;
    send({id:'bad',method:'item/tool/call',params:{threadId:'test',turnId:'t',callId:'bad',tool:'alchemy_inspect_image',arguments:{image:3}}});
    send({id:'first',method:'item/tool/call',params:{threadId:'test',turnId:'t',callId:'first',tool:'alchemy_inspect_image',arguments:{image:1,bbox:{x:0,y:0,width:1,height:1},scale:2}}});
    send({id:'last',method:'item/tool/call',params:{threadId:'test',turnId:'t',callId:'last',tool:'alchemy_inspect_image',arguments:{image:2}}});
  `);
  const skillPath = join(dir, "SKILL.md");
  await writeFile(skillPath, "---\nname: alchemy\n---\nTest");
  const subjectImagePath = join(dir, "subject.png");
  const imagePath = join(dir, "reference.png");
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toFile(subjectImagePath);
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).png().toFile(imagePath);
  const catalog = await readModelCatalog(dir);
  const modelSettings = { ...catalog.models[0], accountKey: catalog.accountKey, provider: catalog.provider };
  const result = await runAgent({ mode: "reenact", imagePath, subjectImagePath, basePrompt: "保留主体", skillPath, cwd: dir, modelSettings });
  assert.equal(result.promptEn, "cat");
  const messages = await calls();
  assert.equal(messages.filter(m => m.method === "initialize").at(-1).params.capabilities.experimentalApi, true);
  const start = messages.find(m => m.method === "thread/start").params;
  assert.equal(start.sandbox, "read-only");
  assert.equal(start.approvalPolicy, "never");
  assert.deepEqual(start.dynamicTools.map(s => [s.name, s.type, s.inputSchema.properties.image.maximum]), [["alchemy_inspect_image", "function", 2]]);
  assert.equal(messages.find(m => m.id === "bad").result.success, false);
  for (const [id, rgb] of [["first", [255, 0, 0]], ["last", [0, 0, 255]]]) {
    const response = messages.find(m => m.id === id).result;
    assert.equal(response.success, true);
    const image = response.contentItems.find(c => c.type === "inputImage");
    const pixels = await sharp(Buffer.from(image.imageUrl.split(",")[1], "base64")).raw().toBuffer();
    assert.deepEqual([...pixels.subarray(0, 3)], rgb);
  }
});

test("generation and probe never register inspection or opt into experimental tool APIs", async t => {
  const { dir, calls } = await fakeCodex(t, "done();");
  const catalog = await readModelCatalog(dir);
  const modelSettings = { ...catalog.models[0], accountKey: catalog.accountKey, provider: catalog.provider };
  const dynamicTools = [{ spec: { name: "alchemy_inspect_image" }, call() { assert.fail("unexpected dispatch"); } }];
  for (const options of [{ generation: true }, { probe: true }])
    await runCodex({ cwd: dir, input: [], modelSettings, dynamicTools, ...options });
  const messages = await calls();
  assert.ok(messages.filter(m => m.method === "initialize").every(m => m.params.capabilities === undefined));
  assert.ok(messages.filter(m => m.method === "thread/start").every(m => m.params.dynamicTools === undefined && m.params.sandbox === "read-only" && m.params.approvalPolicy === "never"));
});

for (const [label, method, params] of [
  ["unregistered tools", "item/tool/call", { threadId: "test", tool: "other" }],
  ["another thread", "item/tool/call", { threadId: "other", tool: "alchemy_inspect_image" }],
  ["namespaced tools", "item/tool/call", { threadId: "test", namespace: "other", tool: "alchemy_inspect_image" }],
  ["approval requests", "item/permissions/requestApproval", { threadId: "test" }],
]) test(`RPC continues rejecting ${label}`, async t => {
  const { dir } = await fakeCodex(t, `send({id:'forbidden',method:${JSON.stringify(method)},params:${JSON.stringify(params)}});`);
  const tool = { spec: { type: "function", name: "alchemy_inspect_image", description: "test", inputSchema: {} }, call() { assert.fail("must not execute"); } };
  await assert.rejects(withCodex({ cwd: dir, dynamicTools: [tool] }, async request => {
    await request("thread/start", { dynamicTools: [tool.spec] });
    await request("turn/start", { threadId: "test" });
    await new Promise(() => {});
  }), /交互式操作/);
});

test("cancelling RPC aborts an active handler and prevents subsequent work and tool responses", async t => {
  const { dir, calls } = await fakeCodex(t, `send({id:'active',method:'item/tool/call',params:{threadId:'test',tool:'alchemy_inspect_image',arguments:{image:1}}});`);
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const stopped = Promise.withResolvers();
  let nextStage = false, toolSignal;
  const tool = {
    spec: { type: "function", name: "alchemy_inspect_image", description: "test", inputSchema: {} },
    async call(args, { signal }) {
      toolSignal = signal;
      started.resolve();
      try {
        await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
        signal.throwIfAborted();
        nextStage = true;
      } finally { stopped.resolve(); }
    },
  };
  const running = withCodex({ cwd: dir, signal: controller.signal, dynamicTools: [tool] }, async request => {
    await request("thread/start", { dynamicTools: [tool.spec] });
    await request("turn/start", { threadId: "test" });
    await new Promise(() => {});
  });
  const rejected = assert.rejects(running, /取消/);
  await started.promise;
  controller.abort();
  await rejected;
  await stopped.promise;
  assert.equal(toolSignal.aborted, true);
  assert.equal(nextStage, false);
  assert.ok((await calls()).every(m => m.id !== "active"));
});
