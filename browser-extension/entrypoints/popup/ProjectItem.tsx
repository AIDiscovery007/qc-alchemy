import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/client";
import type { ProjectSummary, Selection } from "../../lib/types";
import Icon from "./Icon";

export default function ProjectItem({ project, disabled, selected, onSelect, onDelete, onOpen }: {
  project: ProjectSummary; disabled: boolean; selected: boolean;
  onSelect(): void; onDelete(): void; onOpen(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState("");
  useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void request<Selection>({ type: "alchemy:project-reference", id: project.id }).then(
        (value) => { if (!cancelled) setImage(value.image || ""); },
        () => {}, // A missing local template must not hide the saved project.
      );
    });
    if (element.current) observer.observe(element.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [project.id]);
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
