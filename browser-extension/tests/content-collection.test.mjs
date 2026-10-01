import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { placeImageMenu } from "../lib/image-menu-placement.ts";

const compiled = ts.transpileModule(await readFile(new URL("../entrypoints/content.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Model only the DOM operations used by collection; no browser shadow-root access.
class Element {
  style = {};
  dataset = {};
  hidden = false;
  isConnected = true;
  listeners = new Map();
  animations = [];
  hovered = false;
  children = new Map();
  bounds = { x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 220, width: 200, height: 200 };
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ isTrusted: true, detail: 1, preventDefault() {}, stopPropagation() {}, ...event });
  }
  querySelector(selector) { return this.children.get(selector); }
  setAttribute(name, value) { this[name] = value; }
  getBoundingClientRect() { return { ...this.bounds }; }
  getClientRects() { return [this.bounds]; }
  matches(selector) { return selector === ":hover" && this.hovered; }
  contains(node) { return node != null && node === this.contained; }
  animate(frames, options) {
    const animation = { frames, options, cancelled: 0, cancel() { this.cancelled++; } };
    this.animations.push(animation);
    return animation;
  }
  prepend() {}
  append() {}
  remove() { this.isConnected = false; }
}
class ImageElement extends Element {
  constructor(src, x = 10) {
    super();
    this.currentSrc = src;
    Object.assign(this.bounds, { x, left: x, right: x + 200 });
  }
}

