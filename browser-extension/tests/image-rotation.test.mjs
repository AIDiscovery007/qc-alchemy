import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(await readFile(new URL('../lib/image.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
function setup({ fail = false } = {}) {
  const rendered = [], limits = [];
  let closed = 0, decoded = 0;
  const exports = {};
  runInNewContext(outputText, {
    exports, Uint8Array, btoa, fetch: async () => ({ blob: async () => new Blob() }),
    createImageBitmap: async () => { decoded++; return { width: 3, height: 5, close() { closed++; } }; },
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() {
        const { width, height } = this;
        let tx = 0, ty = 0, angle = 0;
        return {
          translate(x, y) { tx = x; ty = y; }, rotate(value) { angle = value; },
          drawImage(bitmap, x, y) {
            // Track the actual destination of each original corner, including alpha-bearing pixels.
            const corners = [[0, 0], [bitmap.width, 0], [0, bitmap.height], [bitmap.width, bitmap.height]].map(([cx, cy]) => [
              Math.round(tx + (x + cx) * Math.cos(angle) - (y + cy) * Math.sin(angle)) || 0,
              Math.round(ty + (x + cx) * Math.sin(angle) + (y + cy) * Math.cos(angle)) || 0,
            ]);
            rendered.push({ width, height, corners });
          },
        };
      }
      async convertToBlob(options) {
        limits.push(options.type);
        if (fail) throw new Error('encode failed');
        return new Blob([new Uint8Array(8)], { type: options.type });
      }
    },
  });
  return { rotate: exports.rotateImage, rendered, limits, stats: () => ({ closed, decoded }) };
}

test('quarter turns preserve dimensions and map every corner without clipping or mirroring', async () => {
  const { rotate, rendered, stats } = setup();
  const expected = [
    { width: 5, height: 3, corners: [[5, 0], [5, 3], [0, 0], [0, 3]] },
    { width: 3, height: 5, corners: [[3, 5], [0, 5], [3, 0], [0, 0]] },
    { width: 5, height: 3, corners: [[0, 3], [0, 0], [5, 3], [5, 0]] },
  ];
  for (const turns of [1, 2, -1]) await rotate('data:image/png;base64,original', turns);
  assert.deepEqual(rendered, expected);
  assert.deepEqual(stats(), { closed: 3, decoded: 3 });
});

test('returning to zero preserves original bytes without decoding or recompressing', async () => {
  const { rotate, stats } = setup();
  for (const turns of [0, 4, -4, 8]) assert.equal(await rotate('original', turns), 'original');
  await assert.rejects(rotate('original', 0.5), /90°/);
  assert.deepEqual(stats(), { closed: 0, decoded: 0 });
});

test('rotation enforces the caller byte limit and releases bitmaps on encoding failure', async () => {
  const limited = setup();
  await assert.rejects(limited.rotate('original', 1, 4), /图片过大/);
  assert.deepEqual(limited.limits, ['image/png', 'image/jpeg']);
  assert.equal(limited.stats().closed, 1);
  const failed = setup({ fail: true });
  await assert.rejects(failed.rotate('original', 1), /encode failed/);
  assert.equal(failed.stats().closed, 1);
});
