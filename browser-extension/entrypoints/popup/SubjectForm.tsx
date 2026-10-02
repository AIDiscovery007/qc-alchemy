import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import TaskInstruction from "./TaskInstruction";
import AsyncAction from "./AsyncAction";
import ImageInput from "../workspace/ImageInput";
import { normalizeImage } from "../../lib/image";
import type { Job, SubjectInput, Selection } from "../../lib/types";

export default function SubjectForm({ mode, selection, job, active, disabled, submitting, subjectImage, onSubjectChange, onSubmit, onExtract, onSwap, onReferenceRotate, instruction, onInstructionChange, status, onCancel, hideAction = false, cancelling = false, workspace = false }: {
  workspace?: boolean;
  status?: string; hideAction?: boolean; cancelling?: boolean;
  onCancel?: () => void;
  instruction: string;
  onInstructionChange: (value: string) => void;
  mode: "style" | "reenact";
  selection: Selection;
  job?: Job;
  active: boolean;
  disabled: boolean;
  submitting: boolean;
  subjectImage: string;
  onSubjectChange: (image: string) => void;
  onSubmit: (input: SubjectInput) => void;
  onExtract?: () => void;
  onSwap: (instruction: string) => void;
  onReferenceRotate(image: string, instruction: string): Promise<void>;
}) {
  const style = mode === "style";
  const basePrompt = instruction;
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadRevision = useRef(0);
  useEffect(() => () => { uploadRevision.current++; }, []);

  const upload = async (file?: File) => {
    if (!file) return;
    const revision = ++uploadRevision.current;
    onSubjectChange("");
    setUploading(true);
    setError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw new Error("请上传 PNG、JPEG 或 WebP 主体图");
      if (file.size > 20 * 1024 * 1024) throw new Error("原图最多 20 MB，请缩小后上传");
      const image = await normalizeImage(file, 2 * 1024 * 1024);
      if (revision === uploadRevision.current) onSubjectChange(image);
    } catch (e) {
      if (revision === uploadRevision.current)
        setError((e as Error).message || "无法读取主体图，请换一张图片");
    } finally {
      if (revision === uploadRevision.current) setUploading(false);
    }
  };

  const subjectRotation = { maxBytes: 2 * 1024 * 1024, disabled: disabled || uploading, onApply: onSubjectChange };
  const referenceRotation = { disabled: disabled || uploading, onApply: (image: string) => onReferenceRotate(image, basePrompt) };

  return (
    <section className="reenact-form" hidden={!active} aria-label={`${style ? "提取风格" : "主体重演"}输入`}>
      <div className="swappable-images">
      <div className="workspace-inputs">
        <ImageInput image={subjectImage} rotation={subjectRotation} label="图 1 · 主体" alt="图 1：用户指定的主体" disabled={disabled} uploading={uploading} onUpload={file => void upload(file)} />
        <ImageInput loading={active} error={selection.error} image={selection.image} rotation={referenceRotation} label="图 2 · 参考" alt="图 2：原始参考模板" />
      </div>
      <button type="button" className="image-swap" aria-label="互换主体图与参考图" title="互换主体图与参考图" disabled={disabled || uploading || !subjectImage || !selection.image} onClick={() => onSwap(basePrompt)}><Icon name="swap" /></button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {selection.subjectError && !subjectImage && <p className="fine">{selection.subjectError}</p>}
      <TaskInstruction value={basePrompt} disabled={disabled} onChange={onInstructionChange} />
      {!hideAction && <div className={workspace ? "button-row" : undefined}>
      <AsyncAction status={status} onCancel={onCancel} cancelling={cancelling}>
      <button className={workspace ? "outline-button" : "primary"} disabled={disabled || uploading || !selection.image || !subjectImage || !basePrompt.trim()} aria-busy={submitting}
        onClick={() => onSubmit({ subjectImage, basePrompt })}>
        {workspace && !submitting && job?.status !== "running" && <Icon name="edit" />}
        {submitting ? "正在提交…" : job?.status === "running" ? "正在生成提示词…" : workspace ? job?.result ? "重新逆向提示词" : "逆向提示词" : `生成${style ? "风格转换" : "主体重演"}提示词`}
      </button>
      </AsyncAction>
      {onExtract && <button className={workspace ? "text-link" : "secondary"} disabled={disabled} onClick={onExtract}
        title="按任务指令提取参考图的通用风格，不使用主体图">{workspace ? "仅提取通用风格" : "仅用图 2 提取通用风格"}</button>}
      </div>}
      {subjectImage && !basePrompt.trim() && <p className="fine" role="status">填写任务指令后可生成提示词。</p>}
    </section>
  );
}
