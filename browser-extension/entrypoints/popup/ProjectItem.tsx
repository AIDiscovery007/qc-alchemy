import { useEffect, useRef, useState } from "react";
import { query, request } from "../../lib/client";
import type { Project, ProjectSummary, Selection } from "../../lib/types";
import Icon from "./Icon";

export default function ProjectItem({ project, disabled, selected, onSelect, onDelete, onOpen, workspace = false, selectable = true }: {
  project: ProjectSummary; disabled: boolean; selected: boolean;
  onSelect(): void; onDelete(): void; onOpen(): void;
  workspace?: boolean; selectable?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState("");
  useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void (async () => {
        try {
          const reference = await request<Selection>({ type: "alchemy:project-reference", id: project.id });
          if (!cancelled) setImage(reference.image || "");
        } catch { /* A missing template must not hide the saved project. */ }
        if (!workspace || cancelled || !Object.values(project.modes).some(lane => lane?.hasImage)) return;
        try {
          const details = await query<Project>(`/projects/${project.id}`);
          const latest = details.jobs.flatMap(job => (job.generations || []).filter(item => item.status === "completed").map(generation => ({ jobId: job.id, generation })))
            .sort((a, b) => (b.generation.createdAt || "").localeCompare(a.generation.createdAt || ""))[0];
          if (!latest || cancelled) return;
          const generated = await request<{ image: string }>({ type: "alchemy:generation-image", id: latest.jobId, generationId: latest.generation.id });
          if (!cancelled) setImage(generated.image);
        } catch { /* Retain the reference when a generated image is unavailable. */ }
      })();
    });
    if (element.current) observer.observe(element.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [project.id, workspace, project.updatedAt]);
  if (workspace) {
    let source = "上传参考图";
    try { source = new URL(project.sourceUrl).hostname.replace(/^www\./, "") || source; } catch { /* Local uploads have no website. */ }
    return <div ref={element} className="workspace-project-card" data-selected={selected}>
      <button className="workspace-project-open" disabled={disabled} onClick={onOpen} aria-label={`打开项目：${project.title}`}>
        <div className="workspace-project-cover">{image ? <img src={image} alt={project.title} /> : <span>参考图暂不可用</span>}</div>
        <div className="workspace-project-info"><strong>{project.title}</strong><small>{source} · {project.jobCount} 次逆向{project.busy ? " · 任务进行中" : ""}</small></div>
      </button>
      {selectable && <input className="project-checkbox" type="checkbox" checked={selected} disabled={disabled || project.busy}
        aria-label={`选择项目：${project.title}`} title={project.busy ? "任务结束后可删除" : "选择项目"} onChange={onSelect} />}
      <div className="workspace-project-actions">
        <button disabled={disabled} onClick={onOpen}>继续创作 <Icon name="arrow" /></button>
        <button className="danger" disabled={disabled || project.busy} onClick={onDelete}
          title={project.busy ? "任务结束后可删除" : "删除项目"} aria-label={`删除项目：${project.title}`}><Icon name="trash" /></button>
      </div>
    </div>;
  }
  return <div ref={element} className="project-row" data-selected={selected}>
    <input className="project-checkbox" type="checkbox" checked={selected} disabled={disabled || project.busy}
      aria-label={`选择项目：${project.title}`} title={project.busy ? "任务结束后可删除" : "选择项目"} onChange={onSelect} />
    <button className="history-item" disabled={disabled} onClick={onOpen} aria-label={`打开项目：${project.title}`}>
    {image ? <img className="project-thumbnail" src={image} alt="项目参考模板" /> : <span className="project-thumbnail placeholder">模板</span>}
    <span className="project-description"><strong>{project.title}</strong>
      <small>{new Date(project.updatedAt).toLocaleString("zh-CN")} · {project.jobCount} 次逆向</small>
      <small>{([['style', '风格'], ['recreate', '复刻'], ['reenact', '重演']] as const).map(([mode, name]) => {
        const lane = project.modes[mode];
        return `${name} ${!lane ? '待生成' : lane.status === 'running' ? '逆向中' : lane.status !== 'completed' ? '待重试' : lane.hasImage ? '图已生成' : '词已生成'}`;
      }).join(' · ')}</small>
    </span>
    </button>
    <button className="icon-button danger" disabled={disabled || project.busy} onClick={onDelete}
      title={project.busy ? "任务结束后可删除" : "删除项目"} aria-label={`删除项目：${project.title}`}><Icon name="trash" /></button>
  </div>;
}
