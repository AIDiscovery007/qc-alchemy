import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../../lib/types";
import ProjectItem from "./ProjectItem";
import Icon from "./Icon";

export default function ProjectHistory({ projects, busy, onOpen, onDelete }: {
  projects: ProjectSummary[]; busy: boolean; onOpen(project: ProjectSummary): void;
  onDelete(ids: string[]): Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const eligible = projects.filter((project) => !project.busy);
  const checked = eligible.filter((project) => selected.includes(project.id));
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = checked.length > 0 && checked.length < eligible.length;
  }, [checked.length, eligible.length]);
  useEffect(() => {
    if (pending.length) { dialog.current?.showModal(); cancel.current?.focus(); }
    else dialog.current?.close();
  }, [pending]);
  const confirm = (items: ProjectSummary[]) => { setError(""); setNotice(""); setPending(items); };
  const remove = async () => {
    try {
      await onDelete(pending.map((project) => project.id));
      setSelected((ids) => ids.filter((id) => !pending.some((project) => project.id === id)));
      setNotice(`已删除 ${pending.length} 个项目`);
      dialog.current?.close();
      setPending([]);
      heading.current?.focus();
    } catch (error) { setError((error as Error).message); }
  };
  return <section className="history">
    <h1 ref={heading} tabIndex={-1}>项目记录</h1>
    {!!projects.length && <div className="history-toolbar">
      <label><input ref={selectAll} className="project-checkbox" type="checkbox" checked={!!eligible.length && checked.length === eligible.length}
        disabled={busy || !eligible.length} onChange={(event) => setSelected(event.target.checked ? eligible.map((project) => project.id) : [])} />全选</label>
      <button className="text-button danger" disabled={busy || !checked.length} onClick={() => confirm(checked)}>
        <Icon name="trash" />删除所选{checked.length ? ` (${checked.length})` : ""}
      </button>
    </div>}
    <p className="history-notice" role="status">{notice}</p>
    {!projects.length && <p className="muted">还没有项目。从网页选择一张参考图开始。</p>}
    {projects.map((project) => <ProjectItem key={project.id} project={project} disabled={busy} selected={checked.some((item) => item.id === project.id)}
      onSelect={() => setSelected((ids) => ids.includes(project.id) ? ids.filter((id) => id !== project.id) : [...ids, project.id])}
      onOpen={() => onOpen(project)} onDelete={() => confirm([project])} />)}
    <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description"
      onCancel={(event) => { event.stopPropagation(); event.preventDefault(); if (!busy) setPending([]); }}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
      <h2 id="delete-title">{pending.length === 1 ? "删除这个项目？" : `删除 ${pending.length} 个项目？`}</h2>
      {pending.length === 1 && <strong className="delete-project-name">{pending[0]?.title}</strong>}
      <p id="delete-description">将删除项目内的提示词、生成记录及插件保存的图片，无法撤销。</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button ref={cancel} className="secondary" disabled={busy} onClick={() => setPending([])}>取消</button>
        <button className="primary danger-fill" disabled={busy} onClick={remove}>{busy ? "正在删除…" : "确认删除"}</button>
      </div>
    </dialog>
  </section>;
}
