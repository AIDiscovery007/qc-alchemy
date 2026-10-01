import test from 'node:test';
import assert from 'node:assert/strict';
import { placeImageMenu } from '../lib/image-menu-placement.ts';

const rect = (x, y, width, height) => ({ left: x, top: y, right: x + width, bottom: y + height });
const viewport = rect(0, 0, 900, 800);
const boxes = (trigger, offsets) => offsets.map(({ x, y }) => rect(trigger.left + x, trigger.top + y, 40, 40));
const overlaps = (a, b) => a.left < b.right + 6 && a.right > b.left - 6 && a.top < b.bottom + 6 && a.bottom > b.top - 6;
function verify(image, trigger, offsets, view = viewport) {
  assert.ok(offsets, 'two actions must fit');
  const actions = boxes(trigger, offsets);
  for (const action of actions) {
    assert.ok(action.left >= Math.max(image.left, view.left) + 8 && action.right <= Math.min(image.right, view.right) - 8);
    assert.ok(action.top >= Math.max(image.top, view.top) + 8 && action.bottom <= Math.min(image.bottom, view.bottom) - 8);
    assert.ok(!overlaps(action, trigger));
  }
  assert.ok(!overlaps(...actions));
}

test('top, bottom, left and right edge triggers fan inward', () => {
  const image = rect(20, 20, 300, 400);
  for (const [trigger, axis, sign] of [[rect(150, 30, 40, 40), 'y', 1], [rect(150, 370, 40, 40), 'y', -1], [rect(30, 200, 40, 40), 'x', 1], [rect(270, 200, 40, 40), 'x', -1]]) {
    const offsets = placeImageMenu(image, viewport, trigger);
    verify(image, trigger, offsets);
    assert.ok(offsets.every(offset => offset[axis] * sign > 0));
  }
});

test('corner triggers keep both circles inside the image', () => {
  const image = rect(20, 20, 300, 400);
  for (const x of [30, 270]) for (const y of [30, 370]) {
    const trigger = rect(x, y, 40, 40);
    verify(image, trigger, placeImageMenu(image, viewport, trigger));
  }
});

test('narrow and short images use a straight layout when a fan cannot fit', () => {
  for (const [image, trigger] of [[rect(20, 20, 80, 300), rect(30, 30, 40, 40)], [rect(20, 20, 300, 80), rect(30, 30, 40, 40)]]) {
    const offsets = placeImageMenu(image, viewport, trigger);
    verify(image, trigger, offsets);
    assert.ok(offsets.every(offset => offset.x === 0) || offsets.every(offset => offset.y === 0));
  }
});

test('partially visible images respect both image and viewport bounds', () => {
  const image = rect(-100, -200, 400, 500), trigger = rect(250, 10, 40, 40);
  verify(image, trigger, placeImageMenu(image, viewport, trigger));
});

test('page controls and hit-test overlays are avoided; crowded images return no layout', () => {
  const image = rect(20, 20, 300, 400), trigger = rect(270, 30, 40, 40);
  const original = placeImageMenu(image, viewport, trigger);
  const obstruction = boxes(trigger, original)[0];
  const offsets = placeImageMenu(image, viewport, trigger, [obstruction]);
  verify(image, trigger, offsets);
  assert.ok(boxes(trigger, offsets).every(box => !overlaps(box, obstruction)));
  assert.equal(placeImageMenu(image, viewport, trigger, [], () => false), undefined);
  assert.equal(placeImageMenu(rect(0, 0, 80, 80), viewport, rect(10, 10, 40, 40)), undefined);
});

test('valid open layout stays stable across polls until its space is blocked', () => {
  const image = rect(20, 20, 300, 400), trigger = rect(150, 30, 40, 40);
  const offsets = placeImageMenu(image, viewport, trigger);
  assert.equal(placeImageMenu(image, viewport, trigger, [], undefined, offsets), offsets);
  const changed = placeImageMenu(image, viewport, trigger, [boxes(trigger, offsets)[0]], undefined, offsets);
  assert.notDeepEqual(changed, offsets);
});
