import { browser } from "wxt/browser";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./popup/App";
import panelCss from "./popup/style.css?inline";
import { request } from "../lib/client";
import { logo } from "../lib/brand";
import type { ImageTarget } from "../lib/types";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  main(ctx) {
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;pointer-events:none;inset:0;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      .pick{all:initial;box-sizing:border-box;position:fixed;display:none;pointer-events:auto;cursor:pointer;border:1px solid #ffffff50;border-radius:99px;padding:10px 14px;background:#22231ff5;color:#f7f5ed;box-shadow:0 4px 18px #0003;font:600 12px/1.3 system-ui,sans-serif;letter-spacing:.02em}
      .pick:hover{background:#c9ed89;color:#22231f}button:focus-visible{outline:3px solid #c9ed89}
      .pick img{width:18px;height:18px;vertical-align:-4px;margin-right:5px}.bar>span{display:flex;align-items:center;gap:5px}.bar img{width:16px;height:16px}
      .panel{position:fixed;top:12px;right:12px;bottom:12px;width:min(400px,calc(100vw - 24px));display:flex;flex-direction:column;pointer-events:auto;border:1px solid #dfe4d4;border-radius:14px;overflow:hidden;background:#f7f7f2;box-shadow:0 12px 48px #0003}
      .panel[hidden],.notice[hidden]{display:none!important}.bar{display:flex;align-items:center;justify-content:space-between;padding:7px 14px;border-bottom:1px solid #e1e5d9;font:11px system-ui;color:#747f68}.close{border:0;background:transparent;color:#566449;cursor:pointer;font:22px/1 system-ui;padding:2px 5px}.panel-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;color:#252820;font:13px/1.6 system-ui,sans-serif}.panel-body .app{min-height:100%}
      .notice{position:fixed;bottom:20px;left:20px;max-width:360px;padding:14px 18px;border-radius:12px;pointer-events:auto;background:#293326;color:#f7f7f2;box-shadow:0 4px 18px #0003;font:13px/1.6 system-ui}.notice button{margin:8px 12px 0 0;padding:5px 10px;border:0;border-radius:6px;background:#d4ecab;color:#293326;cursor:pointer}
    </style><button class="pick" type="button" title="将这张图片交给本机 Codex 提取风格"><img src="${logo}" alt="">逆向风格</button>
    <section class="panel" role="dialog" aria-label="Alchemy 图片逆向" hidden><div class="bar"><span><img src="${logo}" alt="">QC ALCHEMY · 图片逆向</span><button class="close" type="button" aria-label="关闭逆向面板">×</button></div><div class="panel-body"></div></section>
    <div class="notice" role="alert" hidden><div></div><button class="refresh" type="button">刷新网页</button><button class="dismiss" type="button">关闭</button></div>`;
    const styles = document.createElement("style");
    styles.textContent = panelCss;
    shadow.prepend(styles);
    document.documentElement.append(host);
    const button = shadow.querySelector<HTMLButtonElement>(".pick")!;
    const panel = shadow.querySelector<HTMLElement>(".panel")!;
    const notice = shadow.querySelector<HTMLElement>(".notice")!;
    let root: Root | undefined;
    const showPanel = () => {
      if (!root) {
        root = createRoot(shadow.querySelector(".panel-body")!);
        root.render(createElement(App));
      }
      notice.hidden = true;
      panel.hidden = false;
    };
    shadow.querySelector(".close")!.addEventListener("click", () => {
      panel.hidden = true;
      root?.unmount();
      root = undefined;
    });
    shadow.querySelector(".refresh")!.addEventListener("click", () => location.reload());
    shadow.querySelector(".dismiss")!.addEventListener("click", () => { notice.hidden = true; });
    let selected: { element: Element; src: string } | undefined;
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
      if (!selected?.element.isConnected || busy) {
        button.style.display = "none";
        return;
      }
      const r = selected.element.getBoundingClientRect();
      if (r.bottom < 35 || r.top > innerHeight - 25) {
        button.style.display = "none";
        return;
      }
      button.style.display = "block";
      button.style.left = `${Math.max(8, Math.min(innerWidth - 130, r.right - 124))}px`;
      button.style.top = `${Math.max(8, r.top + 10)}px`;
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
      selected = found;
      position();
    });
    ctx.addEventListener(window, "scroll", position, {
      capture: true,
      passive: true,
    });
    ctx.addEventListener(window, "resize", position);
    button.addEventListener("click", async (event) => {
      if (!event.isTrusted || !selected || busy) return;
      event.preventDefault();
      event.stopPropagation();
      const target = { src: selected.src, rect: rect(selected.element) };
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
        panel.hidden = true;
        notice.hidden = true;
        reply({ ok: true });
      }
    };
    browser.runtime.onMessage.addListener(geometry);
    ctx.onInvalidated(() => {
      root?.unmount();
      host.remove();
      browser.runtime.onMessage.removeListener(geometry);
    });
  },
});
