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

function fixture() {
  const trigger = new Trigger();
  const dialog = {
    open: false, offsetLeft: 100, offsetTop: 100, offsetWidth: 400, offsetHeight: 300,
    style: { setProperty() {} },
    getRootNode: () => ({ activeElement: trigger }),
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  return { trigger, dialog };
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
