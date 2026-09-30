import { createPortal } from "react-dom";
import { logo } from "../../lib/brand";
import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../../lib/types";
import ProjectItem from "./ProjectItem";
import Icon from "./Icon";

export default function ProjectHistory({ projects, busy, onOpen, onDelete, workspace = false, searchTarget }: {
  projects: ProjectSummary[]; busy: boolean; onOpen(project: ProjectSummary): void;
  onDelete(ids: string[]): Promise<void>;
  workspace?: boolean; searchTarget?: HTMLElement | null;
}) {
  const [query, setQuery] = useState("");
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const visible = workspace ? projects.filter((project) => project.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : projects;
  const eligible = visible.filter((project) => !project.busy);
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
  const items = visible.map((project) => <ProjectItem key={project.id} project={project} workspace={workspace} selectable={!workspace || managing} disabled={busy} selected={checked.some((item) => item.id === project.id)}
    onSelect={() => setSelected((ids) => ids.includes(project.id) ? ids.filter((id) => id !== project.id) : [...ids, project.id])}
    onOpen={() => onOpen(project)} onDelete={() => confirm([project])} />);
  const searchInput = <input className="workspace-project-search" aria-label="搜索项目" type="search" value={query} placeholder="搜索项目" disabled={busy}
        onChange={(event) => { setQuery(event.target.value); setSelected([]); }} />;
  return <section className={`history${workspace ? " workspace-project-library" : ""}`}>
    {workspace ? <h2 ref={heading} className="workspace-library-heading" tabIndex={-1}>项目记录</h2> : <h1 ref={heading} tabIndex={-1}>项目记录</h1>}
    {workspace && <div className="workspace-library-toolbar">
      <p>每个项目收纳同一张参考图，以及三条路径下的提示词和生成结果。</p>
      <div>{searchTarget ? createPortal(searchInput, searchTarget) : searchInput}
      {!!projects.length && <button className="text-button" disabled={busy} aria-pressed={managing} onClick={() => { setManaging(!managing); setSelected([]); }}>{managing ? "完成管理" : "批量管理"}</button>}</div>
    </div>}
    {!!projects.length && (!workspace || managing) && <div className="history-toolbar">
      <label><input ref={selectAll} className="project-checkbox" type="checkbox" checked={!!eligible.length && checked.length === eligible.length}
        disabled={busy || !eligible.length} onChange={(event) => setSelected(event.target.checked ? eligible.map((project) => project.id) : [])} />全选</label>
      <button className="text-button danger" disabled={busy || !checked.length} onClick={() => confirm(checked)}>
        <Icon name="trash" />删除所选{checked.length ? ` (${checked.length})` : ""}
      </button>
    </div>}
    <p className="history-notice" role="status">{notice}</p>
    {!projects.length && <p className="muted">还没有项目。从网页选择一张参考图开始。</p>}
    {workspace && !!projects.length && !visible.length && <p className="muted">没有找到匹配的项目。</p>}
    {workspace ? <div className="workspace-project-grid">{items}</div> : items}
    <dialog ref={dialog} className={workspace ? "result-dialog modal dialog-small" : "delete-dialog"} aria-labelledby="delete-title" aria-describedby="delete-description"
      onCancel={(event) => { event.stopPropagation(); event.preventDefault(); if (!busy) setPending([]); }}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
      <div className={workspace ? "modal-head" : undefined}>{workspace && <img src={logo} alt="" />}
      <h2 id="delete-title">{pending.length === 1 ? "删除这个项目？" : `删除 ${pending.length} 个项目？`}</h2>
      {workspace && <button className="close-btn" disabled={busy} aria-label="关闭窗口" onClick={() => setPending([])}>×</button>}</div>
      <div className={workspace ? "dialog-content" : undefined}>
      {pending.length === 1 && <strong className="delete-project-name">{pending[0]?.title}</strong>}
      <p id="delete-description">将删除项目内的提示词、生成记录及插件保存的图片，无法撤销。</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button ref={cancel} className="secondary" disabled={busy} onClick={() => setPending([])}>取消</button>
        <button className="primary danger-fill" disabled={busy} onClick={remove}>{busy ? "正在删除…" : "确认删除"}</button>
      </div>
      </div>
    </dialog>
  </section>;
}
