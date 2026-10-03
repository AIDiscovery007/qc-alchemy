import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const stateCode = await compile('../lib/task-reminders.ts'), serviceCode = await compile('../lib/reminder-background.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const task = (id, extra = {}) => ({ id, jobId: 'prompt', projectId: 'a'.repeat(64), mode: 'style', status: 'completed', createdAt: new Date(2000).toISOString(), hidden: false, ...extra });

async function harness({ denied = false, stored, audioFails = false, paired = false, feed } = {}) {
  let now = 10000, listener, clicked, alarm, serial = 0, tasks = [], contexts = [];
  const timers = new Map(), notices = [], sounds = [], tabs = [], badges = [];
  const stateExports = {};
  class Clock extends Date { static now() { return now; } }
  runInNewContext(stateCode, { exports: stateExports, Date: Clock });
  const local = { taskReminders: stored || stateExports.newReminderState(1000), ...(paired ? { preferences: { token: "test-only" } } : {}) }, session = {};
  const area = data => ({ get: async () => structuredClone(data), set: async values => Object.assign(data, structuredClone(values)), remove: async key => { delete data[key]; } });
  const browser = {
    storage: { local: area(local), session: area(session), onChanged: { addListener() {} } },
    action: { setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    alarms: { create: async () => {}, onAlarm: { addListener(fn) { alarm = fn; } } },
    runtime: { id: 'test', getURL: path => `chrome-extension://test${path}`, getContexts: async () => contexts,
      onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async message => { sounds.push(message); return audioFails ? { error: 'blocked' } : { ok: true }; } },
    offscreen: { createDocument: async () => { contexts = [{}]; } },
    notifications: { getPermissionLevel: async () => denied ? 'denied' : 'granted', create: async (id, value) => notices.push({ id, ...value }), clear: async () => {}, onClicked: { addListener(fn) { clicked = fn; } } },
    tabs: { create: async value => tabs.push(value) },
  };
  const exports = {};
  runInNewContext(serviceCode, { exports, Date: Clock, URLSearchParams, console,
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
    require: name => name === 'wxt/browser' ? { browser } : name === './task-reminders' ? stateExports : { bridge: async path => feed ? feed(path) : ({ revision: String(now), tasks }) },
  });
  const service = exports.startReminderService(); await tick();
  const message = (type, props = {}, tab = 1) => new Promise((resolve, reject) => listener({ type: `alchemy:reminder-${type}`, ...props }, { id: 'test', url: 'chrome-extension://test/workspace.html', tab: { id: tab } }, reply => reply.error ? reject(new Error(reply.error)) : resolve(reply.value)));
  return { local, session, notices, sounds, tabs, badges, message, setFeed(next) { feed = next; }, projectsChanged: service.projectsChanged,
    async snapshot(next) { tasks = next; local.preferences = { token: 'test-only' }; await service.wake(); },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await tick(); await message('get'); },
    async click() { clicked('reframe-tasks'); await tick(); },
    async alarm() { alarm({ name: 'reframe-task-reminders' }); await tick(); await message('get'); },
  };
}

test('background completion is silent by default, batches tasks and restores without replay', async () => {
  const h = await harness();
  await h.snapshot([task('prompt'), task('image', { generationId: 'image' })]);
  assert.equal(h.notices.length, 0); assert.equal(h.badges.at(-1), '2');
  await h.advance(5000);
  assert.equal(h.notices.length, 1); assert.equal(h.notices[0].silent, true); assert.equal(h.sounds.length, 0);
  await h.click(); assert.ok(h.tabs[0].url.endsWith('?tasks=unread'));
  const restored = await harness({ stored: h.local.taskReminders });
  await restored.snapshot([task('prompt'), task('image', { generationId: 'image' })]); await restored.advance(60000);
  assert.equal(restored.notices.length, 0); assert.equal(restored.local.taskReminders.unread.length, 2);
});

test('denied desktop permission preserves badge; sound is opt-in, coalesced and cooldown applies', async () => {
  const h = await harness({ denied: true });
  await h.message('settings', { preferences: { sound: true, tone: 'soft', volume: 30 } });
  assert.equal(h.sounds.length, 0);
  await h.snapshot([task('one'), task('two')]); await h.advance(5000);
  assert.equal(h.notices.length, 0); assert.equal(h.badges.at(-1), '2'); assert.equal(h.sounds.length, 1);
  await h.snapshot([task('one'), task('two'), task('three')]); await h.advance(5000);
  assert.equal(h.sounds.length, 1);
  await h.advance(5000); await h.snapshot([task('one'), task('two'), task('three'), task('four')]); await h.advance(5000);
  assert.equal(h.sounds.length, 2);
});

test('foreground result is read without interruption, other result goes to only one foreground view', async () => {
  const h = await harness();
  await h.snapshot([task('prompt')]); await h.advance(4000);
  await h.message('view', { viewId: 'a', visible: true, seen: ['prompt'] });
  await h.advance(1000); assert.equal(h.notices.length, 0); assert.equal(h.badges.at(-1), '');
  await h.snapshot([task('prompt'), task('image', { generationId: 'image' })]); await h.advance(4000);
  await h.message('view', { viewId: 'a', visible: true, seen: [] });
  await h.message('view', { viewId: 'b', visible: true, seen: [] }, 2);
  await h.advance(1000);
  const a = await h.message('view', { viewId: 'a', visible: true, seen: [] });
  const b = await h.message('view', { viewId: 'b', visible: true, seen: [] }, 2);
  assert.equal(a.toast.length, 1); assert.equal(b.toast, undefined); assert.equal(h.notices.length, 0);
  assert.equal((await h.message('view', { viewId: 'a', visible: true, seen: [] })).toast, undefined);
  await h.message('open', { id: 'image' }); assert.ok(h.tabs[0].url.endsWith('?task=prompt&generation=image'));
});

test('worker restart recovers pending delivery; hidden tasks remain quiet; failed audio has feedback', async () => {
  const h = await harness(); await h.snapshot([task('visible'), task('secret', { hidden: true })]);
  const restored = await harness({ stored: h.local.taskReminders, audioFails: true });
  await restored.message('settings', { preferences: { sound: true, tone: 'bell', volume: 15 } });
  await restored.snapshot([task('visible'), task('secret', { hidden: true })]); await restored.advance(60000);
  assert.equal(restored.notices.length, 1); assert.equal(restored.badges.at(-1), '1');
  assert.equal((await restored.message('get')).audioError, 'blocked');
  await assert.rejects(restored.message('open', { id: 'secret' }), /已隐藏/);
  await restored.message('read', { ids: ['visible', 'secret'] });
  assert.deepEqual(restored.local.taskReminders.unread.map(item => item.id), ['secret']);
  await restored.alarm(); assert.equal(restored.notices.length, 1);
});

test('hiding during delivery grace cancels the interruption even with hidden projects shown; deletion clears badge', async () => {
  const h = await harness(); h.session.showHiddenProjects = true;
  await h.snapshot([task('prompt')]); await h.projectsChanged(['a'.repeat(64)], true); await h.advance(5000);
  assert.equal(h.notices.length, 0); assert.equal(h.badges.at(-1), '1');
  await h.snapshot([task('prompt', { hidden: true })]); await h.advance(5000);
  assert.equal(h.notices.length, 0);
  await h.projectsChanged(['a'.repeat(64)]); assert.equal(h.badges.at(-1), '');
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
for (const changed of ['hidden', 'deleted']) test(`overdue restart waits for a delayed fresh feed and suppresses ${changed} tasks`, async () => {
  const original = await harness();
  await original.message('settings', { preferences: { sound: true, tone: 'soft', volume: 30 } });
  await original.snapshot([task('prompt')]);
  const stored = structuredClone(original.local.taskReminders); stored.due = 9000;
  const gate = deferred();
  const restored = await harness({ stored, paired: true, feed: () => gate.promise });
  await restored.advance(60000); await restored.alarm();
  assert.equal(restored.notices.length, 0); assert.equal(restored.sounds.length, 0);
  assert.deepEqual(restored.local.taskReminders.pending, ['prompt']);
  gate.resolve({ revision: 'fresh', tasks: changed === 'hidden' ? [task('prompt', { hidden: true })] : [] });
  await tick(); await restored.advance(0);
  assert.equal(restored.notices.length, 0); assert.equal(restored.sounds.length, 0);
  assert.deepEqual(restored.local.taskReminders.pending, []);
});

test('offline restart keeps pending; a fresh recovery delivers once and later alarms cannot replay', async () => {
  const original = await harness();
  await original.message('settings', { preferences: { sound: true, tone: 'bell', volume: 15 } });
  await original.snapshot([task('prompt')]);
  const stored = structuredClone(original.local.taskReminders); stored.due = 9000;
  const restored = await harness({ stored, paired: true, feed: async () => { throw new Error('offline'); } });
  await restored.advance(60000); await restored.alarm();
  assert.deepEqual(restored.local.taskReminders.pending, ['prompt']);
  assert.equal(restored.notices.length, 0); assert.equal(restored.sounds.length, 0);
  assert.match((await restored.message('get')).connectionError, /连接中断/);
  const gate = deferred(); restored.setFeed(() => gate.promise);
  await restored.alarm(); await restored.advance(60000);
  assert.equal(restored.notices.length, 0); assert.equal(restored.sounds.length, 0);
  gate.resolve({ revision: 'recovered', tasks: [task('prompt')] }); await tick();
  assert.equal(restored.notices.length, 1); assert.equal(restored.sounds.length, 1);
  assert.deepEqual(restored.local.taskReminders.pending, []);
  await restored.alarm(); await restored.advance(60000);
  assert.equal(restored.notices.length, 1); assert.equal(restored.sounds.length, 1);
});

test('delivery grace expiry revalidates the feed and preserves pending if disconnected', async () => {
  const h = await harness(); await h.snapshot([task('prompt')]);
  h.setFeed(async () => { throw new Error('offline'); });
  await h.advance(5000);
  assert.equal(h.notices.length, 0); assert.deepEqual(h.local.taskReminders.pending, ['prompt']);
  h.setFeed(async () => ({ revision: 'hidden', tasks: [task('prompt', { hidden: true })] }));
  await h.alarm(); assert.equal(h.notices.length, 0); assert.deepEqual(h.local.taskReminders.pending, []);
});

test('a hide action while the feed is in flight cannot be undone by the older response', async () => {
  const h = await harness(); await h.snapshot([task('prompt')]);
  const gate = deferred(); h.setFeed(() => gate.promise);
  await h.advance(5000);
  await h.projectsChanged(['a'.repeat(64)], true);
  h.setFeed(async () => ({ revision: 'after-hide', tasks: [task('prompt', { hidden: true })] }));
  gate.resolve({ revision: 'before-hide', tasks: [task('prompt')] }); await tick();
  assert.equal(h.notices.length, 0); assert.equal(h.local.taskReminders.unread[0].hidden, true);
});


test('a repeated wake cannot strand a five-second pending batch behind unchanged long polls', async () => {
  const initial = deferred(), unchanged = deferred(), calls = [];
  const h = await harness({ paired: true, feed: path => {
    calls.push(path);
    if (calls.length === 1) return initial.promise;
    if (path.includes('?revision=')) return unchanged.promise;
    return { revision: 'complete', tasks: [task('prompt')] };
  } });
  await h.alarm(); // A second task-start/alarm arrives while the initial feed is in flight.
  initial.resolve({ revision: 'complete', tasks: [task('prompt')] }); await tick();
  await h.advance(5000);
  unchanged.resolve({ revision: 'complete' }); await tick();
  assert.equal(h.notices.length, 1);
  assert.deepEqual(h.local.taskReminders.pending, []);
  assert.equal(calls.some(path => path.includes('?revision=')), false);
  await h.alarm(); assert.equal(h.notices.length, 1);
});