function setup(t, { reducedMotion = true, allowPanel = false } = {}) {
  const shadow = new Element(), host = new Element(), document = new Element();
  const selectors = [".pick-collect", ".pick-control", ".pick-toggle", ".pick-liquid", ".pick-menu", ".pick-open", ".pick-workspace", ".panel", ".notice", ".close", ".refresh", ".dismiss", ".retry", ".panel-body"];
  for (const selector of selectors) shadow.children.set(selector, new Element());
  for (const element of shadow.children.values()) element.focus = () => { shadow.activeElement = element; };
  const menu = shadow.querySelector(".pick-menu"), trigger = shadow.querySelector(".pick-toggle"), openButton = shadow.querySelector(".pick-open");
  menu.hidden = true;
  menu.contained = openButton;
  const collectButton = shadow.querySelector(".pick-collect"), notice = shadow.querySelector(".notice"), retry = shadow.querySelector(".retry");
  shadow.querySelector(".panel").hidden = notice.hidden = retry.hidden = true;
  notice.children.set("strong", new Element());
  notice.children.set(".notice-copy > span", new Element());
  host.attachShadow = () => shadow;
  document.createElement = tag => tag === "div" ? host : new Element();
  document.documentElement = new Element();
  document.body = new Element();
  let hit, messageHandler, invalidate;
  document.elementsFromPoint = () => hit ? [hit] : [];
  const requests = [], timers = new Map(), liquidStates = [], frames = new Map(), intervals = [];
  let liquidDisposed = false;
  const motion = Object.assign(new Element(), { matches: reducedMotion });
  let nextTimer = 0;
  const modules = {
    "wxt/browser": { browser: { runtime: { onMessage: { addListener(fn) { messageHandler = fn; }, removeListener() {} } } } },
    "react": { createElement() { assert.ok(allowPanel, "collection must not render the panel"); return {}; } },
    "react-dom/client": { createRoot() { assert.ok(allowPanel, "collection must not open the panel"); return { render() {}, unmount() {} }; } },
    "./popup/App": { default: null },
    "./popup/style.css?inline": { default: "" },
    "./popup/shell.css?inline": { default: "" },
    "../lib/collection-liquid": { liquidTiming: { duration: 240, ease: "ease-out" }, mountCollectionLiquid: () => ({ update(state) { liquidStates.push({ ...state }); }, dispose() { liquidDisposed = true; } }) },
    "../lib/image-menu-placement": { placeImageMenu },
    "../lib/brand": { logo: "test-logo" },
    "../lib/client": { request(message) { return new Promise((resolve, reject) => requests.push({ message, resolve, reject })); } },
    "../lib/image-action-placement": {
      imageActionEnvironment: () => ({ obstacles: [], isClear: () => true }),
      placeImageAction: bounds => ({ left: bounds.left + 10, top: bounds.top + 10, right: bounds.left + 50, bottom: bounds.top + 50, compact: false }),
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports, require: name => { assert.ok(name in modules, `unexpected import: ${name}`); return modules[name]; },
    defineContentScript: value => value,
    document, window: new Element(), HTMLImageElement: ImageElement, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: () => ({ backgroundImage: "none" }),
    matchMedia: () => motion,
    crypto, performance, queueMicrotask, Error,
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = ++nextTimer; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
  });
  exports.default.main({
    addEventListener: (target, type, fn) => target.addEventListener(type, fn),
    setInterval(fn) { intervals.push(fn); }, onInvalidated: fn => { invalidate = fn; },
  });
  t.after(() => invalidate());
  return {
    tick() { intervals.forEach(fn => fn()); const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    liquidStates, get liquidDisposed() { return liquidDisposed; },
    requests, notice, retry, timers, document, shadow, host, menu, trigger, openButton, collectButton, workspaceButton: shadow.querySelector(".pick-workspace"), motion, dispose: () => invalidate(),
    hover(image) { hit = image; document.emit("pointermove", { composedPath: () => [], clientX: image.bounds.x + 5, clientY: image.bounds.y + 5 }); },
    click(detail = 1) { trigger.emit("click", { detail }); collectButton.emit("click", { detail }); },
    geometry(message) { let value; messageHandler(message, {}, reply => { value = reply; }); return value; },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("the logo trigger opens all three actions without collecting, with Escape restoring focus", t => {
  const ui = setup(t, { reducedMotion: false });
  ui.hover(new ImageElement("https://example.com/a.png"));
  ui.trigger.emit("click");
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.menu.hidden, false);
  assert.equal(ui.trigger["aria-expanded"], "true");
  assert.equal(ui.shadow.activeElement, ui.openButton);
  assert.equal(ui.openButton.animations.length, 1);
  ui.host.emit("keydown", { key: "Escape" });
  assert.equal(ui.menu.hidden, true);
  assert.equal(ui.trigger["aria-expanded"], "false");
  assert.equal(ui.shadow.activeElement, ui.trigger);
  assert.equal(ui.openButton.animations[0].cancelled, 1);
  ui.trigger.emit("keydown", { key: "ArrowDown" });
  assert.equal(ui.menu.hidden, false);
  assert.equal(ui.openButton.animations.length, 1, "keyboard opening is immediate");
  ui.host.emit("keydown", { key: "Tab" });
  assert.equal(ui.menu.hidden, true);
});

test("immediate reverse uses the image that opened the menu and never sends collect", async t => {
  const ui = setup(t), first = new ImageElement("https://example.com/a.png");
  ui.hover(first); ui.trigger.emit("click", { detail: 0 });
  ui.hover(new ImageElement("https://example.com/b.png", 400));
  ui.openButton.emit("click", { detail: 0 });
  assert.equal(ui.menu.hidden, true);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].message.type, "alchemy:select");
  assert.equal(ui.requests[0].message.target.src, first.currentSrc);
  const target = ui.requests[0].message.target;
  assert.equal(ui.geometry({ type: "alchemy:rect", ...target }).x, first.bounds.x);
  ui.requests[0].reject(new Error("扩展已失效，请刷新网页"));
  await settle();
  assert.equal(ui.notice.querySelector("strong").textContent, "打开失败");
  assert.equal(ui.geometry({ type: "alchemy:rect", ...target }), null);
});

test("outside clicks dismiss the menu and a reused image cannot submit its old reference", t => {
  const ui = setup(t), image = new ImageElement("https://example.com/a.png");
  ui.hover(image); ui.trigger.emit("click");
  assert.equal(ui.openButton.animations.length, 0, "reduced motion skips entry");
  ui.document.emit("pointerdown", { composedPath: () => [] });
  assert.equal(ui.menu.hidden, true);
  ui.trigger.emit("click");
  image.currentSrc = "https://example.com/reused.png";
  ui.openButton.emit("click");
  assert.equal(ui.requests.length, 0);
});

