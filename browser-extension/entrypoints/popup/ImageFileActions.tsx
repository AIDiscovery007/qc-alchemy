import { useRef, useState } from "react";
import { request } from "../../lib/client";
import Icon from "./Icon";

export default function ImageFileActions({ jobId, generationId, disabled }: { jobId: string; generationId?: string; disabled: boolean }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const act = async (action: "open" | "reveal") => {
    if (pending.current || disabled || !generationId) return;
    pending.current = true;
    setBusy(action); setError("");
    try {
      await request({ type: "alchemy:generation-file-action", id: jobId, generationId, action });
    } catch (error) { setError((error as Error).message); }
    finally { pending.current = false; setBusy(""); }
  };
  return <>
    <button className="outline-button secondary" disabled={disabled || !!busy} aria-busy={busy === "open"} onClick={() => act("open")}><Icon name="image" />打开图片</button>
    <button className="outline-button secondary" disabled={disabled || !!busy} aria-busy={busy === "reveal"} onClick={() => act("reveal")}><Icon name="history" />在文件夹中显示</button>
    {error && <p className="image-file-notice error" role="alert">{error}</p>}
  </>;
}
