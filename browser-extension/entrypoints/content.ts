import { browser } from "wxt/browser";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./popup/App";
import panelCss from "./popup/style.css?inline";
import shellCss from "./popup/shell.css?inline";
import { request } from "../lib/client";
import { logo } from "../lib/brand";
import { imageActionEnvironment, placeImageAction, type ActionPlacement } from "../lib/image-action-placement";
import type { ImageTarget } from "../lib/types";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  main(ctx) {
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;pointer-events:none;inset:0;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<button class="pick" type="button" aria-label="逆向风格" title="逆向风格 · 将这张图片交给本机 Codex"><img src="${logo}" alt=""><span>逆向风格</span></button>
    <section class="panel" role="dialog" aria-label="Alchemy 图片逆向" hidden><div class="bar"><span><img src="${logo}" alt="">QC ALCHEMY</span><button class="close" type="button" aria-label="关闭逆向面板">×</button></div><div class="panel-body"></div></section>
    <div class="notice" role="alert" hidden><div></div><button class="refresh" type="button">刷新网页</button><button class="dismiss" type="button">关闭</button></div>`;
    const styles = document.createElement("style");
    styles.textContent = panelCss + shellCss;
    shadow.prepend(styles);
    document.documentElement.append(host);
    const button = shadow.querySelector<HTMLButtonElement>(".pick")!;
    const panel = shadow.querySelector<HTMLElement>(".panel")!;
    const notice = shadow.querySelector<HTMLElement>(".notice")!;
    const closeButton = shadow.querySelector<HTMLButtonElement>(".close")!;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let opening: Animation | undefined;
    let pointerOpening = false;
    let returnFocus: HTMLElement | undefined;
    let root: Root | undefined;
    const showPanel = () => {
      const wasHidden = panel.hidden;
      if (!root) {
        root = createRoot(shadow.querySelector(".panel-body")!);
        root.render(createElement(App, { embedded: true }));
      }
      notice.hidden = true;
      panel.hidden = false;
      button.style.display = "none";
      if (wasHidden) {
        returnFocus ||= (shadow.activeElement || document.activeElement) as HTMLElement;
        closeButton.focus({ preventScroll: true });
        opening?.cancel();
        if (pointerOpening && !reducedMotion.matches)
          opening = panel.animate([{ opacity: 0, transform: "translateX(18px)" }, { opacity: 1, transform: "none" }],
            { duration: 180, easing: "cubic-bezier(.23,1,.32,1)" });
      }
      pointerOpening = false;
    };
    const closePanel = () => {
      opening?.cancel();
      panel.hidden = true;
      root?.unmount();
      root = undefined;
      position();
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
      returnFocus = undefined;
    };
    closeButton.addEventListener("click", closePanel);
    ctx.addEventListener(host, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape" && !event.defaultPrevented && !panel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
      }
    });
    ctx.addEventListener(reducedMotion, "change", () => { if (reducedMotion.matches) opening?.cancel(); });
    shadow.querySelector(".refresh")!.addEventListener("click", () => location.reload());
    shadow.querySelector(".dismiss")!.addEventListener("click", () => { notice.hidden = true; });
    let selected: { element: Element; src: string } | undefined;
    let placement: ActionPlacement | undefined;
    let anchor: DOMRect | undefined;
    let fullSize: { width: number; height: number } | undefined;
    let positioningFrame = 0;
    let busy = false;
    const rect = (element: Element): ImageTarget["rect"] => {
      const r = element.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      };
    };
    const position = () => {
      if (!selected?.element.isConnected || busy || !panel.hidden || document.hidden) {
        button.style.display = "none";
        return;
      }
      const r = selected.element.getBoundingClientRect();
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) {
        button.style.display = "none";
        return;
      }
      if (!fullSize) {
        button.style.visibility = "hidden";
        button.style.display = "inline-flex";
        const measured = button.getBoundingClientRect();
        fullSize = { width: measured.width, height: measured.height };
        button.style.visibility = "";
      }
      const previous = placement && anchor ? {
        ...placement,
        left: placement.left + r.left - anchor.left, right: placement.right + r.left - anchor.left,
        top: placement.top + r.top - anchor.top, bottom: placement.bottom + r.top - anchor.top,
      } : undefined;
      const { obstacles, isClear } = imageActionEnvironment(selected.element, host);
      placement = placeImageAction(r, { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, fullSize, obstacles, previous, isClear);
      anchor = r;
      button.style.display = placement ? "inline-flex" : "none";
      if (!placement) return;
      button.dataset.compact = String(placement.compact);
      button.style.left = `${placement.left}px`;
      button.style.top = `${placement.top}px`;
    };
    const schedulePosition = () => {
      if (positioningFrame) return;
      positioningFrame = requestAnimationFrame(() => { positioningFrame = 0; position(); });
    };
    ctx.addEventListener(document, "pointermove", (event) => {
      if (event.composedPath().includes(host) || busy) return;
      const elements = document.elementsFromPoint(event.clientX, event.clientY);
      let found: typeof selected;
      for (const el of elements) {
        if (el === document.body || el === document.documentElement) continue;
        const candidates =
          el instanceof HTMLImageElement
            ? [el]
            : [...el.querySelectorAll("img")].slice(0, 30);
        for (const img of candidates) {
          const r = img.getBoundingClientRect();
          if (
            r.width >= 80 &&
            r.height >= 80 &&
            event.clientX >= r.left &&
            event.clientX <= r.right &&
            event.clientY >= r.top &&
            event.clientY <= r.bottom &&
            img.currentSrc
          ) {
            found = { element: img, src: img.currentSrc };
            break;
          }
        }
        if (found) break;
        const r = el.getBoundingClientRect();
        const bg = getComputedStyle(el).backgroundImage.match(
          /^url\(["']?(.*?)["']?\)$/,
        )?.[1];
        if (bg && r.width >= 80 && r.height >= 80) {
          found = { element: el, src: bg };
          break;
        }
      }
      if (!found && shadow.activeElement === button) return;
      if (selected?.element !== found?.element || selected?.src !== found?.src) {
        placement = undefined;
        anchor = undefined;
        selected = found;
        schedulePosition();
      }
    });
    ctx.addEventListener(window, "scroll", schedulePosition, {
      capture: true,
      passive: true,
    });
    ctx.addEventListener(window, "resize", schedulePosition);
    ctx.addEventListener(document, "visibilitychange", schedulePosition);
    ctx.addEventListener(document, "pointerleave", () => {
      if (shadow.activeElement !== button) { selected = undefined; schedulePosition(); }
    });
    // Hover controls can be mounted late or animated without any pointer movement.
    ctx.setInterval(() => { if (selected && panel.hidden && !document.hidden) schedulePosition(); }, 240);
    button.addEventListener("click", async (event) => {
      if (!event.isTrusted || !selected || busy) return;
      event.preventDefault();
      event.stopPropagation();
      const target = { src: selected.src, rect: rect(selected.element) };
      pointerOpening = event.detail > 0;
      returnFocus = button;
      busy = true;
      panel.hidden = true;
      notice.hidden = true;
      position();
      try {
        await request({ type: "alchemy:select", target });
        showPanel();
      } catch (error) {
        notice.querySelector("div")!.textContent = error instanceof Error ? error.message : String(error);
        notice.hidden = false;
      } finally {
        busy = false;
        position();
      }
    });
    const geometry = (
      message: { type: string; src: string },
      _sender: unknown,
      reply: (r: unknown) => void,
    ) => {
      if (message.type === "alchemy:rect") {
        const unchanged =
          selected?.src === message.src &&
          (!(selected.element instanceof HTMLImageElement) ||
            selected.element.currentSrc === message.src);
        reply(unchanged ? rect(selected!.element) : null);
      }
      if (message.type === "alchemy:show") {
        showPanel();
        reply({ ok: true });
      }
      if (message.type === "alchemy:hide") {
        opening?.cancel();
        panel.hidden = true;
        notice.hidden = true;
        schedulePosition();
        reply({ ok: true });
      }
    };
    browser.runtime.onMessage.addListener(geometry);
    ctx.onInvalidated(() => {
      opening?.cancel();
      cancelAnimationFrame(positioningFrame);
      root?.unmount();
      host.remove();
      browser.runtime.onMessage.removeListener(geometry);
    });
  },
});
