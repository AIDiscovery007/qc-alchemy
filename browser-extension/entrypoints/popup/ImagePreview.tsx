import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
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

export default function ImagePreview({ src, alt, loadImage, className = "", imageClassName, disabled, rotation, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "children"> & PreviewProps & { imageClassName?: string }) {
  return <span className={`image-preview ${className}`}>
    <img {...props} className={imageClassName} src={src} alt={alt} />
    <span className="image-preview-actions"><ImagePreviewButton src={src} alt={alt} loadImage={loadImage} disabled={disabled} rotation={rotation} /></span>
  </span>;
}
