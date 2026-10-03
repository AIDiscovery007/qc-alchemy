import { useCallback, useEffect, useRef, useState } from "react";
import LoadingEffect, { type LoadingEngine } from "./LoadingEffect";
import { useMotion } from "../../lib/use-motion";

// Mounted per selected generation. Historical results never replay the effect.
export default function GenerationEffect({ running, image, failed }: { running: boolean; image: string; failed: boolean }) {
  const [finished, setFinished] = useState(!running);
  const [engine, setEngine] = useState<LoadingEngine | null>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const finish = useCallback(() => setFinished(true), []);
  const active = !finished && !failed;
  const { reduced } = useMotion();

  useEffect(() => {
    if (reduced && image) setFinished(true);
  }, [reduced, image]);

  useEffect(() => {
    if (!active || !engine || !image) return;
    if (document.hidden) { setFinished(true); return; }
    let disposed = false;
    let resize: ResizeObserver | undefined;
    const finishInBackground = () => { if (document.hidden) setFinished(true); };
    document.addEventListener("visibilitychange", finishInBackground);
    const source = new Image();
    source.src = image;
    // Never let an optional animation delay access to an available result indefinitely.
    const timeout = setTimeout(() => setFinished(true), 2000);
    void (async () => {
      try {
        await source.decode();
        if (disposed) return;
        const { width, height } = engine.element.getBoundingClientRect();
        const preset = engine.api.PRESETS["pixels-organic"].modes.light;
        engine.api.setInstancePreset(engine.instance, { ...preset, revealConfig: { ...preset.revealConfig, duration: 0.7, pixDuration: 0.7 } });
        engine.instance.reveal = engine.api.createReveal({ canvas: overlay.current!, cssWidth: width, cssHeight: height, shaderCanvas: engine.instance.canvas });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.fillStyle = "#e7e2d7";
        context.fillRect(0, 0, canvas.width, canvas.height);
        // img-fx 0.5.1 trims 0.6% of the shorter edge. Compose within that crop
        // so its cover-based reveal matches the aligned canvas with edge-to-edge contain.
        const trim = Math.min(canvas.width, canvas.height) * 0.006;
        context.translate(trim, trim);
        context.scale((canvas.width - 2 * trim) / width, (canvas.height - 2 * trim) / height);
        const scale = Math.min(Math.max(1, width) / source.naturalWidth, Math.max(1, height) / source.naturalHeight);
        const w = source.naturalWidth * scale, h = source.naturalHeight * scale;
        context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
        const composed = new Image();
        composed.src = canvas.toDataURL();
        await composed.decode();
        if (disposed) return;
        engine.api.updateInstanceSize(engine.instance, width, height);
        engine.element.dataset.phase = "reveal";
        resize = new ResizeObserver(() => {
          const box = engine.element.getBoundingClientRect();
          if (Math.abs(box.width - width) > 1 || Math.abs(box.height - height) > 1) setFinished(true);
        });
        resize.observe(engine.element);
        engine.instance.reveal!.startReveal({ image: composed, cssWidth: width, cssHeight: height,
          onRevealComplete: () => { if (!disposed) setFinished(true); } });
      } catch { if (!disposed) setFinished(true); }
    })();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      resize?.disconnect();
      document.removeEventListener("visibilitychange", finishInBackground);
    };
  }, [active, engine, image]);

  return active ? <LoadingEffect className="generation-effect" onReady={setEngine} onUnavailable={finish}>
    <canvas ref={overlay} />
  </LoadingEffect> : !failed && (running || !image) ? <LoadingEffect className="generation-effect" active={false} /> : null;
}
