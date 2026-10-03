import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ImgHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { showMotionDialog } from "../../lib/motion-dialog";
import { rotateImage } from "../../lib/image";
import ImageViewer from "./ImageViewer";
import Icon from "./Icon";

export type ImageRotation = { maxBytes?: number; disabled?: boolean; onApply(image: string): void | Promise<void> };
type PreviewProps = { src: string; alt: string; loadImage?: () => Promise<string>; className?: string; disabled?: boolean; rotation?: ImageRotation };
type PreviewRequest = { host: Element; src: string; alt: string; loadImage?: () => Promise<string> };

export function ImagePreviewButton({ src, alt, loadImage, className = "", disabled, onPreview, rotation }: PreviewProps & { onPreview?(): void }) {
  const [preview, setPreview] = useState<PreviewRequest>();
  useEffect(() => {
    if (rotation && preview && preview.src !== src) setPreview(undefined);
  }, [src, preview, !!rotation]);
  return <>
    <button type="button" className={`image-preview-trigger ${className}`} aria-label={`放大${alt}`} title={`放大${alt}`} aria-haspopup="dialog" disabled={disabled || !src}
      onClick={event => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onPreview?.();
        setPreview({ src, alt, loadImage, host: event.currentTarget.closest(".app") || event.currentTarget.ownerDocument.body });
      }}><Icon name="maximize" /></button>
    {preview && createPortal(<PreviewDialog preview={preview} rotation={preview.src === src ? rotation : undefined} onClose={() => setPreview(undefined)} />, preview.host)}
  </>;
}

function PreviewDialog({ preview, rotation, onClose }: { preview: PreviewRequest; rotation?: ImageRotation; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [turned, setTurned] = useState<{ image: string; turns: number }>();
  const [processing, setProcessing] = useState<"" | "rotating" | "saving">("");
  const [rotationError, setRotationError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => showMotionDialog(dialog.current!), []);
  useEffect(() => {
    let closed = false;
    setImage(""); setError(""); setTurned(undefined); setRotationError("");
    async function load() {
      try {
        const value = preview.loadImage ? await preview.loadImage() : preview.src;
        if (!value) throw new Error("原图暂不可用");
        if (!closed) setImage(value);
      } catch (reason) { if (!closed) setError(reason instanceof Error ? reason.message : "无法读取原图"); }
    }
    void load();
    return () => { closed = true; };
  }, [preview, attempt]);
  const rotate = async (direction: number) => {
    if (!rotation || rotation.disabled || processing || !image) return;
    const turns = ((turned?.turns || 0) + direction + 4) % 4;
    setProcessing("rotating"); setRotationError("");
    try {
      const value = await rotateImage(image, turns, rotation.maxBytes);
      if (alive.current) setTurned({ image: value, turns });
    } catch (reason) { if (alive.current) setRotationError((reason as Error).message || "旋转失败，请重试"); }
    finally { if (alive.current) setProcessing(""); }
  };
  const apply = async () => {
    if (!rotation || rotation.disabled || processing || !turned?.turns) return;
    setProcessing("saving"); setRotationError("");
    try {
      await rotation.onApply(turned.image);
      if (alive.current) onClose();
    } catch (reason) { if (alive.current) setRotationError((reason as Error).message || "应用失败，请重试"); }
    finally { if (alive.current) setProcessing(""); }
  };
  const close = () => { if (processing !== "saving") onClose(); };
  return <dialog ref={dialog} className="modal image-preview-dialog" aria-label={`图片预览：${preview.alt}`}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
    onClick={event => event.stopPropagation()}>
    <div className="image-preview-heading"><h2>图片预览</h2><button type="button" className="close-btn" aria-label="关闭图片预览" disabled={processing === "saving"} autoFocus onClick={close}>×</button></div>
    {error ? <div className="image-preview-status"><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>
      : image ? <ImageViewer key={attempt} src={turned?.image || image} alt={preview.alt} onError={() => setError("原图无法显示，请重试")} />
      : <p className="image-preview-status" role="status">正在读取原图…</p>}
    {rotation && <div className="image-rotation-tools" aria-label="调整输入图片">
      {rotationError && <p role="alert">{rotationError}</p>}
      <div>
        <button type="button" disabled={!image || !!error || !!processing || rotation.disabled} onClick={() => void rotate(-1)}>左转 90°</button>
        <button type="button" disabled={!image || !!error || !!processing || rotation.disabled} onClick={() => void rotate(1)}>右转 90°</button>
        <button type="button" className="apply-rotation" disabled={!turned?.turns || !!error || !!processing || rotation.disabled} aria-busy={processing === "saving"} onClick={() => void apply()}>{processing === "saving" ? "正在应用…" : processing === "rotating" ? "正在旋转…" : "应用旋转"}</button>
      </div>
    </div>}
  </dialog>;
}

export default function ImagePreview({ src, alt, loadImage, className = "", imageClassName, disabled, rotation, imageButton, children, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "children"> & PreviewProps & {
  imageClassName?: string; imageButton?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">; children?: ReactNode;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [bounds, setBounds] = useState<{ src: string; left: number; top: number; width: number; height: number }>();
  useLayoutEffect(() => {
    const img = image.current!, host = frame.current!;
    const measure = () => {
      if (!img.complete || !img.naturalWidth || !img.clientWidth || !img.clientHeight) { setBounds(undefined); return; }
      const style = getComputedStyle(img), box = img.getBoundingClientRect(), outer = host.getBoundingClientRect();
      const px = (value: string) => parseFloat(value) || 0;
      const x = px(style.paddingLeft), y = px(style.paddingTop);
      const contentWidth = img.clientWidth - x - px(style.paddingRight), contentHeight = img.clientHeight - y - px(style.paddingBottom);
      // All preview images are centered. Cover fills the content box; contain leaves letterboxing.
      const scale = Math.min(contentWidth / img.naturalWidth, contentHeight / img.naturalHeight, style.objectFit === "scale-down" ? 1 : Infinity);
      const contained = style.objectFit === "contain" || style.objectFit === "scale-down";
      const width = contained ? img.naturalWidth * scale : contentWidth, height = contained ? img.naturalHeight * scale : contentHeight;
      const next = { src, left: box.left - outer.left + img.clientLeft + x + (contentWidth - width) / 2, top: box.top - outer.top + img.clientTop + y + (contentHeight - height) / 2, width, height };
      setBounds(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host); observer.observe(img);
    img.addEventListener("load", measure); img.addEventListener("error", measure); measure();
    return () => { observer.disconnect(); img.removeEventListener("load", measure); img.removeEventListener("error", measure); };
  }, [src]);
  const picture = <><img {...props} ref={image} className={imageClassName} src={src} alt={alt} />{children}</>;
  return <span ref={frame} className={`image-preview ${className}`}>
    {imageButton ? <button {...imageButton} type="button" className={`image-preview-select ${imageButton.className || ""}`}>{picture}</button> : picture}
    <span className="image-preview-anchor" hidden={bounds?.src !== src} style={bounds && { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}>
      <ImagePreviewButton src={src} alt={alt} loadImage={loadImage} disabled={disabled || bounds?.src !== src} rotation={rotation} />
    </span>
  </span>;
}
