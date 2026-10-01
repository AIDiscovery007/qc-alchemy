import { showMotionDialog } from "../../lib/motion-dialog";
import { useEffect, useRef } from "react";
import { logo } from "../../lib/brand";
import Icon from "../popup/Icon";

export default function NewProject({ busy, error, onUpload, onClose }: { busy: boolean; error: string; onUpload(): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    return showMotionDialog(element);
  }, []);
  return <dialog ref={dialog} className="result-dialog modal dialog-small" aria-label="从一张参考图开始" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-head"><img src={logo} alt="" /><h2>从一张参考图开始</h2><button className="close-btn" disabled={busy} aria-label="关闭窗口" onClick={onClose}>×</button></div>
    <div className="dialog-content"><button className="primary" disabled={busy} onClick={onUpload}><Icon name="plus" />{busy ? "正在读取参考图…" : "上传参考图"}</button>{error && <div className="error" role="alert">{error}</div>}</div>
  </dialog>;
}