test("a slower successful collection preserves another image's error and retry target", async t => {
  const ui = setup(t);
  const first = new ImageElement("https://example.com/a.png"), second = new ImageElement("https://example.com/b.png", 300);
  ui.hover(first); ui.click();
  ui.hover(second); ui.click();
  ui.requests[1].reject(new Error("图片 B 保存失败"));
  await settle();
  ui.requests[0].resolve({ projectId: "a", created: true });
  await settle();
  assert.equal(ui.notice.dataset.state, "error");
  assert.equal(ui.notice.querySelector(".notice-copy > span").textContent, "图片 B 保存失败");
  assert.equal(ui.retry.hidden, false);
  assert.equal(ui.timers.size, 0, "a later success must not schedule dismissal of the failure");
  ui.retry.emit("click");
  assert.equal(ui.requests.length, 3);
  assert.equal(ui.requests[2].message.target.src, second.currentSrc);
});

test("clicking after a virtualized image changes source collects the current source without pointer movement", t => {
  const ui = setup(t), image = new ImageElement("https://example.com/old.png");
  ui.hover(image);
  image.currentSrc = "https://example.com/new.png";
  ui.click();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].message.type, "alchemy:collect");
  assert.equal(ui.requests[0].message.target.src, image.currentSrc);
});

test("capture geometry stays bound to the clicked element after hovering a duplicate source", async t => {
  const ui = setup(t);
  const first = new ImageElement("https://example.com/same.png"), second = new ImageElement(first.currentSrc, 400);
  ui.hover(first); ui.click();
  const { captureId, src } = ui.requests[0].message.target;
  assert.ok(captureId);
  ui.hover(second);
  const message = { type: "alchemy:rect", src, captureId };
  assert.equal(ui.geometry(message).x, first.bounds.x);
  first.currentSrc = "https://example.com/reused.png";
  assert.equal(ui.geometry(message), null, "reused original elements must not fall back to another matching image");
  first.currentSrc = src;
  ui.requests[0].resolve({ projectId: "a", created: true });
  await settle();
  assert.equal(ui.geometry(message), null, "completed captures must release their element mapping");
});


test("pointer collection animates the notice once across consecutive saves and cancels when reduced motion changes", async t => {
  const ui = setup(t, { reducedMotion: false });
  ui.hover(new ImageElement("https://example.com/a.png")); ui.click();
  assert.equal(ui.notice.animations.length, 1);
  ui.hover(new ImageElement("https://example.com/b.png", 300)); ui.click();
  ui.requests[0].resolve({ projectId: "a", created: true });
  ui.requests[1].resolve({ projectId: "b", created: true });
  await settle();
  assert.equal(ui.notice.animations.length, 1, "updating a visible notice must not replay its entrance");
  ui.motion.matches = true;
  ui.motion.emit("change");
  assert.equal(ui.notice.animations[0].cancelled, 1);
});

test("keyboard collection and reduced motion skip notice entrance animation", async t => {
  for (const [reducedMotion, detail] of [[false, 0], [true, 1]]) {
    const ui = setup(t, { reducedMotion });
    ui.hover(new ImageElement("https://example.com/a.png")); ui.click(detail);
    ui.requests[0].resolve({ projectId: "a", created: true });
    await settle();
    assert.equal(ui.notice.animations.length, 0);
    assert.equal(ui.notice.dataset.state, "saved");
  }
});

