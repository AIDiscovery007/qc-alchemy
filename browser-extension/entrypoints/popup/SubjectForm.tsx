import { useEffect, useRef, useState } from "react";
import { normalizeImage } from "../../lib/image";
import type { Job, SubjectInput, Selection } from "../../lib/types";

const defaultPrompts = {
  style: "以图 1 为主体原图，保留其主体身份、内容、姿态、表情、服饰、构图与背景结构，仅迁移图 2 的配色、光影、笔触和材质表现，生成风格转换提示词。",
  reenact: "以图 1 为主体，以图 2 为风格参考模板，生成基于图 1 的风格转换与主体重演提示词。",
};

export default function SubjectForm({ mode, selection, job, active, disabled, submitting, onSubmit, onExtract }: {
  mode: "style" | "reenact";
  selection: Selection;
  job?: Job;
  active: boolean;
  disabled: boolean;
  submitting: boolean;
  onSubmit: (input: SubjectInput) => void;
  onExtract?: () => void;
}) {
  const style = mode === "style";
  const defaultPrompt = defaultPrompts[mode];
  const [subjectImage, setSubjectImage] = useState("");
  const [basePrompt, setBasePrompt] = useState(defaultPrompt);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const subjectEdited = useRef(false);
  const promptEdited = useRef(false);
  const uploadRevision = useRef(0);
  const saved = job?.mode === mode ? selection.reenact || job.reenact : undefined;
  const originalPrompt = saved?.basePrompt ?? defaultPrompt;

  useEffect(() => {
    if (!subjectEdited.current && selection.reenact?.subjectImage)
      setSubjectImage(selection.reenact.subjectImage);
  }, [selection.reenact?.subjectImage]);
  useEffect(() => {
    if (!promptEdited.current) setBasePrompt(originalPrompt);
  }, [originalPrompt]);
  useEffect(() => () => { uploadRevision.current++; }, []);

  const upload = async (file?: File) => {
    if (!file) return;
    const revision = ++uploadRevision.current;
    subjectEdited.current = true;
    setSubjectImage("");
    setUploading(true);
    setError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw new Error("请上传 PNG、JPEG 或 WebP 主体图");
      if (file.size > 20 * 1024 * 1024) throw new Error("原图最多 20 MB，请缩小后上传");
      const image = await normalizeImage(file, 2 * 1024 * 1024);
      if (revision === uploadRevision.current) setSubjectImage(image);
    } catch (e) {
      if (revision === uploadRevision.current)
        setError((e as Error).message || "无法读取主体图，请换一张图片");
    } finally {
      if (revision === uploadRevision.current) setUploading(false);
    }
  };

  return (
    <section className="reenact-form" hidden={!active} aria-label={`${style ? "提取风格" : "主体重演"}的三个输入`}>
      <div className="reenact-images">
        <div className="input-image">
          <strong>图 1 · 你的主体</strong>
          {subjectImage ? <img src={subjectImage} alt="图 1：用户指定的主体" /> : <div className="image-placeholder">{uploading ? "正在读取…" : style ? "上传要转换风格的原图" : "上传要重演的主体"}</div>}
          <p>{style ? "保留主体、内容与构图" : "提供身份与辨识特征"}</p>
          <label className="file-picker">
            {subjectImage ? "更换主体图" : "上传主体图"}
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传主体图" disabled={disabled || uploading} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
        <div className="input-image">
          <strong>图 2 · {style ? "风格参考" : "参考模板"}</strong>
          {selection.image ? <img src={selection.image} alt="图 2：原始参考模板" /> : <div className="image-placeholder">正在恢复参考图…</div>}
          <p>{style ? "仅迁移配色、光影与画法" : "提供风格与重演参考"}</p>
          <span className="input-source">{selection.capture === "screenshot" ? "所选图片截取" : "已带入所选原图"}</span>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {selection.subjectError && !subjectImage && <p className="fine">{selection.subjectError}</p>}
      <label className="prompt-label" htmlFor={`${mode}-prompt`}>输入 3 · 任务指令 <span>可编辑</span></label>
      <textarea id={`${mode}-prompt`} rows={6} maxLength={20000} value={basePrompt} disabled={disabled}
        placeholder="描述你想怎样结合两张图，例如：保留图 1 的姿势，只迁移图 2 的配色与笔触。"
        onChange={(e) => { promptEdited.current = true; setBasePrompt(e.target.value); }} />
      <p className="fine">{promptEdited.current ? "将按当前编辑的指令生成提示词。" : saved ? "已恢复这次任务提交的指令，可继续编辑。" : "已填好默认指令，可直接使用，也可改写你的意图。"} Codex 会查看两张图，以这里的指令决定保留与迁移的内容。</p>
      <button className="primary" disabled={disabled || uploading || !selection.image || !subjectImage || !basePrompt.trim()} aria-busy={submitting}
        onClick={() => onSubmit({ subjectImage, basePrompt })}>
        {submitting ? "正在提交…" : job?.status === "running" ? "正在处理，请稍候…" : `生成${style ? "风格转换" : "主体重演"}提示词 ↗`}
      </button>
      <p className="fine" role="status">{!subjectImage ? "还需要：上传主体图。" : !basePrompt.trim() ? "还需要：填写任务指令。" : "两张图与任务指令已就绪。"} 提交后生成中英文提示词；出图时按图 1、图 2 的顺序附图。</p>
      {onExtract && <>
        <button className="secondary" disabled={disabled} onClick={onExtract}>仅提取通用风格 ↗</button>
        <p className="fine">只分析图 2，生成带 [SUBJECT] 占位符的风格配方；此操作不使用主体图和任务指令。</p>
      </>}
    </section>
  );
}
