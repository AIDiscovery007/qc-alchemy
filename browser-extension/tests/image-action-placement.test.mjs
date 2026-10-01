import test from 'node:test';
import assert from 'node:assert/strict';
import { placeImageAction } from '../lib/image-action-placement.ts';

const rect = (x, y, width, height) => ({ left: x, top: y, right: x + width, bottom: y + height });
const viewport = rect(0, 0, 900, 800), image = rect(100, 100, 300, 500), size = { width: 120, height: 42 };
const overlaps = (a, b, gap = 0) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

test('the round trigger fits narrow images and avoids website buttons', () => {
  const size = { width: 40, height: 40 };
  const narrow = rect(20, 20, 80, 180);
  const compact = placeImageAction(narrow, viewport, size, []);
  assert.equal(compact.right - compact.left, 40);
  assert.equal(compact.compact, false);
  const save = rect(300, 110, 90, 48);
  const action = placeImageAction(image, viewport, size, [save]);
  assert.ok(action && !overlaps(action, save, 10));
});

test('image action sits beside a save button with a shadow-safe gap', () => {
  const save = rect(310, 110, 80, 48);
  const action = placeImageAction(image, viewport, size, [save]);
  assert.ok(action && !action.compact);
  assert.equal(action.right + 10, save.left);
  assert.equal(action.top, save.top);
});

test('a crowded top toolbar moves the action below it', () => {
  const controls = [rect(110, 110, 160, 48), rect(310, 110, 80, 48)];
  const action = placeImageAction(image, viewport, size, controls);
  assert.ok(action);
  assert.equal(action.top, 168);
  assert.ok(controls.every(control => !overlaps(action, control, 10)));
});

test('new controls displace a conflicting action, then the position stays stable', () => {
  const first = placeImageAction(image, viewport, size, []);
  const save = rect(310, 110, 80, 48);
  const moved = placeImageAction(image, viewport, size, [save], first);
  assert.notDeepEqual(first, moved);
  assert.equal(placeImageAction(image, viewport, size, [], moved), moved);
});

test('compact action fits a narrow image without spilling onto the next card', () => {
  const narrow = rect(30, 40, 95, 200);
  const action = placeImageAction(narrow, viewport, size, []);
  assert.ok(action?.compact);
  assert.equal(action.right - action.left, 40);
  assert.ok(action.left >= narrow.left + 10 && action.right <= narrow.right - 10);
});

test('a small free gap can retain the compact action beside native controls', () => {
  const small = rect(10, 10, 150, 100), control = rect(90, 20, 60, 80);
  const action = placeImageAction(small, viewport, size, [control]);
  assert.ok(action?.compact);
  assert.ok(!overlaps(action, control, 10));
});

test('no free area hides the action instead of covering a website control', () => {
  assert.equal(placeImageAction(image, viewport, size, [image]), undefined);
  assert.equal(placeImageAction(rect(-400, 10, 100, 100), viewport, size, []), undefined);
  assert.equal(placeImageAction(rect(10, -200, 100, 100), viewport, size, []), undefined);
});

test('partially visible images and zoom-sized buttons stay within the viewport', () => {
  const action = placeImageAction(rect(-50, -400, 400, 650), rect(0, 0, 260, 200), { width: 180, height: 60 }, []);
  assert.ok(action && action.left >= 10 && action.top >= 10 && action.right <= 250 && action.bottom <= 190);
});

test('hit testing avoids a sticky header outside the image card', () => {
  const header = rect(0, 0, 900, 220);
  const action = placeImageAction(image, viewport, size, [], undefined, box => !overlaps(box, header));
  assert.ok(action && action.top >= header.bottom);
  assert.equal(placeImageAction(image, viewport, size, [], action, () => false), undefined);
});

test('different card sizes and edge controls never yield overlapping placements', () => {
  for (const width of [80, 160, 240, 520]) for (const height of [80, 240, 700]) {
    const card = rect(20, 30, width, height);
    const controls = [rect(card.right - 70, card.top + 10, 60, 40), rect(card.left + 10, card.bottom - 50, 40, 40)];
    const action = placeImageAction(card, viewport, size, controls);
    if (!action) continue;
    assert.ok(action.left >= card.left + 10 && action.right <= card.right - 10);
    assert.ok(action.top >= card.top + 10 && action.bottom <= Math.min(card.bottom, viewport.bottom) - 10);
    assert.ok(controls.every(control => !overlaps(action, control, 10)));
  }
});
