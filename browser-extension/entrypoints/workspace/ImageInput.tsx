import { useRef } from "react";
import LoadingPlaceholder from "../popup/LoadingPlaceholder";
import Icon from "../popup/Icon";
import { ImagePreviewButton, type ImageRotation } from "../popup/ImagePreview";

export default function ImageInput({ image, label, alt, disabled, uploading, onUpload, rotation, loading = true, error }: {
  image?: string; label: string; alt: string; disabled?: boolean; uploading?: boolean; loading?: boolean; error?: string;
  onUpload?(file?: File): void; rotation?: ImageRotation;
}) {
  const file = useRef<HTMLInputElement>(null);
  return <div className="workspace-image-input">
    <div className="workspace-image-wrap">
      {image ? <img src={image} alt={alt} /> : onUpload ? <button className="workspace-upload-empty" disabled={disabled || uploading} onClick={() => file.current?.click()}><Icon name="plus" />{uploading ? "正在读取…" : "上传主体图"}</button> : <LoadingPlaceholder active={loading && !error} className="workspace-upload-empty">{error || "正在恢复参考图…"}</LoadingPlaceholder>}
      {onUpload && <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="上传主体图" onChange={(event) => { onUpload(event.target.files?.[0]); event.target.value = ""; }} />}
    </div>
    <div className="workspace-input-caption"><strong>{label}</strong>
      <span className="image-preview-actions">{image && <ImagePreviewButton src={image} alt={alt} rotation={rotation} />}
      {image && onUpload && <button className="workspace-image-action" aria-busy={uploading || undefined} disabled={disabled || uploading} onClick={() => file.current?.click()}>{uploading ? <span className="activity-dot" aria-hidden="true" /> : <Icon name="plus" />}{uploading ? "读取中…" : "更换"}</button>}
      </span>
    </div>
  </div>;
}
