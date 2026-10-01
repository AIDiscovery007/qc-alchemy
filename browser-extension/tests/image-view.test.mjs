import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(await readFile(new URL('../lib/image-view.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const exports = {};
runInNewContext(outputText, { exports });
const { constrainView, zoomView } = exports;

test('zoom keeps the image point under the cursor fixed, including at zoom limits', () => {
  const view = { scale: 2, x: 40, y: -30 }, anchor = { x: 120, y: 90 };
  for (const scale of [0, 1, 3, 8, 100]) {
    const next = zoomView(view, scale, anchor);
    assert.equal((anchor.x - next.x) / next.scale, (anchor.x - view.x) / view.scale);
    assert.equal((anchor.y - next.y) / next.scale, (anchor.y - view.y) / view.scale);
    assert.ok(next.scale >= 1 && next.scale <= 8);
  }
});

test('panning is bounded by actual image edges and centers the shorter axis', () => {
  const frame = { width: 600, height: 400 }, portrait = { width: 200, height: 360 };
  const pan = constrainView({ scale: 2, x: 9999, y: -9999 }, frame, portrait);
  assert.equal(Math.abs(pan.x), 0);
  assert.equal(pan.y, -160);
  const fit = constrainView({ scale: 1, x: -300, y: 120 }, frame, portrait);
  assert.equal(Math.abs(fit.x), 0);
  assert.equal(Math.abs(fit.y), 0);
  const resized = constrainView(pan, { width: 1000, height: 1000 }, portrait);
  assert.equal(Math.abs(resized.x), 0);
  assert.equal(Math.abs(resized.y), 0);
});
