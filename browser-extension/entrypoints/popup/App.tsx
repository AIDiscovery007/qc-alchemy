import { useEffect, useRef, useState } from "react";
import { query, readState, request, type UiState } from "../../lib/client";
import type { Job, Mode, Project, ProjectSummary, SubjectInput, Selection } from "../../lib/types";
import ProjectHistory from "./ProjectHistory";
import SubjectForm from "./SubjectForm";
import GenerationPanel from "./GenerationPanel";
import Icon from "./Icon";
import SelectField from "./SelectField";
import ModelSettings from "./ModelSettings";
import { logo } from "../../lib/brand";

const defaults: UiState["preferences"] = { paired: false, mode: "style" };
const laneStatus = (job?: Job) => !job ? "待生成" : job.status === "running" ? "逆向中"
  : job.generations?.some((item) => item.status === "running") ? "生图中"
  : job.status !== "completed" ? "待重试"
  : job.generations?.some((item) => item.status === "completed") ? "提示词 + 图片" : "提示词已就绪";
const modeName = (mode: Mode) => ({ style: "提取风格", recreate: "完整复刻", reenact: "主体重演" })[mode];

export default function App({ embedded = false }: { embedded?: boolean }) {
  const [preferences, setPreferences] = useState(defaults);
  const [tokenDraft, setTokenDraft] = useState("");
  const [selection, setSelection] = useState<Selection>();
  const [project, setProject] = useState<Project>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, Selection>>({});
  const [referenceErrors, setReferenceErrors] = useState<Record<string, string>>({});
  const [savingMode, setSavingMode] = useState(false);
  const modeRevision = useRef(0);
  const projectRevision = useRef(0);
  const selectionRevision = useRef(0);
  const deletingProjects = useRef(false);
  const [settings, setSettings] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionText, setConnectionText] = useState("尚未连接");
  const [serviceBusy, setServiceBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeProject = project?.id === selection?.projectId ? project : undefined;
  const modeJobs = (mode: Mode) => activeProject?.jobs.filter((item) => item.mode === mode) || [];
  const modeJob = (mode: Mode) => {
    const jobs = modeJobs(mode);
    return jobs.find((item) => item.id === versions[`${activeProject?.id}:${mode}`]) || jobs[0];
  };
  const job = modeJob(preferences.mode);
  const activeJob = job;
  const running = job?.status === "running";
  const generating = activeProject?.jobs.some((item) => item.generations?.some((generation) => generation.status === "running"));
  const loadingProject = !!selection && !activeProject;
  const result = job?.result;
  const reading = selection && !selection.image && !selection.error;
  const referenceError = job && referenceErrors[job.id];
  const restoring = !!job?.reenact && !references[job.id] && !referenceError;
  const blocked = !connected || !selectedModel || busy || savingMode || serviceBusy || !!running || !!generating || loadingProject || restoring;

  useEffect(() => {
    setCopied(false);
    return () => clearTimeout(copyTimer.current);
  }, [job?.id, lang]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous: Selection | undefined;
    let initialized = false;
    const refresh = async () => {
      try {
        const revision = modeRevision.current;
        const snapshotRevision = selectionRevision.current;
        const value = await readState(previous?.image ? previous.id : undefined, previous?.jobId);
        if (cancelled) return;
        setPreferences((previous) => ({ ...value.preferences,
          mode: revision === modeRevision.current && revision % 2 === 0 ? value.preferences.mode : previous.mode,
        }));
        const firstRefresh = !initialized;
        if (firstRefresh) setSettings(!value.preferences.paired);
        initialized = true;
        if (!deletingProjects.current && !value.selection && snapshotRevision === selectionRevision.current) {
          previous = undefined;
          setSelection(undefined);
          setProject(undefined);
        } else if (!deletingProjects.current && value.selection && snapshotRevision === selectionRevision.current) {
          const next = { ...value.selection,
            image: value.selection.image || (previous?.id === value.selection.id ? previous.image : undefined),
          };
          if (previous?.id !== next.id) { if (!firstRefresh) setHistoryOpen(false); setError(""); }
          previous = next;
          setSelection(next);
        }
      } catch (e) { if (!cancelled) setError((e as Error).message); }
      if (!cancelled) timer = setTimeout(refresh, 1500);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Older extension selections join the same durable template project on first open.
  useEffect(() => {
    if (!preferences.paired || !selection?.image || selection.projectId) return;
    let cancelled = false;
    void request<Selection>({ type: "alchemy:ensure-project", id: selection.id }).then(
      (next) => { if (!cancelled) { selectionRevision.current++; setSelection(next); } },
      (e) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [preferences.paired, selection?.id, !!selection?.image, selection?.projectId]);

  useEffect(() => {
    if (!preferences.paired) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const revision = projectRevision.current;
      try {
        const health = await query<{ ready: boolean; skill: string; active: number; model?: string }>("/health");
        if (cancelled) return;
        setConnected(health.ready);
        setServiceBusy(health.active > 0);
        setSelectedModel(health.model || null);
        setConnectionText(health.ready ? `已连接 · ${health.skill}` : "未找到图片逆向技能");
        if (historyOpen && !deletingProjects.current) {
          const items = await query<ProjectSummary[]>("/projects");
          if (!cancelled && revision === projectRevision.current) setProjects(items);
        }
        if (selection?.projectId && !deletingProjects.current) {
          const value = await query<Project>(`/projects/${selection.projectId}`);
          if (!cancelled && revision === projectRevision.current) setProject(value);
        }
      } catch (e) {
        if (!cancelled && revision === projectRevision.current) { setConnected(false); setConnectionText((e as Error).message); }
      }
      if (!cancelled) timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [preferences.paired, selection?.projectId, historyOpen]);

  useEffect(() => {
    if (!job?.reenact || references[job.id] || referenceErrors[job.id]) return;
    let cancelled = false;
    void request<Selection>({ type: "alchemy:reference", id: job.id }).then(
      (value) => { if (!cancelled) setReferences((items) => ({ ...items, [job.id]: value })); },
      (e) => { if (!cancelled) setReferenceErrors((items) => ({ ...items, [job.id]: e.message })); },
    );
    return () => { cancelled = true; };
  }, [job?.id, !!job?.reenact, referenceError]);

  const updateJob = (updated: Job) => {
    projectRevision.current++;
    setProject((current) => current && current.id === updated.projectId
      ? { ...current, jobs: [updated, ...current.jobs.filter((item) => item.id !== updated.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
      : current);
  };
  const saveMode = async (mode: Mode) => {
    if (savingMode || busy) return;
    const previous = preferences.mode;
    setCopied(false);
    setError("");
    modeRevision.current++;
    setSavingMode(true);
    setPreferences((value) => ({ ...value, mode }));
    try {
      await request({ type: "alchemy:mode", mode });
    } catch (e) {
      setPreferences((value) => ({ ...value, mode: previous }));
      setError((e as Error).message);
    } finally {
      modeRevision.current++;
      setSavingMode(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const health = await request<{ ready: boolean; skill: string }>({ type: "alchemy:connect", token: tokenDraft.trim() });
      setPreferences({ ...preferences, paired: true });
      setTokenDraft("");
      setConnected(true);
      setConnectionText(`已连接 · ${health.skill}`);
      setSettings(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = async (mode: Mode = preferences.mode, reenact?: SubjectInput) => {
    if (!selection?.image || !activeProject || blocked) return;
    setBusy(true);
    setError("");
    try {
      const value = await request<{ selection: Selection; job: Job }>({
        type: "alchemy:start", id: selection.id, projectId: activeProject.id, mode, reenact,
      });
      selectionRevision.current++;
      setSelection(value.selection);
      updateJob(value.job);
      setVersions((items) => ({ ...items, [`${activeProject.id}:${mode}`]: value.job.id }));
      setCopied(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const showHistory = async () => {
    if (historyOpen) { setHistoryOpen(false); return; }
    setBusy(true);
    try { setProjects(await query<ProjectSummary[]>("/projects")); setHistoryOpen(true); setError(""); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const openProject = async (item: ProjectSummary) => {
    setBusy(true);
    setError("");
    try {
      const next = await request<Selection>({ type: "alchemy:open-project", id: item.id });
      selectionRevision.current++;
      setSelection(next);
      setHistoryOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const deleteProjects = async (ids: string[]) => {
    setBusy(true);
    setError("");
    selectionRevision.current++;
    projectRevision.current++;
    deletingProjects.current = true;
    try {
      const { deletedIds } = await request<{ deletedIds: string[] }>({ type: "alchemy:delete-projects", ids });
      const removedJobs = activeProject && deletedIds.includes(activeProject.id) ? activeProject.jobs.map((job) => job.id) : [];
      setProjects((items) => items.filter((item) => !deletedIds.includes(item.id)));
      if (selection?.projectId && deletedIds.includes(selection.projectId)) { setSelection(undefined); setProject(undefined); }
      setVersions((items) => Object.fromEntries(Object.entries(items).filter(([key]) => !deletedIds.some((id) => key.startsWith(`${id}:`)))));
      setReferences((items) => Object.fromEntries(Object.entries(items).filter(([id, value]) => !removedJobs.includes(id) && !deletedIds.includes(value.projectId || ""))));
      setReferenceErrors((items) => Object.fromEntries(Object.entries(items).filter(([id]) => !removedJobs.includes(id))));
    } finally { deletingProjects.current = false; selectionRevision.current++; projectRevision.current++; setBusy(false); }
  };
  const cancel = async () => {
    if (!job) return;
    try { updateJob(await request<Job>({ type: "alchemy:cancel", id: job.id })); }
    catch (e) { setError((e as Error).message); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        lang === "zh" ? job!.result!.promptZh : job!.result!.promptEn,
      );
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("复制失败，请选中提示词手动复制");
    }
  };
  const exportResult = () => {
    if (!job?.result) return;
    const r = job.result;
    const inputs = job.reenact ? "\n使用方法：生成图片时，先附图 1（用户主体图），再附图 2（原始参考图），然后使用下方提示词。此 Markdown 不包含图片文件。\n" : "";
    const markdown = `# ${r.title}\n\n来源：${job.sourceUrl || "网页图片"}\n模式：${modeName(job.mode)}\n${inputs}\n## 视觉观察\n${r.observations.map((x) => `- ${x}`).join("\n")}\n\n## 中文提示词\n${r.promptZh}\n\n## English prompt\n${r.promptEn}\n\n## 排除项\n${r.negativePrompt || "无"}\n\n## 不确定性\n${r.uncertainties.join("\n") || "无额外说明"}\n`;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `qc-reframe-${job.id.slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="app">
      {!embedded && <header>
        <div className="brand">
          <img className="brand-mark" src={logo} alt="" />
          <strong>QC-Reframe</strong>
        </div>
      </header>}
      <div className="connection">
        <span className={`dot ${connected ? "online" : ""}`} />
        <span title={connectionText}>
          {connected ? "Codex 已连接" : "Codex 未连接"}
        </span>
        <button className="text-button" disabled={busy} onClick={showHistory} aria-expanded={historyOpen}>
          <Icon name={historyOpen ? "back" : "history"} />
          {historyOpen ? "返回项目" : "项目记录"}
        </button>
        <button
          className="icon-button"
          title="连接设置"
          aria-label="连接设置"
          aria-expanded={settings}
          onClick={() => {
            setSettings(!settings);
            setError("");
          }}
        >
          <Icon name="settings" />
        </button>
      </div>

      {settings && (
        <section className="settings card">
          <h2>连接 Codex</h2>
          <p>在扩展项目目录启动服务，复制终端显示的配对码。</p>
          <code className="command">npm run bridge</code>
          <label htmlFor="pair-token">本机配对码</label>
          <input
            id="pair-token"
            type="password"
            autoComplete="off"
            value={tokenDraft}
            placeholder="粘贴终端中的配对码"
            onChange={(e) => setTokenDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void connect();
            }}
          />
          <button
            className="primary"
            disabled={busy || !tokenDraft.trim()}
            onClick={connect}
          >
            {busy ? "正在连接…" : "连接 Codex"}
          </button>
          {connected && <ModelSettings serviceBusy={serviceBusy} />}
        </section>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!connected && preferences.paired && !settings && (
        <div className="error">{connectionText}</div>
      )}
      {connected && !selectedModel && !settings && <div className="model-notice">
        <span>先为 QC-Reframe 选择可用模型</span>
        <button className="text-button" onClick={() => setSettings(true)}>选择模型</button>
      </div>}

      <main>
        {historyOpen ? (
          <ProjectHistory projects={projects} busy={busy} onOpen={openProject} onDelete={deleteProjects} />
        ) : (
          <>
            {!selection && (
              <section className="empty">
                <span className="empty-mark"><Icon name="image" /></span>
                <h1>选择一张参考图</h1>
                <p>将鼠标移到网页图片上，点击「逆向风格」。</p>
              </section>
            )}

            {activeProject && <div className="project-heading"><h1>{activeProject.title}</h1></div>}
            {restoring && <p className="fine" role="status">正在恢复这条路径的主体图…</p>}
            {referenceError && <div className="error" role="alert">{referenceError}
              <button className="text-button" disabled={!connected} onClick={() => setReferenceErrors((items) => {
                const next = { ...items }; delete next[job!.id]; return next;
              })}>重新读取主体图</button>
            </div>}
            <div className="mode-switch" role="group" aria-label="项目逆向路径">
              <button
                className={preferences.mode === "style" ? "active" : ""}
                aria-pressed={preferences.mode === "style"}
                disabled={savingMode || busy}
                onClick={() => saveMode("style")}
              >
                提取风格<span>保留主体，换风格</span>{activeProject && <small>{laneStatus(modeJob("style"))}</small>}
              </button>
              <button
                className={preferences.mode === "recreate" ? "active" : ""}
                aria-pressed={preferences.mode === "recreate"}
                disabled={savingMode || busy}
                onClick={() => saveMode("recreate")}
              >
                完整复刻<span>保留内容与构图</span>{activeProject && <small>{laneStatus(modeJob("recreate"))}</small>}
              </button>
              <button className={preferences.mode === "reenact" ? "active" : ""}
                aria-pressed={preferences.mode === "reenact"} disabled={savingMode || busy}
                onClick={() => saveMode("reenact")}>
                主体重演<span>换主体，演原图</span>{activeProject && <small>{laneStatus(modeJob("reenact"))}</small>}
              </button>
            </div>
            {serviceBusy && !running && !job?.generations?.some((item) => item.status === "running") &&
              <p className="fine" role="status">Codex 正在处理其他任务，请稍候。</p>}
            {loadingProject && selection?.image && <p className="fine" role="status">正在读取模板项目…</p>}
            {selection?.image && preferences.mode === "recreate" && (
              <figure className="image-card">
                <img src={selection.image} alt="本次选择的参考图片" />
                <figcaption>
                  <span>参考模板</span>
                  {selection.capture === "screenshot" && <span>屏幕截取</span>}
                </figcaption>
              </figure>
            )}
            {modeJobs(preferences.mode).length > 1 && <SelectField label="提示词版本" value={job?.id} disabled={busy}
              onChange={(e) => { setCopied(false); setVersions((items) => ({ ...items, [`${activeProject!.id}:${preferences.mode}`]: e.target.value })); }}>
              {modeJobs(preferences.mode).map((item, i, items) => <option key={item.id} value={item.id}>第 {items.length - i} 次 · {new Date(item.createdAt).toLocaleString("zh-CN")} · {laneStatus(item)}</option>)}
            </SelectField>}
            {(selection || result) && (
              <>
                {(reading || running) && (
                  <div className="progress" role="status">
                    <span className="spinner" />
                    <div>
                      <strong>{reading ? selection?.stage : job?.stage}</strong>
                    </div>
                    {running && (
                      <button className="text-button" onClick={cancel}>
                        取消
                      </button>
                    )}
                  </div>
                )}
                {(selection?.error || job?.error) && (
                  <div className="error" role="alert">
                    {job?.error || selection?.error}
                  </div>
                )}
                {job?.status === "cancelled" && (
                  <p className="muted">任务已取消，可重新开始。</p>
                )}
                {selection && preferences.mode === "recreate" && (
                  <button
                    className="primary"
                    disabled={blocked || !selection.image}
                    onClick={() => start()}
                    aria-busy={busy || running}
                  >
                    {busy
                      ? "正在提交…"
                      : restoring
                        ? "正在恢复原图…"
                        : running
                          ? `正在${modeName(preferences.mode)}…`
                          : "生成复刻提示词"}
                  </button>
                )}
              </>
            )}

            {selection && (["style", "reenact"] as const).map((mode) => {
              const savedJob = modeJob(mode);
              const savedReference = savedJob && references[savedJob.id];
              return <SubjectForm key={`${selection.projectId || selection.id}-${mode}-${savedJob?.id || "new"}`} mode={mode}
                selection={{ ...selection, reenact: savedReference?.reenact, subjectError: savedReference?.subjectError }} job={savedJob}
                active={preferences.mode === mode} disabled={blocked || !selection.image}
                submitting={busy} onSubmit={(input) => start(mode, input)}
                onExtract={mode === "style" ? () => start("style") : undefined} />;
            })}
            {activeProject && !result && <section className="lane-empty" aria-label={`${modeName(preferences.mode)}待生成`}>
              <h2>{running ? "提示词生成中…" : "提示词待生成"}</h2>
              <div className="generation-card"><h2><Icon name="image" />图片待生成</h2><button className="primary" disabled>先生成提示词</button></div>
            </section>}

            {result && activeJob && (
              <section className="result" aria-label={`${modeName(activeJob.mode)}提示词`}>
                <h2>{result.title === activeProject?.title ? "提示词" : result.title}</h2>
                <div className="prompt-card">
                  <div className="prompt-toolbar">
                    <div className="language" role="group" aria-label="提示词语言">
                      <button
                        className={lang === "zh" ? "selected" : ""}
                        aria-pressed={lang === "zh"}
                        onClick={() => setLang("zh")}
                      >
                        中文
                      </button>
                      <button
                        className={lang === "en" ? "selected" : ""}
                        aria-pressed={lang === "en"}
                        onClick={() => setLang("en")}
                      >
                        English
                      </button>
                    </div>
                    <button className="copy-button" data-copied={copied} onClick={copy} aria-live="polite">
                      <Icon name={copied ? "check" : "copy"} />{copied ? "已复制" : "复制提示词"}
                    </button>
                  </div>
                  <p className="prompt">
                    {lang === "zh" ? result.promptZh : result.promptEn}
                  </p>
                </div>
                {activeJob.mode === "style" && !activeJob.reenact && (
                  <p className="fine">把 [SUBJECT] 替换成你的创作主体。</p>
                )}
                {!!result.observations.length && <details>
                  <summary>视觉观察</summary>
                  <ul className="observations">
                    {result.observations.map((text, i) => <li key={i}>{text}</li>)}
                  </ul>
                </details>}
                {result.negativePrompt && (
                  <details>
                    <summary>排除项</summary>
                    <p>{result.negativePrompt}</p>
                  </details>
                )}
                {!!result.uncertainties.length && (
                  <details>
                    <summary>观察边界</summary>
                    <p>{result.uncertainties.join("\n")}</p>
                  </details>
                )}
                <GenerationPanel key={activeJob.id} job={activeJob} lang={lang} disabled={!connected || !selectedModel || busy || serviceBusy || !!running}
                  onUpdate={updateJob} />
                <button className="secondary" onClick={exportResult}>
                  <Icon name="download" />导出 Markdown
                </button>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