test("successful notice pauses dismissal while hidden, hovered or focused and resumes afterwards", async t => {
  const ui = setup(t);
  ui.hover(new ImageElement("https://example.com/a.png")); ui.click();
  ui.requests[0].resolve({ projectId: "a", created: true });
  await settle();
  assert.equal(ui.timers.size, 1);
  ui.document.hidden = true; ui.document.emit("visibilitychange");
  assert.equal(ui.timers.size, 0);
  ui.document.hidden = false; ui.document.emit("visibilitychange");
  assert.equal(ui.timers.size, 1);
  ui.notice.hovered = true; ui.notice.emit("pointerenter");
  assert.equal(ui.timers.size, 0);
  ui.notice.hovered = false; ui.notice.emit("pointerleave");
  assert.equal(ui.timers.size, 1);
  ui.notice.contained = ui.retry; ui.shadow.activeElement = ui.retry;
  ui.notice.emit("focusin");
  assert.equal(ui.timers.size, 0);
  ui.document.emit("visibilitychange");
  assert.equal(ui.timers.size, 0, "visibility changes must not restart the timer while focus remains inside");
  ui.shadow.activeElement = null; ui.notice.emit("focusout");
  await settle();
  assert.equal(ui.timers.size, 1);
  [...ui.timers.values()][0]();
  assert.equal(ui.notice.hidden, true);
  assert.equal(ui.timers.size, 0);
});

test("invalidating the content context cancels notice animation and timer", async t => {
  const ui = setup(t, { reducedMotion: false });
  ui.hover(new ImageElement("https://example.com/a.png")); ui.click();
  ui.requests[0].resolve({ projectId: "a", created: true });
  await settle();
  assert.equal(ui.timers.size, 1);
  ui.dispose();
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.notice.animations[0].cancelled, 1);
});


test("liquid actions reverse promptly, skip keyboard motion and dispose with the content", t => {
  const ui = setup(t, { reducedMotion: false });
  ui.hover(new ImageElement("https://example.com/a.png"));
  ui.trigger.emit("click");
  assert.equal(ui.liquidStates.at(-1).open, true);
  assert.equal(ui.liquidStates.at(-1).instant, false);
  ui.trigger.emit("click");
  assert.equal(ui.menu.hidden, true, "closing removes the action immediately while its surface returns");
  assert.equal(ui.liquidStates.at(-1).open, false);
  assert.equal(ui.liquidStates.at(-1).instant, false);
  ui.trigger.emit("click");
  assert.equal(ui.liquidStates.at(-1).open, true, "reopening interrupts the return without a timer lock");
  ui.motion.matches = true; ui.motion.emit("change");
  assert.equal(ui.liquidStates.at(-1).instant, true);
  ui.host.emit("keydown", { key: "Escape" });
  assert.equal(ui.liquidStates.at(-1).open, false);
  assert.equal(ui.liquidStates.at(-1).instant, true);
  ui.trigger.emit("keydown", { key: "ArrowDown" });
  assert.equal(ui.liquidStates.at(-1).instant, true);
  ui.dispose();
  assert.equal(ui.liquidDisposed, true);
});


test("the three menu actions support arrow navigation, Home, End and Escape", t => {
  const ui = setup(t);
  ui.hover(new ImageElement("https://example.com/a.png"));
  ui.trigger.emit("keydown", { key: "ArrowUp" });
  assert.equal(ui.shadow.activeElement, ui.workspaceButton);
  ui.host.emit("keydown", { key: "ArrowDown" });
  assert.equal(ui.shadow.activeElement, ui.openButton);
  ui.host.emit("keydown", { key: "ArrowDown" });
  assert.equal(ui.shadow.activeElement, ui.collectButton);
  ui.host.emit("keydown", { key: "ArrowDown" });
  assert.equal(ui.shadow.activeElement, ui.workspaceButton);
  ui.host.emit("keydown", { key: "End" });
  assert.equal(ui.shadow.activeElement, ui.workspaceButton);
  ui.host.emit("keydown", { key: "Home" });
  assert.equal(ui.shadow.activeElement, ui.openButton);
  ui.host.emit("keydown", { key: "Escape" });
  assert.equal(ui.shadow.activeElement, ui.trigger);
  assert.equal(ui.requests.length, 0);
});

