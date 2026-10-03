import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createTaskFeed } from '../bridge/task-feed.mjs';

const exports = {};
runInNewContext(ts.transpileModule(await readFile(new URL('../lib/task-reminders.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { newReminderState, reconcileReminders, markRemindersRead } = exports;
const task = (id, status = 'running', extra = {}) => ({ id, jobId: id, projectId: 'a'.repeat(64), mode: 'style', status, createdAt: new Date(2000).toISOString(), hidden: false, ...extra });

test('first use ignores history, catches fast new tasks and tracks restored running tasks', () => {
  let state = newReminderState(1000);
  assert.equal(state.preferences.sound, false);
  state = reconcileReminders(state, [task('old', 'completed', { createdAt: new Date(0).toISOString() }), task('running', 'running', { createdAt: new Date(0).toISOString() }), task('fast', 'completed')], 3000);
  assert.deepEqual([...state.unread.map(item => item.id)], ['fast']);
  state = reconcileReminders(state, [task('running', 'failed', { createdAt: new Date(0).toISOString() }), task('fast', 'completed')], 4000);
  assert.deepEqual([...state.unread.map(item => item.id)], ['fast', 'running']);
});

test('parallel prompt and image deduplicate across restart; cancellation is silent and reads are exact', () => {
  let state = reconcileReminders(newReminderState(1000), [task('prompt'), task('image', 'running', { jobId: 'prompt', generationId: 'image' }), task('cancel')], 3000);
  const finished = [task('prompt', 'completed'), task('image', 'completed', { jobId: 'prompt', generationId: 'image' }), task('cancel', 'cancelled')];
  state = reconcileReminders(state, finished, 4000);
  assert.equal(state.unread.length, 2); assert.equal(state.due, 9000);
  state = reconcileReminders(JSON.parse(JSON.stringify(state)), finished, 4500);
  assert.equal(state.unread.length, 2); assert.equal(state.due, 9000);
  state = markRemindersRead(state, ['image']);
  assert.deepEqual([...state.unread.map(item => item.id)], ['prompt']);
  state = reconcileReminders(state, finished, 5000);
  assert.deepEqual([...state.unread.map(item => item.id)], ['prompt']);
});

test('hidden completions do not deliver; deletion clears unread and 45 completions survive', () => {
  const tasks = Array.from({ length: 45 }, (_, id) => task(String(id), 'completed', { hidden: id === 0 }));
  let state = reconcileReminders(newReminderState(1000), tasks, 3000);
  assert.equal(state.unread.length, 45); assert.equal(state.pending.length, 44);
  state = reconcileReminders(state, tasks.slice(1), 4000);
  assert.equal(state.unread.length, 44);
});

test('feed keeps committed metadata immutable, wakes long polls and cleans disconnected listeners', async () => {
  const feed = createTaskFeed(), response = new EventEmitter();
  const job = { ...task('job'), result: { promptZh: 'private' }, imageAsset: 'private.png', generations: [] };
  const jobs = new Map([['job', job]]), projects = { isHidden: () => false };
  feed.update(job);
  const first = feed.snapshot(jobs, projects);
  job.status = 'completed';
  assert.equal(feed.snapshot(jobs, projects).tasks[0].status, 'running');
  const waiting = feed.wait(first.revision, response);
  assert.equal(response.listenerCount('close'), 1);
  feed.update(job); await waiting;
  assert.equal(response.listenerCount('close'), 0);
  const next = feed.snapshot(jobs, projects);
  assert.equal(next.tasks[0].status, 'completed');
  assert.ok(!JSON.stringify(next).includes('private'));
  const closed = feed.wait(next.revision, response); response.emit('close'); await closed;
  assert.equal(response.listenerCount('close'), 0);
  jobs.clear(); feed.touch(); assert.equal(feed.snapshot(jobs, projects).tasks.length, 0);
});

test('toast sync removes read, hidden and deleted results; unchanged polling preserves its lifetime', () => {
  const { reconcileToast } = exports;
  const current = [task('prompt', 'completed'), task('image', 'failed')];
  assert.equal(reconcileToast(current, undefined, structuredClone(current), []), current);
  assert.equal(reconcileToast(current, structuredClone(current), structuredClone(current), []), current);
  const remaining = reconcileToast(current, undefined, [current[1]], []);
  assert.deepEqual(Array.from(remaining, item => item.id), ['image']);
  assert.equal(reconcileToast(remaining, undefined, [{ ...current[1], hidden: true }], []).length, 0);
  assert.equal(reconcileToast(current, undefined, [], []).length, 0);
  assert.equal(reconcileToast(current, current, current, ['prompt', 'image']).length, 0);
  // A queued delivery cannot resurrect an already-read/hidden result.
  assert.equal(reconcileToast([], current, [{ ...current[0], hidden: true }], []).length, 0);
});
