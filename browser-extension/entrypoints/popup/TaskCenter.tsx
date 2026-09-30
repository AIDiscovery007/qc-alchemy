import { useEffect, useRef, useState } from "react";
import { query, request } from "../../lib/client";
import type { Generation, Job, Mode } from "../../lib/types";
import Icon from "./Icon";
import { logo } from "../../lib/brand";
import "./task-center.css";

const modes: Record<Mode, string> = { style: "提取风格", recreate: "完整复刻", reenact: "主体重演" };
const statuses = { running: "进行中", completed: "已完成", failed: "失败", cancelled: "已取消" };

export default function TaskCenter({ onClose, onOpen, onUpdate }: {
  onClose(): void;
  onOpen(projectId: string, mode: Mode, jobId: string): Promise<void>;
  onUpdate?(job: Job): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  const revision = useRef(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [opening, setOpening] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const requestedImages = useRef(new Set<string>());

  useEffect(() => {
    alive.current = true;
    const element = dialog.current!;
    const root = element.getRootNode() as Document | ShadowRoot;
    const previous = root.activeElement;
    element.showModal();
    element.querySelector<HTMLButtonElement>("button")?.focus();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const current = revision.current;
      try {
        const values = await query<Job[]>("/jobs");
        if (!stopped && current === revision.current) { setJobs(values); setError(""); }
      } catch (e) { if (!stopped) setError((e as Error).message); }
      finally { if (!stopped) { setLoaded(true); timer = setTimeout(refresh, 2000); } }
    };
    void refresh();
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const cancel = async (job: Job, generation?: Generation) => {
    const id = generation?.id || job.id;
    setPending((items) => [...items, id]);
    setActionError("");
    revision.current++;
    try {
      const updated = await request<Job>({ type: generation ? "alchemy:generation-cancel" : "alchemy:cancel",
        id: job.id, ...(generation ? { generationId: generation.id } : {}) });
      if (!alive.current) return;
      revision.current++;
      setJobs((items) => items.map((item) => item.id === updated.id ? updated : item));
      onUpdate?.(updated);
    } catch (e) { if (alive.current) setActionError((e as Error).message); }
    finally { if (alive.current) setPending((items) => items.filter((item) => item !== id)); }
  };

  const open = async (job: Job) => {
    if (!job.projectId) return;
    setOpening(job.id);
    setActionError("");
    try { await onOpen(job.projectId, job.mode, job.id); if (alive.current) onClose(); }
    catch (e) { if (alive.current) setActionError((e as Error).message); }
    finally { if (alive.current) setOpening(""); }
  };

  const loadImage = (job: Job) => {
    const id = job.projectId || job.id;
    if (requestedImages.current.has(id)) return;
    requestedImages.current.add(id);
    void request<{ image: string }>({ type: job.projectId ? "alchemy:project-reference" : "alchemy:reference", id }).then(
      value => { if (alive.current) setImages(previous => ({ ...previous, [id]: value.image })); },
      () => {}, // A missing reference must not hide the task or its recovery actions.
    );
  };

  const tasks = jobs.flatMap((job) => [
    { job, task: job, generation: undefined as Generation | undefined },
    ...(job.generations || []).map((generation) => ({ job, task: generation, generation })),
  ]).map((item) => {
    const timestamp = Date.parse(item.task.createdAt || item.job.createdAt);
    return { ...item, timestamp: Number.isFinite(timestamp) ? timestamp : null };
  }).sort((a, b) => Number(b.task.status === "running") - Number(a.task.status === "running") || (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const running = tasks.filter(({ task }) => task.status === "running").length;

  return <dialog ref={dialog} className="task-center" aria-labelledby="task-center-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-head"><img src={logo} alt="" /><h2 id="task-center-title">任务中心 · {running} 项执行中</h2>
      <button type="button" className="close-btn" aria-label="关闭窗口" onClick={onClose}>×</button></div>
    <div className="task-list">
      <p className="hint task-scope">任务可跨项目并行执行，关闭此窗口不会取消。显示进行中的任务及最近 30 个逆向版本；更早记录可在项目中查看。</p>
      {error && <div className="error" role="alert">{error}</div>}
      {actionError && <div className="error" role="alert">{actionError}</div>}
      {!loaded && <p className="hint" role="status">正在读取任务…</p>}
      {loaded && !tasks.length && !error && <div className="empty-canvas"><h3>没有任务在排队。</h3><p>回到项目，发起一次逆向或生图。</p></div>}
      <ul>{tasks.map(({ job, task, generation, timestamp }) => <li key={task.id} className="task-item" data-status={task.status}>
        <TaskImage image={images[job.projectId || job.id]} onVisible={() => loadImage(job)} />
        <div className="task-meta"><strong>{job.result?.title || "参考图项目"} · {modes[job.mode]}</strong>
          <small title={timestamp === null ? "时间未知" : new Date(timestamp).toLocaleString("zh-CN")}>{generation ? "生成图片" : "逆向提示词"} / {task.status === "running" && <i className="spinner" />} {statuses[task.status]}</small>
          {task.status === "running" && <small role="status">{task.stage}</small>}
          {task.error && <small className="task-error">{task.error}</small>}
        </div>
        {task.status === "running" && <button type="button" className="text-link" disabled={pending.includes(task.id)} onClick={() => void cancel(job, generation)}>{pending.includes(task.id) ? "正在取消…" : "取消"}</button>}
        {job.projectId && <button type="button" className="outline-button" title={`打开逆向版本 ${job.id}`} disabled={!!opening} onClick={() => void open(job)}>{opening === job.id ? "正在打开…" : "查看项目"}</button>}
      </li>)}</ul>
    </div>
  </dialog>;
}

function TaskImage({ image, onVisible }: { image?: string; onVisible(): void }) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      onVisible();
    });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={element} className="task-image">{image ? <img src={image} alt="项目参考图" /> : <Icon name="image" />}</span>;
}
