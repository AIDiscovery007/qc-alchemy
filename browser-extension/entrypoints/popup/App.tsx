import { useEffect, useRef, useState } from "react";
import { query, readState, request, type UiState } from "../../lib/client";
import type { Job, Mode, SubjectInput, Selection } from "../../lib/types";
import SubjectForm from "./SubjectForm";
import { logo } from "../../lib/brand";

const defaults: UiState["preferences"] = { paired: false, mode: "style" };
const modeName = (mode: Mode) => ({ style: "提取风格", recreate: "完整复刻", reenact: "主体重演" })[mode];

export default function App() {
  const [preferences, setPreferences] = useState(defaults);
  const [tokenDraft, setTokenDraft] = useState("");
  const [currentSelection, setCurrentSelection] = useState<Selection>();
  const [historicalSelection, setHistoricalSelection] = useState<Selection>();
  const selection = historicalSelection || currentSelection;
  const [referenceError, setReferenceError] = useState("");
  const [savingMode, setSavingMode] = useState(false);
  const modeRevision = useRef(0);
  const [job, setJob] = useState<Job>();
  const [history, setHistory] = useState<Job[]>([]);
  const [settings, setSettings] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionText, setConnectionText] = useState("尚未连接");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous: Selection | undefined;
    let fingerprint = "";
    let initialized = false;
    const refresh = async () => {
      try {
        const revision = modeRevision.current;
        const value = await readState(previous?.image ? previous.id : undefined, previous?.jobId);
        if (cancelled) return;
        setPreferences((previous) => ({
          ...value.preferences,
          mode: revision === modeRevision.current && revision % 2 === 0 ? value.preferences.mode : previous.mode,
        }));
        if (!initialized) setSettings(!value.preferences.paired);
        initialized = true;
        const { image, reenact, ...metadata } = value.selection || {};
        const next = JSON.stringify(metadata);
        if (next !== fingerprint) {
          const selection = value.selection && {
            ...value.selection,
            image: image || (previous?.id === value.selection.id ? previous.image : undefined),
            reenact: reenact || (previous?.id === value.selection.id && previous.jobId === value.selection.jobId ? previous.reenact : undefined),
          };
          previous = selection;
          fingerprint = next;
          setCurrentSelection(selection);
          setHistoricalSelection(undefined);
          setJob(undefined);
          setError("");
          setHistoryOpen(false);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled) timer = setTimeout(refresh, 1500);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!historicalSelection?.jobId) return;
    let cancelled = false;
    setReferenceError("");
    void request<Selection>({ type: "alchemy:reference", id: historicalSelection.jobId }).then(
      (reference) => { if (!cancelled) setHistoricalSelection(reference); },
      (error) => { if (!cancelled) setReferenceError(error.message); },
    );
    return () => { cancelled = true; };
  }, [historicalSelection?.jobId]);

  useEffect(() => {
    if (!preferences.paired) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const health = await query<{ ready: boolean; skill: string }>("/health");
        if (cancelled) return;
        setConnected(health.ready);
        setConnectionText(
          health.ready ? `已连接 · ${health.skill}` : "未找到 Alchemy 技能",
        );
        if (selection?.jobId) {
          const value = await query<Job>(`/jobs/${selection.jobId}`);
          if (!cancelled) setJob(value);
        }
      } catch (e) {
        if (!cancelled) {
          setConnected(false);
          setConnectionText((e as Error).message);
        }
      }
      if (!cancelled) timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [preferences.paired, selection?.jobId]);

  const saveMode = async (mode: Mode) => {
    if (savingMode || busy) return;
    const previous = preferences.mode;
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
      setSettings(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = async (mode: Mode = preferences.mode, reenact?: SubjectInput) => {
    if (!selection?.image || busy || savingMode) return;
    setBusy(true);
    setError("");
    try {
      const value = await request<{ selection: Selection; job: Job }>({
        type: "alchemy:start",
        id: selection.id,
        referenceJobId: historicalSelection?.jobId,
        mode,
        reenact,
      });
      setCurrentSelection(value.selection);
      setHistoricalSelection(undefined);
      setJob(value.job);
      setCopied(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const returnCurrent = () => {
    setHistoricalSelection(undefined);
    setReferenceError("");
    setJob(undefined);
    setHistoryOpen(false);
    setError("");
  };
  const showHistory = async () => {
    if (historyOpen) {
      returnCurrent();
      return;
    }
    try {
      setHistory(await query<Job[]>("/jobs"));
      setHistoryOpen(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const cancel = async () => {
    if (!job) return;
    try {
      setJob(
        await request<Job>({ type: "alchemy:cancel", id: job.id }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        lang === "zh" ? job!.result!.promptZh : job!.result!.promptEn,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
    a.download = `alchemy-${job.id.slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const activeJob = job?.id === selection?.jobId ? job : undefined;
  const running = activeJob?.status === "running";
  const restoring = historicalSelection && !historicalSelection.image && !referenceError;
  const loadingJob = !!selection?.jobId && !activeJob;
  const reading =
    selection && !selection.image && !selection.error && !selection.jobId;
  const result = activeJob?.result;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <img className="brand-mark" src={logo} alt="" />
          <div>
            <strong>Alchemy</strong>
            <span className="eyebrow">IMAGE TO PROMPT</span>
          </div>
        </div>
        <button
          className="icon-button"
          title="连接设置"
          aria-label="连接设置"
          onClick={() => {
            setSettings(!settings);
            setError("");
          }}
        >
          ⚙
        </button>
      </header>
      <div className="connection">
        <span className={`dot ${connected ? "online" : ""}`} />
        <span title={connectionText}>
          {connected ? connectionText : "本机 Codex 未连接"}
        </span>
        <button onClick={() => setSettings(!settings)}>设置 ↗</button>
      </div>

      {settings && (
        <section className="settings card">
          <h2>连接你的本机 Codex</h2>
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
          <p className="fine">
            无需模型 API Key。分析沿用本机 Codex 的登录和模型配置。
          </p>
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

      <main>
        <div className="section-heading">
          <span className="eyebrow">你的灵感，变成语言</span>
          {!!historicalSelection && !historyOpen && (
            <button className="text-button" onClick={returnCurrent}>返回当前图片</button>
          )}
          <button className="text-button" onClick={showHistory}>
            {historyOpen ? "返回当前图片" : "历史记录"}
          </button>
        </div>
        {historyOpen ? (
          <section className="history">
            <h1>最近的逆向</h1>
            {!history.length && <p className="muted">还没有逆向记录。</p>}
            {history.map((item) => (
              <button
                className="history-item"
                key={item.id}
                onClick={() => {
                  setJob(item);
                  setReferenceError("");
                  setError("");
                  setHistoricalSelection({
                    id: item.id,
                    jobId: item.id,
                    sourceUrl: item.sourceUrl,
                    capture: item.capture,
                  });
                  setHistoryOpen(false);
                }}
              >
                <span>
                  <strong>{item.result?.title || "图片风格逆向"}</strong>
                  <small>
                    {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {modeName(item.mode)}
                  </small>
                </span>
                <span>
                  {item.status === "completed"
                    ? "↗"
                    : item.status === "running"
                      ? "处理中"
                      : "未完成"}
                </span>
              </button>
            ))}
          </section>
        ) : (
          <>
            {!selection && (
              <section className="empty">
                <div className="visual">
                  <div className="visual-card one" />
                  <div className="visual-card two" />
                  <img src={logo} alt="" />
                </div>
                <h1>
                  让喜欢的画面
                  <br />
                  成为下一次创作的起点。
                </h1>
                <p>
                  打开 Pinterest 或任意网页，
                  <br />
                  将鼠标移到图片上，点击「逆向风格」。
                </p>
                <div className="steps">
                  <span>01 选择图片</span>
                  <i>→</i>
                  <span>02 提炼风格</span>
                  <i>→</i>
                  <span>03 复制提示词</span>
                </div>
                <p className="fine">
                  也可以右键图片，选择「用 Alchemy 逆向图片风格」。
                </p>
              </section>
            )}

            {selection?.image && preferences.mode === "recreate" && (
              <figure className="image-card">
                <img src={selection.image} alt="本次选择的参考图片" />
                <figcaption>
                  <span>{historicalSelection ? "历史参考图" : "REFERENCE / 参考图"}</span>
                  <span>
                    {selection.capture === "screenshot"
                      ? "屏幕截取"
                      : "原图读取"}
                  </span>
                </figcaption>
              </figure>
            )}
            {restoring && <p className="fine" role="status">正在恢复这条记录的原图…</p>}
            {referenceError && <div className="error" role="alert">{referenceError}</div>}
            <p className="mode-label">下一次逆向</p>
            <div className="mode-switch" role="group" aria-label="下一次逆向模式">
              <button
                className={preferences.mode === "style" ? "active" : ""}
                aria-pressed={preferences.mode === "style"}
                disabled={savingMode || busy}
                onClick={() => saveMode("style")}
              >
                提取风格<span>保留主体，换风格</span>
              </button>
              <button
                className={preferences.mode === "recreate" ? "active" : ""}
                aria-pressed={preferences.mode === "recreate"}
                disabled={savingMode || busy}
                onClick={() => saveMode("recreate")}
              >
                完整复刻<span>保留内容与构图</span>
              </button>
              <button className={preferences.mode === "reenact" ? "active" : ""}
                aria-pressed={preferences.mode === "reenact"} disabled={savingMode || busy}
                onClick={() => saveMode("reenact")}>
                主体重演<span>换主体，演原图</span>
              </button>
            </div>
            <p className="mode-hint" role="status">
              {running
                ? `正在执行「${modeName(activeJob.mode)}」。完成或取消后，可用同一张图再次逆向。`
                : preferences.mode === "reenact"
                  ? "默认以图 1 为主体、图 2 为风格与重演模板。可编辑任务指令，自定义保留与迁移的内容。原结果保留在历史记录中。"
                  : preferences.mode === "style"
                  ? "上传图 1，保留它的主体、内容与构图，只迁移图 2 的视觉风格。也可仅提取通用风格，留待以后替换主体。"
                  : result
                  ? `当前结果为「${modeName(activeJob.mode)}」。点击下方按钮，用同一张图生成「${modeName(preferences.mode)}」提示词，原结果保留在历史记录中。`
                  : "选好模式后点击下方按钮开始；后续点击网页悬浮按钮也会沿用此模式。"}
            </p>
            {(selection || result) && (
              <>
                {(reading || running) && (
                  <div className="progress" role="status">
                    <span className="spinner" />
                    <div>
                      <strong>{reading ? selection?.stage : job?.stage}</strong>
                      <p>
                        {reading
                          ? "正在准备图片"
                          : "由本机 Codex 执行 Alchemy 技能"}
                      </p>
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
                    disabled={!connected || busy || savingMode || running || loadingJob || !selection.image}
                    onClick={() => start()}
                    aria-busy={busy || running}
                  >
                    {busy
                      ? "正在提交…"
                      : restoring
                        ? "正在恢复原图…"
                        : running
                          ? `正在${modeName(activeJob.mode)}…`
                          : `用此图生成${modeName(preferences.mode)}提示词 ↗`}
                  </button>
                )}
              </>
            )}

            {selection && (["style", "reenact"] as const).map((mode) => <SubjectForm key={`${selection.id}-${mode}`} mode={mode} selection={selection} job={activeJob}
              active={preferences.mode === mode}
              disabled={!connected || busy || savingMode || running || loadingJob || !selection.image}
              submitting={busy} onSubmit={(input) => start(mode, input)}
              onExtract={mode === "style" ? () => start("style") : undefined} />)}
            {!selection && preferences.mode !== "recreate" && <p className="fine">先从网页选一张参考图，或打开一条已有逆向记录。</p>}

            {result && (
              <section className="result">
                <div className="result-heading">
                  <span className="eyebrow">
                    当前结果：{modeName(activeJob.mode)}
                  </span>
                  <span className="success">✓ 已完成</span>
                </div>
                <h1>{result.title}</h1>
                <ul className="observations">
                  {result.observations.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
                <div className="prompt-card">
                  <div className="prompt-toolbar">
                    <div className="language">
                      <button
                        className={lang === "zh" ? "selected" : ""}
                        onClick={() => setLang("zh")}
                      >
                        中文
                      </button>
                      <button
                        className={lang === "en" ? "selected" : ""}
                        onClick={() => setLang("en")}
                      >
                        English
                      </button>
                    </div>
                    <button className="copy-button" onClick={copy}>
                      {copied ? "✓ 已复制" : "复制提示词"}
                    </button>
                  </div>
                  <p className="prompt">
                    {lang === "zh" ? result.promptZh : result.promptEn}
                  </p>
                </div>
                {activeJob.mode === "style" && !activeJob.reenact && (
                  <p className="fine">把 [SUBJECT] 替换成你的创作主体。</p>
                )}
                {activeJob.reenact && <p className="fine">出图时按顺序附上图 1（主体图）、图 2（参考图），再使用此提示词。</p>}
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
                <button className="secondary" onClick={exportResult}>
                  导出 Markdown ↓
                </button>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        <span><img src={logo} alt="" /> QC ALCHEMY</span>
        <span>只在你点击后发送所选图片</span>
      </footer>
    </div>
  );
}
