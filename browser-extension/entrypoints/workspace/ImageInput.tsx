import { useEffect, useRef, useState } from "react";
import { logo } from "../../lib/brand";
import Icon from "../popup/Icon";

export default function ImageInput({ image, label, caption, alt, disabled, uploading, onUpload }: {
  image?: string; label: string; caption: string; alt: string; disabled?: boolean; uploading?: boolean;
  onUpload?(file?: File): void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [expanded]);
  return <div className="workspace-image-input">
    <div className="workspace-image-wrap">
      {image ? <img src={image} alt={alt} /> : onUpload ? <button className="workspace-upload-empty" disabled={disabled || uploading} onClick={() => file.current?.click()}><Icon name="plus" />{uploading ? "正在读取…" : "上传主体图"}</button> : <span className="workspace-upload-empty">正在恢复参考图…</span>}
      {image && <button className="workspace-image-action" disabled={onUpload ? disabled || uploading : false} onClick={() => onUpload ? file.current?.click() : setExpanded(true)}><Icon name={onUpload ? "plus" : "maximize"} />{onUpload ? "更换" : "放大"}</button>}
      {onUpload && <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="上传主体图" onChange={(event) => { onUpload(event.target.files?.[0]); event.target.value = ""; }} />}
    </div>
    <div className="workspace-input-caption"><strong>{label}</strong><span>{caption}</span></div>
    {expanded && <dialog ref={dialog} className="result-dialog modal zoom-modal" aria-label={`${label}大图`} onCancel={(event) => { event.preventDefault(); setExpanded(false); }}><div className="modal-head"><img src={logo} alt="" /><h2>图片预览</h2><button className="close-btn" aria-label="关闭窗口" autoFocus onClick={() => setExpanded(false)}>×</button></div><div className="zoom-image"><img src={image} alt={alt} /></div></dialog>}
  </div>;
}
