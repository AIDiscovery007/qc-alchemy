import { useEffect, useRef, useState } from "react";
import type { Instance } from "img-fx";

type Engine = typeof import("img-fx");

// Mounted per selected generation. Historical results never replay the effect.
export default function GenerationEffect({ running, image, failed }: { running: boolean; image: string; failed: boolean }) {
  const [finished, setFinished] = useState(!running);
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const shader = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const engine = useRef<{ api: Engine; instance: Instance } | undefined>(undefined);
  const revealing = useRef(false);
  const active = !finished && !failed;

  useEffect(() => {
    if (!active) return;
    const element = host.current!;
    let disposed = false;
    let resize: ResizeObserver | undefined;
    let visibility: IntersectionObserver | undefined;
    let visible = true;
    const stop = () => setFinished(true);
    const pause = () => {
      const value = engine.current;
      if (value) value.api.setInstancePaused(value.instance, document.hidden || !visible);
      // A result ready in the background should be available immediately on return.
      if (document.hidden && revealing.current) stop();
    };
    document.addEventListener("visibilitychange", pause);
    void import("img-fx").then(api => {
      if (disposed) return;
      const bounds = element.getBoundingClientRect();
      const preset = api.PRESETS["pixels-organic"].modes.light;
      api.setFrameRate(10);
      api.setMaxDpr(1);
      const instance = api.createInstance({ canvas: shader.current!, cssWidth: bounds.width, cssHeight: bounds.height,
        preset: { ...preset, revealConfig: { ...preset.revealConfig, duration: 0.7, pixDuration: 0.7 } }, cardBg: "#e7e2d7" });
      engine.current = { api, instance };
      instance.reveal = api.createReveal({ canvas: overlay.current!, cssWidth: bounds.width, cssHeight: bounds.height, shaderCanvas: shader.current! });
      resize = new ResizeObserver(() => {
        const box = element.getBoundingClientRect();
        // Avoid stretching a composed reveal when the pane changes size.
        if (revealing.current && (Math.abs(box.width - instance.cssWidth) > 1 || Math.abs(box.height - instance.cssHeight) > 1)) stop();
        else api.updateInstanceSize(instance, box.width, box.height);
      });
      resize.observe(element);
      visibility = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); pause(); });
      visibility.observe(element);
      pause();
      setReady(true);
    }).catch(stop);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", pause);
      resize?.disconnect();
      visibility?.disconnect();
      const value = engine.current;
      if (value) value.api.destroyInstance(value.instance);
      engine.current = undefined;
    };
  }, [active]);

  useEffect(() => {
    if (!active || !ready || !image) return;
    if (document.hidden) { setFinished(true); return; }
    let disposed = false;
    const source = new Image();
    source.src = image;
    // Never let an optional animation delay access to an available result indefinitely.
    const timeout = setTimeout(() => setFinished(true), 2000);
    void source.decode().then(async () => {
      if (disposed || !engine.current || !host.current) return;
      const { width, height } = host.current.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#e7e2d7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      // img-fx 0.5.1 trims 0.6% of the shorter edge. Compose within that crop
      // so its cover-based reveal matches our existing contain + 16px padding.
      const trim = Math.min(canvas.width, canvas.height) * 0.006;
      context.translate(trim, trim);
      context.scale((canvas.width - 2 * trim) / width, (canvas.height - 2 * trim) / height);
      const scale = Math.min(Math.max(1, width - 32) / source.naturalWidth, Math.max(1, height - 32) / source.naturalHeight);
      const w = source.naturalWidth * scale, h = source.naturalHeight * scale;
      context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
      const composed = new Image();
      composed.src = canvas.toDataURL();
      await composed.decode();
      if (disposed || !engine.current) return;
      revealing.current = true;
      engine.current.api.updateInstanceSize(engine.current.instance, width, height);
      host.current!.dataset.phase = "reveal";
      engine.current.instance.reveal!.startReveal({ image: composed, cssWidth: width, cssHeight: height,
        onRevealComplete: () => { if (!disposed) setFinished(true); } });
    }).catch(() => { if (!disposed) setFinished(true); });
    return () => { disposed = true; clearTimeout(timeout); };
  }, [active, ready, image]);

  return active ? <div className={`generation-effect${ready ? "" : " static-effect"}`} ref={host} aria-hidden="true">
    <canvas ref={shader} /><canvas ref={overlay} />
  </div> : !failed && (running || !image) ? <div className="generation-effect static-effect" aria-hidden="true" /> : null;
}
