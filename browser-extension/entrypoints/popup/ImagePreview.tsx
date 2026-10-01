import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { showMotionDialog } from "../../lib/motion-dialog";
import ImageViewer from "./ImageViewer";
import Icon from "./Icon";

type PreviewProps = { src: string; alt: string; loadImage?: () => Promise<string>; className?: string; children?: ReactNode; showIcon?: boolean };
type PreviewRequest = { host: Element; src: string; alt: string; loadImage?: () => Promise<string> };

export function ImagePreviewButton({ src, alt, loadImage, className = "", children, showIcon = true, onPreview }: PreviewProps & { onPreview?(): void }) {
  const [preview, setPreview] = useState<PreviewRequest>();
  return <>
    <button type="button" className={`image-preview-trigger ${!showIcon && !children ? "image-preview-plain" : ""} ${className}`} aria-label={`放大${alt}`} title={`放大${alt}`} aria-haspopup="dialog" disabled={!src}
      onClick={event => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onPreview?.();
        setPreview({ src, alt, loadImage, host: event.currentTarget.closest(".app") || event.currentTarget.ownerDocument.body });
      }}>{children ?? (showIcon ? <Icon name="maximize" /> : null)}</button>
    {preview && createPortal(<PreviewDialog preview={preview} onClose={() => setPreview(undefined)} />, preview.host)}
  </>;
}

function PreviewDialog({ preview, onClose }: { preview: PreviewRequest; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => showMotionDialog(dialog.current!), []);
  useEffect(() => {
    let closed = false;
    setImage(""); setError("");
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
  return <dialog ref={dialog} className="modal image-preview-dialog" aria-label={`图片预览：${preview.alt}`}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    onClick={event => event.stopPropagation()}>
    <div className="image-preview-heading"><h2>图片预览</h2><button type="button" className="close-btn" aria-label="关闭图片预览" autoFocus onClick={onClose}>×</button></div>
    {error ? <div className="image-preview-status"><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>
      : image ? <ImageViewer key={attempt} src={image} alt={preview.alt} onError={() => setError("原图无法显示，请重试")} />
      : <p className="image-preview-status" role="status">正在读取原图…</p>}
  </dialog>;
}

export default function ImagePreview({ src, alt, loadImage, className = "", imageClassName, showIcon = true, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "children"> & Omit<PreviewProps, "children"> & { imageClassName?: string }) {
  return <span className={`image-preview ${className}`}>
    <img {...props} className={imageClassName} src={src} alt={alt} />
    <ImagePreviewButton src={src} alt={alt} loadImage={loadImage} showIcon={showIcon} className="image-preview-surface" />
  </span>;
}
