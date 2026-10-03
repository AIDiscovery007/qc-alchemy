import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
const code = ts.transpileModule(await readFile(new URL('../lib/reminder-visibility.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
runInNewContext(code, { exports, innerWidth: 1200, innerHeight: 1034, getComputedStyle: node => node.style });
const { isReminderVisible } = exports;
function node(top, bottom, parentElement = null, options = {}) {
  return { tagName: 'P', parentElement, offsetWidth: 400, offsetHeight: bottom - top, clientWidth: 400, clientHeight: bottom - top, clientLeft: 0, clientTop: 0,
    style: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', ...options.style },
    getBoundingClientRect: () => ({ left: 20, right: 420, top, bottom, width: 400, height: bottom - top }), matches: () => !!options.hidden,
    getRootNode: () => options.root || {}, ...options };
}

test('result below the panel clip stays unread although it is within the browser viewport', () => {
  const panel = node(100, 692); panel.style.overflowY = 'auto';
  const image = node(720, 900, panel);
  assert.equal(isReminderVisible(image), false);
  // Scrolling the panel brings actual result pixels into view.
  image.getBoundingClientRect = node(480, 660).getBoundingClientRect;
  assert.equal(isReminderVisible(image), true);
});

test('a visible result heading does not make the image or offscreen failure text visible', () => {
  const panel = node(100, 692); panel.style.overflowY = 'auto';
  const section = node(660, 960, panel), title = node(660, 684, section);
  const result = node(704, 900, section), failure = node(920, 960, section);
  assert.equal(isReminderVisible(title), true);
  assert.equal(isReminderVisible(result), false); assert.equal(isReminderVisible(failure), false);
  failure.getBoundingClientRect = node(630, 670).getBoundingClientRect;
  assert.equal(isReminderVisible(failure), true);
});

test('nested clipping, shadow hosts and hidden or inert ancestors all constrain seen', () => {
  const host = node(100, 692); host.style.overflowY = 'hidden';
  const inner = node(0, 1000, null, { root: { host } });
  assert.equal(isReminderVisible(node(720, 900, inner)), false);
  assert.equal(isReminderVisible(node(200, 400, inner)), true);
  host.matches = () => true;
  assert.equal(isReminderVisible(node(200, 400, inner)), false);
});

test('image loading and contain letterboxing do not count as viewing the result', () => {
  const panel = node(100, 692); panel.style.overflowY = 'auto';
  const image = node(650, 950, panel, { tagName: 'IMG', complete: false, naturalWidth: 0 });
  assert.equal(isReminderVisible(image), false);
  image.complete = true; image.naturalWidth = 400;
  image.closest = () => ({ querySelector: () => node(720, 900) });
  assert.equal(isReminderVisible(image), false);
  image.closest = () => ({ querySelector: () => node(500, 680) });
  assert.equal(isReminderVisible(image), true);
});
