import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/client";
import type { ImageThumbnail, ProjectSummary } from "../../lib/types";
import Icon from "./Icon";

export default function ProjectItem({ project, disabled, selected, onSelect, onDelete, onOpen, workspace = false, selectable = true }: {
  project: ProjectSummary; disabled: boolean; selected: boolean;
  onSelect(): void; onDelete(): void; onOpen(): void;
  workspace?: boolean; selectable?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState<ImageThumbnail>();
  const image = thumbnail?.image || "";
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setThumbnail(undefined);
    setFailed(false);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void request<ImageThumbnail>({ type: "alchemy:project-thumbnail", id: project.id, reference: !workspace }).then(
        value => { if (!cancelled) { setThumbnail(value); setFailed(false); } },
        () => { if (!cancelled) setFailed(true); },
      );
    });
    if (element.current) observer.observe(element.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [project.id, workspace, workspace ? project.cover?.generationId : undefined]);
  if (workspace) {
    let source = "上传参考图";
    try { source = new URL(project.sourceUrl).hostname.replace(/^www\./, "") || source; } catch { /* Local uploads have no website. */ }
    return <div ref={element} className="workspace-project-card" role="listitem" data-selected={selected}>
      {selectable && <input className="project-checkbox" type="checkbox" checked={selected} disabled={disabled}
        aria-label={`选择项目：${project.title}`} title="选择项目" onChange={onSelect} />}
      <button className="workspace-project-open" disabled={disabled} onClick={onOpen} aria-label={`打开项目：${project.title}`}>
        <div className="workspace-project-cover">{image ? <img src={image} alt={project.title} decoding="async" /> : <span>{failed ? "封面暂不可用" : "正在读取封面…"}</span>}</div>
        <div className="workspace-project-info"><strong>{project.title}</strong><small>{source} · {project.jobCount ? `${project.jobCount} 次逆向` : "待逆向"}{project.busy ? " · 任务进行中" : ""}{project.hidden ? " · 已隐藏" : ""}</small>
          <small className="workspace-project-updated">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN")}</small></div>
      </button>
      <div className="workspace-project-actions">
        <button disabled={disabled} onClick={onOpen}>{project.jobCount ? "继续创作" : "开始逆向"} <Icon name="arrow" /></button>
        <button className="danger" disabled={disabled || project.busy} onClick={onDelete}
          title={project.busy ? "任务结束后可删除" : "删除项目"} aria-label={`删除项目：${project.title}`}><Icon name="trash" /></button>
      </div>
    </div>;
  }
  return <div ref={element} className="project-row" data-selected={selected}>
    <input className="project-checkbox" type="checkbox" checked={selected} disabled={disabled}
      aria-label={`选择项目：${project.title}`} title="选择项目" onChange={onSelect} />
    <button className="history-item" disabled={disabled} onClick={onOpen} aria-label={`打开项目：${project.title}`}>
    {image ? <img className="project-thumbnail" src={image} alt="项目参考模板" decoding="async" /> : <span className="project-thumbnail placeholder">模板</span>}
    <span className="project-description"><strong>{project.title}</strong>
      <small>{new Date(project.updatedAt).toLocaleString("zh-CN")} · {project.jobCount ? `${project.jobCount} 次逆向` : "待逆向"}{project.hidden ? " · 已隐藏" : ""}</small>
      <small>{([['style', '风格'], ['recreate', '复刻'], ['reenact', '重演'], ['multi-reenact', '多图']] as const).map(([mode, name]) => {
        const lane = project.modes[mode];
        return `${name} ${!lane ? '待生成' : lane.status === 'running' ? '逆向中' : lane.status !== 'completed' ? '待重试' : lane.hasImage ? '图已生成' : '词已生成'}`;
      }).join(' · ')}</small>
    </span>
    </button>
    <button className="icon-button danger" disabled={disabled || project.busy} onClick={onDelete}
      title={project.busy ? "任务结束后可删除" : "删除项目"} aria-label={`删除项目：${project.title}`}><Icon name="trash" /></button>
  </div>;
}
