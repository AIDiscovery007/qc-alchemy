import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise App's callback with separate render closures, as when switching paths.
const source = await readFile(new URL('../entrypoints/popup/App.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'cancel') callback = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(callback);
const compiled = ts.transpileModule(`exports.cancel = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const requests = [], updates = [], errors = [], pendingCancellations = { current: new Set() };
  let pending = [];
  return {
    requests, updates, errors,
    get pending() { return pending; },
    render(job) {
      const exports = {};
      runInNewContext(compiled, {
        exports, job, running: job?.status === 'running', pendingCancellations,
        setCancellingJobs: value => { pending = [...value]; }, setError: value => errors.push(value),
        updateJob: value => updates.push(value),
        request: message => new Promise((resolve, reject) => requests.push({ ...message, resolve, reject })),
      });
      return exports.cancel;
    },
  };
}

test('cancel locks per task immediately and preserves the captured task across path switches', async () => {
  const ui = fixture();
  const first = ui.render({ id: 'style', status: 'running' });
  const pendingFirst = first();
  await first();
  const second = ui.render({ id: 'reenact', status: 'running' });
  const pendingSecond = second();
  await first(); await second();
  assert.deepEqual(ui.requests.map(item => item.id), ['style', 'reenact']);
  assert.deepEqual(ui.pending, ['style', 'reenact']);
  ui.requests[0].resolve({ id: 'style', status: 'cancelled' }); await pendingFirst;
  assert.deepEqual(ui.pending, ['reenact']);
  ui.requests[1].resolve({ id: 'reenact', status: 'cancelled' }); await pendingSecond;
  assert.deepEqual(ui.updates.map(item => item.id), ['style', 'reenact']);
  assert.deepEqual(ui.pending, []);
});

test('cancel failure reports feedback and unlocks retry; idle or completed tasks cannot be cancelled', async () => {
  const ui = fixture();
  await ui.render(undefined)();
  await ui.render({ id: 'done', status: 'completed' })();
  assert.equal(ui.requests.length, 0);
  const cancel = ui.render({ id: 'multi', status: 'running' });
  const failed = cancel();
  ui.requests[0].reject(new Error('取消失败')); await failed;
  assert.equal(ui.errors.at(-1), '取消失败');
  assert.equal(ui.updates.length, 0);
  assert.deepEqual(ui.pending, []);
  const retry = cancel();
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.errors.at(-1), '');
  ui.requests[1].resolve({ id: 'multi', status: 'cancelled' }); await retry;
  assert.deepEqual(ui.pending, []);
});
