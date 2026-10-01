import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import AsyncAction from "./AsyncAction";
import ImageInput from "../workspace/ImageInput";
import ImagePreview from "./ImagePreview";
import { normalizeImage } from "../../lib/image";
import type { Job, SubjectInput, Selection } from "../../lib/types";

const defaultPrompts = {
  style: "以图 1 为主体原图，保留其主体身份、内容、姿态、表情、服饰、构图与背景结构，仅迁移图 2 的配色、光影、笔触和材质表现，生成风格转换提示词。",
  reenact: "以图 1 为主体，以图 2 为风格参考模板，生成基于图 1 的风格转换与主体重演提示词。",
};

export default function SubjectForm({ mode, selection, job, active, disabled, submitting, subjectImage, onSubjectChange, onSubmit, onExtract, onSwap, onReferenceRotate, instruction, onInstructionChange, status, onCancel, workspace = false }: {
  workspace?: boolean;
  status?: string;
  onCancel?: () => void;
  instruction?: string;
  onInstructionChange?: (value: string) => void;
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
  const defaultPrompt = defaultPrompts[mode];
  const [basePrompt, setBasePrompt] = useState(instruction ?? defaultPrompt);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const promptEdited = useRef(false);
  const uploadRevision = useRef(0);
  const saved = job?.mode === mode ? selection.reenact || job.reenact : undefined;
  const originalPrompt = saved?.basePrompt ?? defaultPrompt;

  useEffect(() => {
    if (!promptEdited.current) setBasePrompt(instruction ?? originalPrompt);
  }, [originalPrompt, instruction]);
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
      {workspace ? <div className="workspace-inputs">
        <ImageInput image={subjectImage} rotation={subjectRotation} label="图 1 · 主体" caption="保留身份与结构" alt="图 1：用户指定的主体" disabled={disabled} uploading={uploading} onUpload={file => void upload(file)} />
        <ImageInput image={selection.image} rotation={referenceRotation} label="图 2 · 参考" caption={style ? "提取视觉语言" : "重演画面"} alt="图 2：原始参考模板" />
      </div> : <div className="reenact-images">
        <div className="input-image">
          <strong>图 1 · 主体</strong>
          {subjectImage ? <ImagePreview src={subjectImage} rotation={subjectRotation} alt="图 1：用户指定的主体" /> : <div className="image-placeholder">{uploading ? "正在读取…" : <span aria-hidden="true">＋</span>}</div>}
          <label className="file-picker">
            {subjectImage ? "更换主体图" : "上传主体图"}
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传主体图" disabled={disabled || uploading} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
        <div className="input-image">
          <strong>图 2 · {style ? "风格参考" : "参考模板"}</strong>
          {selection.image ? <ImagePreview src={selection.image} rotation={referenceRotation} alt="图 2：原始参考模板" /> : <div className="image-placeholder">正在恢复参考图…</div>}
          {selection.capture === "screenshot" && <span className="input-source">屏幕截取</span>}
        </div>
      </div>}
      <button type="button" className="image-swap" aria-label="互换主体图与参考图" title="互换主体图与参考图" disabled={disabled || uploading || !subjectImage || !selection.image} onClick={() => onSwap(basePrompt)}><Icon name="swap" /></button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {selection.subjectError && !subjectImage && <p className="fine">{selection.subjectError}</p>}
      <label className="prompt-label" htmlFor={`${mode}-prompt`}>任务指令</label>
      <textarea id={`${mode}-prompt`} rows={workspace ? 2 : 4} maxLength={20000} value={basePrompt} disabled={disabled}
        placeholder="描述你想怎样结合两张图，例如：保留图 1 的姿势，只迁移图 2 的配色与笔触。"
        onChange={(e) => { promptEdited.current = true; setBasePrompt(e.target.value); onInstructionChange?.(e.target.value); }} />
      <div className={workspace ? "button-row" : undefined}>
      <AsyncAction status={status} onCancel={onCancel} cancelling={submitting}>
      <button className={workspace ? "outline-button" : "primary"} disabled={disabled || uploading || !selection.image || !subjectImage || !basePrompt.trim()} aria-busy={submitting}
        onClick={() => onSubmit({ subjectImage, basePrompt })}>
        {workspace && !submitting && job?.status !== "running" && <Icon name="edit" />}
        {submitting ? "正在提交…" : job?.status === "running" ? "正在生成提示词…" : workspace ? job?.result ? "重新逆向提示词" : "逆向提示词" : `生成${style ? "风格转换" : "主体重演"}提示词`}
      </button>
      </AsyncAction>
      {onExtract && <button className={workspace ? "text-link" : "secondary"} disabled={disabled} onClick={onExtract}
        title="仅分析参考图，不使用主体图和任务指令">{workspace ? "仅提取通用风格" : "仅用图 2 提取通用风格"}</button>}
      </div>
      {subjectImage && !basePrompt.trim() && <p className="fine" role="status">填写任务指令后可生成提示词。</p>}
    </section>
  );
}
