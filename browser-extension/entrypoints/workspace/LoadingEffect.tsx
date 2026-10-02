import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Instance } from "img-fx";
import { useMotion } from "../../lib/use-motion";

export type LoadingEngine = { api: typeof import("img-fx"); instance: Instance; element: HTMLSpanElement };

export default function LoadingEffect({ active = true, className = "", onReady, onUnavailable, children }: {
  active?: boolean; className?: string; children?: ReactNode;
  onReady?(engine: LoadingEngine | null): void; onUnavailable?(): void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const shader = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const { reduced } = useMotion();

  useEffect(() => {
    setReady(false);
    if (!active || reduced) return;
    const element = host.current!;
    let disposed = false;
    let engine: LoadingEngine | undefined;
    let resize: ResizeObserver | undefined;
    let visibility: IntersectionObserver | undefined;
    let visible = false;
    const pause = () => {
      if (engine) engine.api.setInstancePaused(engine.instance, document.hidden || !visible);
    };
    document.addEventListener("visibilitychange", pause);
    void (async () => {
      try {
        const api = await import("img-fx");
        if (disposed) return;
        const bounds = element.getBoundingClientRect();
        const preset = api.PRESETS["pixels-organic"].modes.light;
        api.setFrameRate(10);
        api.setMaxDpr(1);
        const instance = api.createInstance({ canvas: shader.current!, cssWidth: Math.max(1, bounds.width), cssHeight: Math.max(1, bounds.height),
          preset, cardBg: "#e7e2d7" });
        engine = { api, instance, element };
        resize = new ResizeObserver(() => {
          const box = element.getBoundingClientRect();
          if (box.width && box.height) api.updateInstanceSize(instance, box.width, box.height);
        });
        resize.observe(element);
        visibility = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); pause(); });
        visibility.observe(element);
        pause();
        setReady(true);
        onReady?.(engine);
      } catch {
        if (engine) engine.api.destroyInstance(engine.instance);
        engine = undefined;
        resize?.disconnect();
        visibility?.disconnect();
        if (!disposed) { setReady(false); onUnavailable?.(); }
      }
    })();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", pause);
      resize?.disconnect();
      visibility?.disconnect();
      onReady?.(null);
      if (engine) engine.api.destroyInstance(engine.instance);
    };
  }, [active, reduced, onReady, onUnavailable]);

  return <span className={`loading-effect${ready ? "" : " static-effect"} ${className}`} ref={host} aria-hidden="true">
    <canvas ref={shader} />{children}
  </span>;
}
