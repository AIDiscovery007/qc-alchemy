import { useEffect, useRef, useState } from "react";
import { constrainView, zoomView, type View } from "../../lib/image-view";
import Icon from "./Icon";

export default function ImageViewer({ src, alt, onError }: { src: string; alt: string; onError?(): void }) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const controls = useRef<(factor: number) => void>(() => {});
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = stage.current!, picture = image.current!;
    let view: View = { scale: 1, x: 0, y: 0 };
    let frame = { width: 0, height: 0 }, fitted = { width: 0, height: 0 };
    const pointers = new Map<number, { x: number; y: number }>();
    const draw = (next: View) => {
      view = constrainView(next, frame, fitted);
      picture.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
      element.dataset.zoomed = String(view.scale > 1);
      setScale(view.scale);
    };
    const resize = () => {
      frame = { width: element.clientWidth, height: element.clientHeight };
      if (!picture.naturalWidth || !frame.width || !frame.height) return;
      const ratio = Math.min(Math.max(1, frame.width - 40) / picture.naturalWidth, Math.max(1, frame.height - 40) / picture.naturalHeight);
      fitted = { width: picture.naturalWidth * ratio, height: picture.naturalHeight * ratio };
      picture.style.width = `${fitted.width}px`; picture.style.height = `${fitted.height}px`;
      draw(view);
    };
    const point = (event: MouseEvent | PointerEvent | WheelEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
    };
    controls.current = factor => draw(factor ? zoomView(view, view.scale * factor) : { scale: 1, x: 0, y: 0 });
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.height : 1);
      draw(zoomView(view, view.scale * Math.exp(-Math.max(-300, Math.min(300, delta)) * .002), point(event)));
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || pointers.size >= 2) return;
      element.focus({ preventScroll: true });
      pointers.set(event.pointerId, point(event));
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "true";
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const next = point(event);
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const anchor = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
        const zoomed = zoomView(view, view.scale * Math.hypot(next.x - other.x, next.y - other.y) / Math.max(1, distance), anchor);
        draw({ ...zoomed, x: zoomed.x + (next.x - previous.x) / 2, y: zoomed.y + (next.y - previous.y) / 2 });
      } else draw({ ...view, x: view.x + next.x - previous.x, y: view.y + next.y - previous.y });
      pointers.set(event.pointerId, next);
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      element.dataset.dragging = String(pointers.size > 0);
    };
    const cancel = () => {
      for (const id of pointers.keys()) if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      pointers.clear(); element.dataset.dragging = "false";
    };
    const doubleClick = (event: MouseEvent) => draw(view.scale > 1 ? { scale: 1, x: 0, y: 0 } : zoomView(view, 2, point(event)));
    const key = (event: KeyboardEvent) => {
      const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[event.key];
      if (pan) draw({ ...view, x: view.x + pan[0]!, y: view.y + pan[1]! });
      else if (["+", "=", "-", "0"].includes(event.key)) controls.current(event.key === "0" ? 0 : event.key === "-" ? 1 / 1.25 : 1.25);
      else return;
      event.preventDefault(); event.stopPropagation();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    picture.addEventListener("load", resize);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("lostpointercapture", up);
    element.addEventListener("dblclick", doubleClick);
    element.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    resize();
    return () => {
      observer.disconnect(); picture.removeEventListener("load", resize);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up); element.removeEventListener("pointercancel", up);
      element.removeEventListener("lostpointercapture", up); element.removeEventListener("dblclick", doubleClick);
      element.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel); cancel();
      controls.current = () => {};
    };
  }, [src]);

  return <div className="image-viewer">
    <div ref={stage} className="image-viewer-stage" role="region" aria-label="图片缩放与拖拽" tabIndex={0}>
      <img ref={image} src={src} alt={alt} draggable={false} onError={onError} />
    </div>
    <div className="image-viewer-tools" role="group" aria-label="缩放控制">
      <button type="button" aria-label="缩小图片" disabled={scale <= 1} onClick={() => controls.current(1 / 1.25)}>−</button>
      <output aria-label="缩放比例">{Math.round(scale * 100)}%</output>
      <button type="button" aria-label="放大图片" disabled={scale >= 8} onClick={() => controls.current(1.25)}>+</button>
      <button type="button" aria-label="适应窗口" title="适应窗口" onClick={() => controls.current(0)}><Icon name="maximize" /></button>
    </div>
  </div>;
}
