import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(await readFile(new URL('../lib/visible-poll.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness(hidden = false) {
  const listeners = new Set(), timers = new Map(), exports = {};
  let nextTimer = 0;
  const document = {
    hidden,
    addEventListener: (name, listener) => { assert.equal(name, 'visibilitychange'); listeners.add(listener); },
    removeEventListener: (name, listener) => { assert.equal(name, 'visibilitychange'); listeners.delete(listener); },
  };
  runInNewContext(outputText, {
    exports, document,
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    start: exports.pollWhileVisible, timers, listeners,
    visibility(value) { document.hidden = value; for (const listener of listeners) listener(); },
    tick() {
      assert.equal(timers.size, 1, 'exactly one refresh should be scheduled');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); timer.callback();
    },
  };
}

test('visible polling pauses while hidden and resumes immediately with the latest cadence', async () => {
  const poll = harness(true);
  let calls = 0;
  const stop = poll.start(async () => ++calls === 1 ? 2000 : 10000);
  assert.equal(calls, 0);
  assert.equal(poll.timers.size, 0);
  poll.visibility(false);
  assert.equal(calls, 1);
  await flush();
  assert.equal([...poll.timers.values()][0].delay, 2000);
  poll.visibility(true);
  assert.equal(poll.timers.size, 0, 'hiding must cancel the next timer');
  poll.visibility(false);
  assert.equal(calls, 2);
  await flush();
  assert.equal([...poll.timers.values()][0].delay, 10000);
  poll.tick();
  assert.equal(calls, 3);
  await flush();
  assert.equal(poll.timers.size, 1);
  stop();
  assert.equal(poll.timers.size, 0);
  assert.equal(poll.listeners.size, 0);
});

test('hide and resume during an in-flight refresh never starts overlapping requests', async () => {
  const poll = harness();
  const completions = [];
  let calls = 0;
  const stop = poll.start(() => { calls++; return new Promise(resolve => completions.push(resolve)); });
  assert.equal(calls, 1);
  poll.visibility(true);
  poll.visibility(false);
  poll.visibility(false);
  assert.equal(calls, 1);
  assert.equal(poll.timers.size, 0);
  completions.shift()(2000);
  await flush();
  assert.equal(poll.timers.size, 1, 'completion schedules one follow-up');
  poll.tick();
  assert.equal(calls, 2);
  poll.visibility(true);
  completions.shift()(10000);
  await flush();
  assert.equal(poll.timers.size, 0, 'completion while hidden must not reschedule');
  poll.visibility(false);
  assert.equal(calls, 3);
  stop();
  completions.shift()(10000);
  await flush();
  assert.equal(poll.timers.size, 0);
});

test('cleanup during an in-flight refresh prevents late completion and visibility from restarting polling', async () => {
  const poll = harness();
  let calls = 0, finish;
  const stop = poll.start(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  stop();
  assert.equal(poll.listeners.size, 0);
  finish(2000);
  await flush();
  poll.visibility(true);
  poll.visibility(false);
  assert.equal(calls, 1);
  assert.equal(poll.timers.size, 0);
});
