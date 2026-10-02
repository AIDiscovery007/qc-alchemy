import test from 'node:test';
import assert from 'node:assert/strict';
import { resultDrawers, resultDrawerView } from '../lib/result-drawer.ts';

const key = 'project:reenact:version-1';
const item = (id, status) => ({ id, status });
const view = (state, generations = [], scope = key) => resultDrawerView(state, scope, generations);
const reduce = (state, action) => resultDrawers(state, { key, ...action });

test('empty prompts and cancelled-only histories reserve no result space', () => {
  assert.equal(view({}).open, false);
  assert.equal(view({}, [item('cancelled', 'cancelled')]).content, false);
  assert.equal(view({}, [item('saved', 'completed')]).open, true);
});

test('submission opens immediately; manual collapse survives response and completion', () => {
  let state = reduce({}, { type: 'request' });
  assert.equal(view(state).open, true);
  state = reduce(state, { type: 'toggle', open: false, seen: '' });
  state = reduce(state, { type: 'settled' });
  assert.equal(view(state, [item('new', 'running')]).open, false);
  assert.equal(view(state, [item('new', 'running')]).label, '正在生成');
  assert.equal(view(state, [item('new', 'completed')]).open, false);
  assert.equal(view(state, [item('new', 'completed')]).label, '新结果');
  state = reduce(state, { type: 'toggle', open: true, seen: 'new' });
  assert.equal(view(state, [item('new', 'completed')]).open, true);
  state = reduce(state, { type: 'toggle', open: false, seen: 'new' });
  assert.equal(view(state, [item('new', 'completed')]).label, '查看结果');
  assert.equal(view(reduce(state, { type: 'request' })).open, true);
});

test('switching projects, modes and versions cannot reuse another drawer preference', () => {
  let state = reduce({}, { type: 'toggle', open: false, seen: 'saved' });
  for (const scope of ['other:reenact:version-1', 'project:style:version-1', 'project:reenact:version-2']) {
    assert.equal(view(state, [item('saved', 'completed')], scope).open, true);
    assert.equal(view(state, [], scope).content, false);
  }
  state = reduce(state, { type: 'settled', error: 'late submission error' });
  assert.equal(view(state, [], 'other:reenact:version-1').content, false);
  assert.equal(view(state, [item('saved', 'completed')]).open, false);
});

test('failure stays reachable and cancelling a task does not hide saved results', () => {
  const state = reduce(reduce({}, { type: 'request' }), { type: 'settled', error: 'connection lost' });
  assert.equal(view(state).open, true);
  assert.equal(view(state).error, 'connection lost');
  assert.equal(view({}, [item('saved', 'completed'), item('cancelled', 'cancelled')]).open, true);
  assert.equal(view({}, [item('failed', 'failed')]).content, true);
});
