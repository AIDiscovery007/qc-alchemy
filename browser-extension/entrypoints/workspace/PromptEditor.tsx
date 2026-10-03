import type { ReactNode } from "react";
import type { Result } from "../../lib/types";
import Icon from "../popup/Icon";

type Draft = Pick<Result, "promptZh" | "promptEn" | "negativePrompt">;
export default function PromptEditor({ taskId, sheet = false, result, draft, lang, copied, saving, disabled, versionSelector, retry, onExport, onLanguage, onCopy, onEdit, onDraft, onSave, onCancel }: {
  taskId?: string; sheet?: boolean; result: Result; draft?: Draft; lang: "zh" | "en"; copied: boolean; saving: boolean; disabled: boolean; versionSelector: ReactNode; retry?: ReactNode; onExport?(): void;
  onLanguage(lang: "zh" | "en"): void; onCopy(): void; onEdit(): void; onDraft(draft: Draft): void; onSave(): void; onCancel(): void;
}) {
  return <>
    {!sheet && <div className="step-title"><h2><span className="step-index">2</span>雕琢提示词{retry}</h2>{versionSelector}</div>}
    <div className="prompt-box">
      <div className="prompt-tools"><div className="language-tabs"><button className={lang === "zh" ? "active" : ""} aria-pressed={lang === "zh"} onClick={() => onLanguage("zh")}>中文</button><button className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => onLanguage("en")}>English</button></div>
        <div className="button-row"><button className="quiet-button" data-copied={copied} aria-label={copied ? "已复制" : "复制提示词"} title={copied ? "已复制" : "复制提示词"} onClick={onCopy}><Icon key={String(copied)} name={copied ? "check" : "copy"} /></button><span className="copy-announcement" role="status">{copied ? "已复制提示词" : ""}</span>{onExport && <button className="quiet-button" aria-label="导出提示词" title={draft ? "先保存或取消修改后导出" : "导出提示词"} disabled={!!draft} onClick={onExport}><Icon name="download" /></button>}{!draft && <button className="quiet-button" aria-label="编辑提示词" title="编辑提示词" onClick={onEdit}><Icon name="edit" /></button>}</div>
      </div>
      {draft ? <textarea className="prompt-draft" aria-label={lang === "zh" ? "中文提示词" : "English prompt"} maxLength={20000} disabled={saving} value={lang === "zh" ? draft.promptZh : draft.promptEn} onChange={e => onDraft({ ...draft, [lang === "zh" ? "promptZh" : "promptEn"]: e.target.value })} /> : <div className="prompt-text" data-reminder-task={taskId}>{lang === "zh" ? result.promptZh : result.promptEn}</div>}
      {(draft || result.negativePrompt) && <details className="negative" open={draft ? true : undefined}><summary>排除项</summary>{draft ? <textarea className="negative-draft" aria-label="排除项（可留空）" maxLength={20000} disabled={saving} value={draft.negativePrompt} onChange={e => onDraft({ ...draft, negativePrompt: e.target.value })} /> : <p>{result.negativePrompt}</p>}</details>}
      {draft && <><div className="prompt-save"><button className="quiet-button" disabled={saving} onClick={onCancel}>取消</button><button className="outline-button" disabled={disabled || saving || !draft.promptZh.trim() || !draft.promptEn.trim()} onClick={onSave}>{saving ? "正在保存…" : "保存修改"}</button></div>{(!draft.promptZh.trim() || !draft.promptEn.trim()) && <p className="hint">中英文提示词都不能为空。</p>}</>}
    </div>
  </>;
}
