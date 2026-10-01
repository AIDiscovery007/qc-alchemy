import { useEffect, useRef, useState } from "react";
import { normalizeImage } from "../../lib/image";
import type { MultiSubject, SubjectInput } from "../../lib/types";
import Icon from "./Icon";
import SelectField from "./SelectField";
import AsyncAction from "./AsyncAction";
import "./multi-subject.css";

export const multiInstruction = "将各主体融合在同一画面中，重演参考模板的画风、构图、姿态与光影，保留每张主体图指定的特征。";

export default function MultiSubjectForm({ image, subjects, instruction, active, disabled, status, submitting, hasPrompt, stale, onChange, onInstruction, onSubmit, onCancel, onReference, onSwap, initialSelectedId = "" }: {
  image?: string; subjects: MultiSubject[]; instruction: string; active: boolean; disabled: boolean;
  status?: string; submitting: boolean; hasPrompt: boolean; stale: boolean;
  onChange(subjects: MultiSubject[]): void; onInstruction(value: string): void;
  onSubmit(input: SubjectInput): void; onCancel?: () => void; onReference?: (file: File) => void;
  onSwap(id: string): void; initialSelectedId?: string;
}) {
  const [selected, setSelected] = useState(initialSelectedId);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const replace = useRef<HTMLInputElement>(null);
  const reference = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const replacing = useRef("");
  const current = subjects.find(item => item.id === selected) || subjects[0];
  const index = current ? subjects.indexOf(current) : -1;
  const locked = disabled || uploading;
  useEffect(() => () => { revision.current++; }, []);

  const addFiles = async (files: File[], target = "") => {
    if (!files.length || locked) return;
    if (!target && subjects.length + files.length > 6) { setError("最多添加 6 张主体图"); return; }
    const next = target ? subjects.map(item => item.id === target ? { ...item, subjectImage: "" } : item)
      : [...subjects, ...files.map(() => ({ id: crypto.randomUUID(), subjectImage: "", role: "自动", detail: "" }))];
    const pending = target ? next.filter(item => item.id === target) : next.slice(subjects.length);
    if (!pending.length) return;
    const attempt = ++revision.current;
    setUploading(true); setError(""); onChange(next); setSelected(pending[0]!.id);
    try {
      const images = await Promise.all(files.map(async file => {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)
          throw new Error("请选择 20 MB 以内的 PNG、JPEG 或 WebP");
        return normalizeImage(file, 2 * 1024 * 1024);
      }));
      if (attempt === revision.current) onChange(next.map(item => {
        const position = pending.findIndex(subject => subject.id === item.id);
        return position < 0 ? item : { ...item, subjectImage: images[position]! };
      }));
    } catch (e) { if (attempt === revision.current) setError((e as Error).message || "无法读取主体图，请重新上传"); }
    finally { if (attempt === revision.current) setUploading(false); }
  };
  const update = (patch: Partial<MultiSubject>) => onChange(subjects.map(item => item.id === current?.id ? { ...item, ...patch } : item));
  const move = (direction: number) => {
    const next = [...subjects];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setSelected(current!.id); onChange(next);
  };

  return <section className="multi-subject-form" hidden={!active} aria-label="多图重演输入">
    <div className="composition-layout" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles([...event.dataTransfer.files]); }}>
      <div className="template-card"><button disabled={locked || !onReference} aria-label="更换参考模板" onClick={() => reference.current?.click()}>
        {image ? <img src={image} alt="参考模板" width="240" height="300" /> : <span>正在读取模板…</span>}<span className="replace-label">更换</span>
      </button><span>参考模板</span></div>
      <div className="subject-filmstrip" aria-label="主体编排">{subjects.map((item, i) => <button key={item.id} className={current?.id === item.id ? "selected" : ""} aria-label={`选择主体 ${i + 1}`} aria-pressed={current?.id === item.id} onClick={() => setSelected(item.id)}>
        {item.subjectImage ? <img src={item.subjectImage} alt={`主体 ${i + 1}`} width="88" height="88" /> : <small>{uploading ? "读取中" : "待上传"}</small>}<span>{i + 1}</span>
      </button>)}<button className="add-subject" disabled={locked || subjects.length >= 6} aria-label="添加主体图" title="添加主体图" onClick={() => upload.current?.click()}><Icon name="plus" /><span>添加主体图</span></button></div>
      {current && <div className="selected-subject"><div className="subject-meta"><strong>主体 {index + 1}</strong><div className="subject-actions">
        <button type="button" aria-label={`互换主体 ${index + 1} 与参考模板`} title="与参考模板互换" disabled={locked || !image || !current.subjectImage} onClick={() => onSwap(current.id)}><Icon name="swap" /></button>
        <button disabled={locked} onClick={() => { replacing.current = current.id; replace.current?.click(); }}>更换</button>
        <button aria-label={`主体 ${index + 1} 前移`} disabled={locked || index === 0} onClick={() => move(-1)}>←</button>
        <button aria-label={`主体 ${index + 1} 后移`} disabled={locked || index === subjects.length - 1} onClick={() => move(1)}>→</button>
        <button aria-label={`删除主体 ${index + 1}`} disabled={locked} onClick={() => { onChange(subjects.filter(item => item.id !== current.id)); setError(""); }}><Icon name="trash" /></button>
      </div></div><div className="role-fields">
        <SelectField label="用途" aria-label={`主体 ${index + 1} 用途`} disabled={locked} value={current.role} onChange={event => update({ role: event.target.value })}>
          {["自动", "人物", "物品", "服饰", "场景", "细节"].map(role => <option key={role}>{role}</option>)}
        </SelectField><input aria-label={`主体 ${index + 1} 保留特征`} placeholder="保留哪些特征…" maxLength={2000} disabled={locked} value={current.detail} onChange={event => update({ detail: event.target.value })} />
      </div></div>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <label className="instruction-label" htmlFor="multi-instruction">任务指令</label>
    <textarea id="multi-instruction" rows={3} maxLength={20000} disabled={locked} value={instruction} placeholder="描述这些主体如何出现在同一画面…" onChange={event => onInstruction(event.target.value)} />
    <AsyncAction className="multi-reverse" status={uploading ? "正在读取主体图…" : status} onCancel={onCancel} cancelling={submitting}>
      <button className="outline-button" disabled={locked || !image || subjects.length < 2 || subjects.some(item => !item.subjectImage) || !instruction.trim()} onClick={() => onSubmit({ subjects, basePrompt: instruction })}><Icon name="edit" />{hasPrompt ? "重新逆向提示词" : "逆向提示词"}</button>
    </AsyncAction>
    {subjects.length < 2 ? <p className="input-status" role="status">至少添加 2 张主体图</p> : stale && <p className="input-status" role="status">提示词待更新</p>}
    <input hidden ref={upload} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="批量上传主体图" onChange={event => { void addFiles([...event.target.files || []]); event.target.value = ""; }} />
    <input hidden ref={replace} type="file" accept="image/png,image/jpeg,image/webp" aria-label="替换主体图" onChange={event => { void addFiles([...event.target.files || []], replacing.current); event.target.value = ""; }} />
    <input hidden ref={reference} type="file" accept="image/png,image/jpeg,image/webp" aria-label="替换参考模板" onChange={event => { const file = event.target.files?.[0]; if (file) onReference?.(file); event.target.value = ""; }} />
  </section>;
}
