import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entrypoints/workspace/ResultGallery.tsx', import.meta.url), 'utf8');
const nextSource = source.slice(source.indexOf('  async function next()'), source.indexOf('  function clear()'));
test('delayed next page cannot reopen a closed preview or replace a newer selection', async () => {
  for (const change of ['close', 'other image', 'filter', 'unmount', 'unchanged']) {
    let resolve, selected = '96';
    const previewRevision = { current: 1 };
    const gallery = { more: () => new Promise(done => { resolve = done; }) };
    const next = runInNewContext(`(${ts.transpile(nextSource, {target:ts.ScriptTarget.ES2022})})`, { gallery, previewRevision,
      items: [{ id: '96' }], currentIndex: 0,
      selectPreview: id => { previewRevision.current++; selected = id; } });
    const pending = next();
    if (change !== 'unchanged') { previewRevision.current++; selected = change === 'other image' ? '12' : ''; }
    resolve([{ id: '96' }, { id: '97' }]);
    await pending;
    assert.equal(selected, change === 'unchanged' ? '97' : change === 'other image' ? '12' : '', change);
  }
});
const reminders = ts.transpileModule(await readFile(new URL('../entrypoints/popup/TaskReminders.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function reported({ focused = true, hidden = false, dialogs = [] } = {}) {
  const calls = [], exports = {};
  const background = { dataset: { reminderTask: 'background' } }, original = { dataset: { reminderTask: 'generation-97' } };
  const modals = dialogs.map(gallery => ({ matches: () => gallery, querySelectorAll: () => [original] }));
  const root = { current: { getClientRects: () => [1], querySelectorAll: selector => selector === 'dialog[open]' ? modals : [background] } };
  runInNewContext(reminders, { exports, crypto, setInterval: () => 1, clearInterval() {},
    document: { hidden, hasFocus: () => focused, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    require: name => ({
      react: { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect: fn => fn() },
      'react/jsx-runtime': {}, 'react-dom': {}, './SelectField': {},
      '../../lib/client': { request: async message => { calls.push(message); return null; } },
      '../../lib/task-reminders': { newReminderState: () => ({ preferences: {} }) },
      '../../lib/reminder-visibility': { isReminderVisible: () => true },
    })[name] });
  exports.useTaskReminders(root);
  return Array.from(calls[0].seen);
}
test('foreground gallery dialog reports only its original through existing reminder-view', () => {
  assert.deepEqual(reported({ dialogs: [true] }), ['generation-97']);
  assert.deepEqual(reported({ dialogs: [false] }), []);
  assert.deepEqual(reported({ dialogs: [true, false] }), []);
  assert.deepEqual(reported({ dialogs: [true], focused: false }), []);
  assert.deepEqual(reported({ dialogs: [true], hidden: true }), []);
  assert.deepEqual(reported(), ['background']);
});

const imageCode = ts.transpileModule(await readFile(new URL('../entrypoints/workspace/GalleryImage.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function renderImage({ full = true, image = '', error = '' } = {}) {
  const exports = {}, effects = [], writes = [], values = [image, error, 0];
  let resolve;
  runInNewContext(imageCode, { exports, AbortController, IntersectionObserver: class { observe() {} disconnect() {} },
    require: name => ({
      react: { useState: () => [values.shift(), value => writes.push(value)], useRef: () => ({ current: null }), useEffect: fn => effects.push(fn) },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      '../../lib/client': { request: () => new Promise(done => { resolve = done; }) },
    })[name] });
  const tree = exports.default({ work: { jobId: 'j', generationId: 'g', width: 300, height: 400 }, full, load: () => Promise.resolve('thumbnail') });
  return { tree, writes, begin: () => effects[0](), finish: () => resolve({ image: 'late-original' }) };
}
test('only an original image element carries a reminder ID; late closed loads cannot restore it', async () => {
  const original = renderImage({ image: 'original' });
  assert.equal(original.tree.props.children.props['data-reminder-task'], 'g');
  for (const options of [{ full: false, image: 'thumbnail' }, { image: '' }, { image: 'broken', error: 'failed' }]) {
    assert.equal(renderImage(options).tree.props.children.props['data-reminder-task'], undefined);
  }
  const pending = renderImage();
  const cleanup = pending.begin();
  cleanup(); // Closing, changing the keyed generation, or leaving the gallery unmounts this image.
  pending.finish();
  await Promise.resolve();
  assert.equal(pending.writes.includes('late-original'), false);
});
