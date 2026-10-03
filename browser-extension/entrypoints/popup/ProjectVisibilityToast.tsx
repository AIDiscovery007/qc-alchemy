import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import Icon from "./Icon";

type Notice = { ids: string[]; hidden: boolean; undone: boolean };
export default function ProjectVisibilityToast({ notice, error, busy, containerRef, onUndo, onDismiss }: {
  notice?: Notice; error: string; busy: boolean; containerRef: RefObject<HTMLDivElement | null>;
  onUndo(): void; onDismiss(): void;
}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const remaining = useRef(0), dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => { containerRef.current?.showPopover?.(); }, []);
  useLayoutEffect(() => { setFocused(!!containerRef.current?.contains(document.activeElement)); }, [notice, error]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => { remaining.current = notice && !notice.undone ? 6000 : 4000; }, [notice, error]);
  useEffect(() => {
    if (error || busy || hovered || focused || hidden) return;
    const started = performance.now();
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) dismiss.current(); }, remaining.current);
    return () => { cancelled = true; clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (performance.now() - started)); };
  }, [notice, error, busy, hovered, focused, hidden]);
  return <div ref={containerRef} popover="manual" className="project-visibility-feedback" tabIndex={-1}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div>{notice && <span role="status">{notice.undone ? "已撤销 · " : ""}{notice.hidden ? "已隐藏" : "已恢复"} {notice.ids.length} 个项目</span>}
      {error && <p role="alert">{error}</p>}</div>
    {notice && !notice.undone && <button type="button" className="text-button" disabled={busy} onClick={onUndo}>撤销</button>}
    <button type="button" className="text-button" aria-label="关闭提示" disabled={busy} onClick={onDismiss}><Icon name="close" /></button>
  </div>;
}
