import test from 'node:test';
import assert from 'node:assert/strict';
import { showMotionDialog } from '../lib/motion-dialog.ts';

class Trigger {
  isConnected = true;
  visible = true;
  focused = false;
  getClientRects() { return this.visible ? [{}] : []; }
  getBoundingClientRect() { return { x: 10, y: 300, width: 40, height: 40 }; }
  focus(options) { this.focused = options; }
}

function fixture(native = false) {
  const trigger = new Trigger();
  const dialog = Object.assign(new EventTarget(), {
    open: false, offsetLeft: 100, offsetTop: 100, offsetWidth: 400, offsetHeight: 300,
    setAttribute(name, value) { this[name] = value; },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400 }),
    style: { setProperty() {} },
    getRootNode: () => ({ activeElement: trigger }),
    showModal() { this.open = true; },
    close() { this.open = false; },
  });
  if (native) dialog.closedBy = 'closerequest';
  return { trigger, dialog };
}

function pointer(dialog, type, x = 20, y = 20, props = {}) {
  dialog.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, button: 0, isPrimary: true, pointerId: 1, ...props }));
}

// Node has no DOM; the owner root intentionally differs from document.activeElement.
globalThis.HTMLElement = Trigger;
test('dialog opens synchronously and restores the visible trigger in its own shadow root', () => {
  const { dialog, trigger } = fixture();
  const close = showMotionDialog(dialog);
  assert.equal(dialog.open, true);
  close();
  assert.equal(dialog.open, false);
  assert.deepEqual(trigger.focused, { preventScroll: true });
});

test('removed or hidden triggers are not refocused after dismissal', () => {
  for (const key of ['isConnected', 'visible']) {
    const { dialog, trigger } = fixture();
    const close = showMotionDialog(dialog);
    trigger[key] = false;
    close();
    assert.equal(trigger.focused, false);
  }
});

test('cleanup after a completed action does not steal the new focus', () => {
  const { dialog, trigger } = fixture();
  const close = showMotionDialog(dialog);
  dialog.close(); // Deleting a project moves focus to the remaining library heading.
  close();
  assert.equal(trigger.focused, false);
});

test('native light dismiss is enabled without a duplicate fallback cancel', () => {
  const { dialog } = fixture(true);
  const close = showMotionDialog(dialog);
  assert.equal(dialog.closedby, 'any');
  pointer(dialog, 'pointerdown');
  pointer(dialog, 'click');
  assert.equal(dialog.open, true);
  close();
});

test('fallback backdrop dismissal uses cancel and preserves busy guards', () => {
  const { dialog } = fixture();
  const close = showMotionDialog(dialog);
  let busy = true;
  let requests = 0;
  dialog.addEventListener('cancel', event => {
    requests++;
    assert.equal(event.bubbles, false);
    if (busy) event.preventDefault();
  });
  pointer(dialog, 'pointerdown');
  pointer(dialog, 'click');
  assert.equal(dialog.open, true);
  busy = false;
  pointer(dialog, 'pointerdown');
  pointer(dialog, 'click');
  assert.equal(dialog.open, false);
  assert.equal(requests, 2);
  close();
});

test('fallback ignores dialog padding, drags, cancelled gestures and mismatched pointers', () => {
  const { dialog } = fixture();
  const close = showMotionDialog(dialog);
  for (const [down, click] of [[[110, 110], [110, 110]], [[110, 110], [20, 20]], [[20, 20], [110, 110]]]) {
    pointer(dialog, 'pointerdown', ...down);
    pointer(dialog, 'click', ...click);
    assert.equal(dialog.open, true);
  }
  pointer(dialog, 'pointerdown');
  pointer(dialog, 'pointercancel');
  pointer(dialog, 'click');
  assert.equal(dialog.open, true);
  pointer(dialog, 'pointerdown');
  pointer(dialog, 'click', 20, 20, { pointerId: 2 });
  assert.equal(dialog.open, true);
  pointer(dialog, 'pointerdown', 20, 20, { button: 2 });
  pointer(dialog, 'click');
  assert.equal(dialog.open, true);
  close();
});

test('fallback listeners are removed even if the dialog was already closed', () => {
  const { dialog } = fixture();
  const close = showMotionDialog(dialog);
  dialog.close();
  close();
  dialog.showModal();
  pointer(dialog, 'pointerdown');
  pointer(dialog, 'click');
  assert.equal(dialog.open, true);
});
