import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(await readFile(new URL('../entrypoints/popup/ProjectVisibilityToast.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function fixture() {
  const slots = [], timers = new Set(), exports = {};
  let index = 0, now = 0, effects = [], tree, dismissed = 0;
  const props = { notice: { ids: ['one'], hidden: true, undone: false }, error: '', busy: false, containerRef: { current: { contains: () => false } }, onUndo() {}, onDismiss: () => dismissed++ };
  const effect = (fn, deps) => { const i = index++, old = slots[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) effects.push({ cleanup: old?.cleanup, setup: () => { slots[i] = { deps, cleanup: fn() }; } }); };
  runInNewContext(code, { exports, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, performance: { now: () => now },
    setTimeout: (fn, delay) => { const timer = { fn, at: now + delay }; timers.add(timer); return timer; }, clearTimeout: timer => timers.delete(timer),
    require: name => ({ react: { useEffect: effect, useLayoutEffect: effect,
      useRef: value => { const i = index++; return slots[i] ||= { current: value }; },
      useState: value => { const i = index++; slots[i] ??= { value }; return [slots[i].value, value => { if (slots[i].value !== value) { slots[i].value = value; render(); } }]; } },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, './Icon': {} })[name] });
  function render() { index = 0; effects = []; tree = exports.default(props); for (const effect of effects) effect.cleanup?.(); for (const effect of effects) effect.setup(); }
  render();
  return { get tree() { return tree; }, get dismissed() { return dismissed; },
    update: update => { Object.assign(props, update); render(); },
    tick(ms) { now += ms; for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.fn(); } },
    stale: () => [...timers][0].fn,
  };
}
test('success expires at four seconds, undo remains available for six', () => {
  const ui = fixture(); ui.tick(5999); assert.equal(ui.dismissed, 0); ui.tick(1); assert.equal(ui.dismissed, 1);
  ui.update({ notice: { ids: ['one'], hidden: false, undone: true } }); ui.tick(3999); assert.equal(ui.dismissed, 1); ui.tick(1); assert.equal(ui.dismissed, 2);
});
test('pointer and keyboard pauses preserve remaining time; busy undo cannot expire', () => {
  const ui = fixture(); ui.tick(2000); ui.tree.props.onPointerEnter(); ui.tick(9000); assert.equal(ui.dismissed, 0);
  ui.tree.props.onFocusCapture(); ui.tree.props.onPointerLeave(); ui.tick(9000); assert.equal(ui.dismissed, 0);
  ui.tree.props.onBlurCapture({ currentTarget: { contains: () => false } }); ui.update({ busy: true }); ui.tick(9000); assert.equal(ui.dismissed, 0);
  ui.update({ busy: false }); ui.tick(3999); assert.equal(ui.dismissed, 0); ui.tick(1); assert.equal(ui.dismissed, 1);
});
test('replacing feedback invalidates the old callback and gives the new notice its full lifetime', () => {
  const ui = fixture(), stale = ui.stale(); ui.tick(5000); ui.update({ notice: { ids: ['two'], hidden: true, undone: false } }); stale(); ui.tick(5999); assert.equal(ui.dismissed, 0); ui.tick(1); assert.equal(ui.dismissed, 1);
});
test('errors remain readable until explicitly dismissed', () => {
  const ui = fixture(); ui.update({ error: 'Could not restore' }); ui.tick(60000); assert.equal(ui.dismissed, 0);
  assert.equal(ui.tree.props.popover, 'manual'); ui.tree.props.children.at(-1).props.onClick(); assert.equal(ui.dismissed, 1);
});
