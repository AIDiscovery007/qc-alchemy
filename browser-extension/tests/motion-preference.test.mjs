import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile(new URL('../lib/motion-preference.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const mediaListeners = new Set(), messageListeners = new Set(), reads = [];
  const media = { matches: true, addEventListener: (_, fn) => mediaListeners.add(fn), removeEventListener: (_, fn) => mediaListeners.delete(fn) };
  let stored = 'full', failSave = false;
  const notify = (id = 'test') => messageListeners.forEach(fn => fn({ type: 'alchemy:motion-changed' }, { id }));
  const browser = {
    // The production background restricts storage to TRUSTED_CONTEXTS.
    get storage() { throw new Error('content scripts cannot access local storage'); },
    runtime: { id: 'test', onMessage: { addListener: fn => messageListeners.add(fn), removeListener: fn => messageListeners.delete(fn) } },
  };
  const request = async message => {
    if (message.type === 'alchemy:get-motion-preference') return new Promise(resolve => reads.push(resolve));
    assert.equal(message.type, 'alchemy:set-motion-preference');
    if (failSave) throw new Error('storage unavailable');
    stored = message.preference;
    notify();
  };
  const exports = {};
  runInNewContext(compiled, { exports, matchMedia: () => media, require: name => {
    assert.ok(['wxt/browser', './client'].includes(name));
    return name === 'wxt/browser' ? { browser } : { request };
  } });
  return {
    ...exports, reads, mediaListeners, messageListeners, notify,
    set failSave(value) { failSave = value; },
    async read(value = stored) { reads.shift()(value); await new Promise(setImmediate); },
    system(reduced) { media.matches = reduced; mediaListeners.forEach(fn => fn()); },
  };
}

test('restricted content restores and saves overrides via messages, follows system and releases shared listeners', async () => {
  const ui = fixture();
  const stop = ui.subscribeMotion(() => {}), stopSecond = ui.subscribeMotion(() => {});
  await ui.read();
  assert.equal(ui.getMotion().preference, 'full');
  assert.equal(ui.getMotion().reduced, false);
  ui.system(false); ui.system(true);
  assert.equal(ui.getMotion().reduced, false);
  await ui.setMotionPreference('reduce'); await ui.read();
  ui.system(false);
  assert.equal(ui.getMotion().reduced, true);
  ui.notify(); await ui.read('system'); // Another window changed the preference.
  assert.equal(ui.getMotion().reduced, false);
  ui.system(true);
  assert.equal(ui.getMotion().reduced, true);
  ui.notify('foreign');
  assert.equal(ui.reads.length, 0);
  stop();
  assert.equal(ui.messageListeners.size, 1);
  stopSecond();
  assert.equal(ui.messageListeners.size, 0);
  assert.equal(ui.mediaListeners.size, 0);
});

test('late reads cannot overwrite newer changes or update an unmounted consumer; failed saves preserve the choice', async () => {
  const ui = fixture();
  const stop = ui.subscribeMotion(() => {});
  const oldRead = ui.reads.shift();
  await ui.setMotionPreference('full'); await ui.read();
  oldRead('reduce'); await new Promise(setImmediate);
  assert.equal(ui.getMotion().preference, 'full');
  ui.failSave = true;
  await assert.rejects(ui.setMotionPreference('reduce'), /storage unavailable/);
  assert.equal(ui.getMotion().preference, 'full');
  ui.notify();
  stop();
  await ui.read('reduce');
  assert.equal(ui.getMotion().preference, 'full');
});