test("collecting from the menu uses its pinned image and rejects a recycled source", t => {
  const ui = setup(t), first = new ImageElement("https://example.com/a.png");
  ui.hover(first); ui.trigger.emit("click");
  ui.hover(new ImageElement("https://example.com/b.png", 400));
  ui.collectButton.emit("click");
  assert.equal(ui.requests[0].message.target.src, first.currentSrc);
  assert.equal(ui.requests[0].message.type, "alchemy:collect");
  assert.equal(ui.shadow.activeElement, ui.trigger);
  ui.trigger.emit("click");
  first.currentSrc = "https://example.com/recycled.png";
  ui.collectButton.emit("click");
  assert.equal(ui.requests.length, 1);
});

test("closing the reverse panel keeps the liquid root available for the next menu", t => {
  const ui = setup(t, { allowPanel: true });
  ui.hover(new ImageElement("https://example.com/a.png"));
  ui.trigger.emit("click");
  ui.geometry({ type: "alchemy:show" });
  ui.shadow.querySelector(".close").emit("click");
  assert.equal(ui.liquidDisposed, false);
  ui.trigger.emit("click");
  assert.equal(ui.liquidStates.at(-1).open, true);
});


test("position polling keeps the menu open when CSS rounds fractional coordinates", t => {
  const ui = setup(t, { reducedMotion: false });
  const image = new ImageElement("https://example.com/a.png", 263.328125);
  ui.hover(image); ui.tick(); ui.trigger.emit("click");
  const control = ui.shadow.querySelector(".pick-control");
  for (let poll = 0; poll < 4; poll++) {
    // CSSOM serializes the assigned coordinate with fewer decimal places.
    control.style.left = "273.328px";
    ui.tick();
    assert.equal(ui.menu.hidden, false, "a serialization difference is not movement");
  }
  assert.equal(ui.openButton.animations[0].cancelled, 0);
  image.bounds.left += 20;
  ui.tick();
  assert.equal(ui.menu.hidden, true, "actual image movement still invalidates menu placement");
});


test("focus transfer to collect does not dismiss the menu before its click", async t => {
  const ui = setup(t);
  ui.hover(new ImageElement("https://example.com/a.png"));
  ui.trigger.emit("click");
  ui.shadow.activeElement = null;
  ui.menu.emit("focusout", { relatedTarget: ui.collectButton });
  await settle();
  ui.shadow.activeElement = ui.collectButton;
  ui.collectButton.emit("click");
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].message.type, "alchemy:collect");
  assert.equal(ui.notice.dataset.state, "saving");
  ui.requests[0].resolve({ projectId: "collected", created: true });
  await settle();
  assert.equal(ui.notice.dataset.state, "saved");
});


test("workspace entry opens without capturing or collecting the hovered image", async t => {
  const ui = setup(t);
  ui.hover(new ImageElement("https://example.com/a.png"));
  ui.trigger.emit("click");
  ui.workspaceButton.emit("click", { isTrusted: false });
  assert.equal(ui.requests.length, 0);
  ui.workspaceButton.emit("click");
  ui.workspaceButton.emit("click");
  assert.equal(ui.requests.length, 1, "closed menu rejects duplicate clicks");
  assert.equal(JSON.stringify(ui.requests[0].message), '{"type":"alchemy:open-workspace"}');
  assert.equal(ui.menu.hidden, true);
  assert.equal(ui.shadow.activeElement, ui.trigger);
  ui.requests[0].resolve();
  await settle();
  assert.equal(ui.notice.hidden, true);
});

test("workspace opening errors show feedback without a collection retry", async t => {
  const ui = setup(t);
  ui.hover(new ImageElement("https://example.com/a.png"));
  ui.trigger.emit("click");
  ui.workspaceButton.emit("click");
  ui.requests[0].reject(new Error("无法打开标签页"));
  await settle();
  assert.equal(ui.notice.hidden, false);
  assert.equal(ui.notice.querySelector("strong").textContent, "打开工作台失败");
  assert.equal(ui.notice.querySelector(".notice-copy > span").textContent, "无法打开标签页");
  assert.equal(ui.retry.hidden, true);
});
