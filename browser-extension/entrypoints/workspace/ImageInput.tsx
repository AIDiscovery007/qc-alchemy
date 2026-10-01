import { useRef } from "react";
import Icon from "../popup/Icon";
import ImagePreview, { type ImageRotation } from "../popup/ImagePreview";

export default function ImageInput({ image, label, caption, alt, disabled, uploading, onUpload, rotation }: {
  image?: string; label: string; caption: string; alt: string; disabled?: boolean; uploading?: boolean;
  onUpload?(file?: File): void; rotation?: ImageRotation;
}) {
  const file = useRef<HTMLInputElement>(null);
  return <div className="workspace-image-input">
    <div className="workspace-image-wrap">
      {image ? <ImagePreview src={image} alt={alt} rotation={rotation} /> : onUpload ? <button className="workspace-upload-empty" disabled={disabled || uploading} onClick={() => file.current?.click()}><Icon name="plus" />{uploading ? "正在读取…" : "上传主体图"}</button> : <span className="workspace-upload-empty">正在恢复参考图…</span>}
      {image && onUpload && <button className="workspace-image-action" aria-busy={uploading || undefined} disabled={disabled || uploading} onClick={() => file.current?.click()}>{uploading ? <span className="activity-dot" aria-hidden="true" /> : <Icon name="plus" />}{uploading ? "读取中…" : "更换"}</button>}
      {onUpload && <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="上传主体图" onChange={(event) => { onUpload(event.target.files?.[0]); event.target.value = ""; }} />}
    </div>
    <div className="workspace-input-caption"><strong>{label}</strong><span>{caption}</span></div>
  </div>;
}
