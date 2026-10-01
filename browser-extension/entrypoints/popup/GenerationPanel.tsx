import ImageFileActions from "./ImageFileActions";
import { createPortal } from "react-dom";
import { createContext, useContext, useEffect, useRef, useState, type ComponentType } from "react";
import { request } from "../../lib/client";
import type { Generation, Job } from "../../lib/types";
import Icon from "./Icon";
import AsyncAction from "./AsyncAction";
import { logo } from "../../lib/brand";
import SelectField from "./SelectField";

export const GenerationEffectContext = createContext<ComponentType<{ running: boolean; image: string; failed: boolean }> | null>(null);

export default function GenerationPanel({ job, lang, disabled, subjectImage, onUpdate, workspace = false, actionsTarget, versionNumber = 1 }: {
  workspace?: boolean; actionsTarget?: HTMLElement | null; versionNumber?: number;
  job: Job; lang: "zh" | "en"; disabled: boolean; subjectImage?: string; onUpdate(job: Job, subjectImage?: string): void;
}) {
  const GenerationEffect = useContext(GenerationEffectContext);
  const [compare, setCompare] = useState(false);
  const [original, setOriginal] = useState<{ key: string; image: string }>();
  const [comparisonError, setComparisonError] = useState("");
  const [modal, setModal] = useState<{ kind: "info" | "zoom"; generation: Generation; image: string }>();
  const zoomDialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [asset, setAsset] = useState<{ key: string; image: string; path?: string }>();
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyRevision = useRef(0);
  const [imageError, setImageError] = useState("");
  const generations = job.generations || [];
  const generation = generations.find((item) => item.id === selected) || generations.at(-1);
  const assetKey = `${job.id}:${generation?.id}`;
  const image = asset?.key === assetKey ? asset.image : "";
  const imagePath = asset?.key === assetKey ? asset.path : undefined;
  const running = generations.find((item) => item.status === "running");
  const generic = job.mode === "style" && !job.reenact;
  const incomplete = /\[SUBJECT\]/i.test(lang === "zh" ? job.result!.promptZh : job.result!.promptEn);

  useEffect(() => {
    setAsset(undefined);
    setCopied("");
    setCopyError("");
    setImageError("");
    if (generation?.status !== "completed") return;
    let cancelled = false;
    void request<{ image: string; path?: string }>({ type: "alchemy:generation-image", id: job.id, generationId: generation.id }).then(
      (value) => { if (!cancelled) setAsset({ ...value, key: assetKey }); },
      (error) => { if (!cancelled) setImageError(error.message); },
    );
    return () => { cancelled = true; copyRevision.current++; clearTimeout(copyTimer.current); };
  }, [job.id, generation?.id, generation?.status]);

  useEffect(() => {
    setOriginal(undefined); setComparisonError("");
    if (!compare || !generation) return;
    let cancelled = false;
    void request<{ image: string }>({ type: "alchemy:generation-reference", id: job.id, generationId: generation.id }).then(
      value => { if (!cancelled) setOriginal({ key: assetKey, image: value.image }); },
      error => { if (!cancelled) setComparisonError(error.message); },
    );
    return () => { cancelled = true; };
  }, [compare, assetKey]);
  useEffect(() => {
    if (!modal) return;
    const element = zoomDialog.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [modal]);
  const act = async (cancel = false) => {
    if (!cancel && job.mode !== "recreate" && !subjectImage) return;
    setBusy(true);
    setError("");
    try {
      onUpdate(await request<Job>({ type: cancel ? "alchemy:generation-cancel" : "alchemy:generate",
        id: job.id, language: lang, generationId: running?.id,
        ...(!cancel && job.mode !== "recreate" ? { subjectImage } : {}) }), cancel ? undefined : subjectImage);
      setSelected("");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };

  const copyPath = async () => {
    setCopyError("");
    if (!imagePath) { setCopyError("请重启本机服务后复制图片路径。"); return; }
    const revision = copyRevision.current;
    try {
      await navigator.clipboard.writeText(imagePath);
      if (revision !== copyRevision.current) return;
      setCopied(assetKey);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 1800);
    } catch {
      if (revision === copyRevision.current) setCopyError("复制失败，可手动复制下方路径。");
    }
  };

  const generateButton = <button className={`primary${workspace ? " generate-button" : ""}`} disabled={disabled || busy || !!running || generic || incomplete || (job.mode !== "recreate" && !subjectImage)} aria-busy={busy || !!running}
    title={`使用${job.mode === "recreate" ? "" : "当前主体图、参考模板与"}${lang === "zh" ? "中文" : "英文"}提示词生成，包含排除项。使用 Codex 生图额度。`} onClick={() => act()}>
    {workspace && !running && !busy && <Icon name="image" />}{running ? "正在生成图片…" : busy ? "正在提交…" : generations.length ? "再生成一张" : "生成图片"}{workspace && <Icon name="arrow" />}
  </button>;
  const action = actionsTarget ? createPortal(generateButton, actionsTarget) : workspace ? generateButton : <AsyncAction status={running?.stage || (busy ? "正在提交…" : undefined)} onCancel={running ? () => act(true) : undefined} cancelling={busy}>{generateButton}</AsyncAction>;
  const warning = (generic || incomplete) ? "请先上传主体图，生成专属提示词。" : job.mode !== "recreate" && !subjectImage ? "请先上传可用的主体图。" : "";
  const copyNotice = copyError && <div className="error" role="alert">{copyError}{imagePath && <p className="file-path">{imagePath}</p>}</div>;

  if (workspace) return <section className="generated-pane" aria-label="图片生成">
    <div className="result-toolbar"><h2>生成结果 <small>{generations.filter(item => item.status === "completed").length} 张 · 当前提示词版本</small></h2>
      <div className="result-toolbar-actions"><button className="quiet-button" disabled={!image} aria-pressed={compare} onClick={() => setCompare(!compare)}><ResultIcon name="compare" />{compare ? "退出对照" : "对照原图"}</button>
        {running && <button className="quiet-button" disabled={busy} onClick={() => act(true)} aria-label="取消生图" title="取消生图"><span aria-hidden="true">×</span></button>}</div></div>
    {action}
    {warning && <p className="result-notice">{warning}</p>}
    {error && <div className="error result-notice" role="alert">{error}</div>}
    <div className="preview-canvas">{image ? compare ? <div className="compare-images">
      <figure>{original?.key === assetKey ? <img src={original.image} alt="本次生成的原始输入" /> : <p role="status">{comparisonError || "正在读取原图…"}</p>}<figcaption>{job.mode === "recreate" ? "逆向参考图（未发送生图）" : "本次主体图"}</figcaption></figure>
      <figure><img src={image} alt="生成结果" /><figcaption>生成结果</figcaption></figure>
    </div> : <><button onClick={() => generation && setModal({ kind: "zoom", generation, image })} aria-label="放大生成结果"><img src={image} alt={`${job.result!.title} · 生成结果`} /></button><span className="canvas-tag">生成结果</span></> : (generation?.status === "failed" || generation?.status === "cancelled" || imageError) ? <div className="empty-canvas">
      <Icon name="image" />
      <h3>{generation?.status === "failed" ? "图片生成失败" : generation?.status === "cancelled" ? "图片生成已取消" : "图片暂不可用"}</h3>
      <p role={generation?.status === "failed" || imageError ? "alert" : "status"}>{imageError || (generation?.status === "failed" ? generation.error || "请重新生成图片。" : "可以重新生成，或查看其他生成记录。")}</p>
    </div> : null}{GenerationEffect && generation && !compare && <GenerationEffect key={assetKey} running={generation.status === "running"} image={image}
      failed={generation.status === "failed" || generation.status === "cancelled" || !!imageError} />}</div>
    <div className="result-caption"><strong>{generation ? `版本 ${versionNumber} / ${generation.status === "completed" ? "图片" : "记录"} ${generations.indexOf(generation) + 1}` : "图片待生成"}</strong><span>{generation?.model || job.model || ""}</span></div>
    <div className="result-history" aria-label="生成记录">{generations.map((item, index) => <GenerationThumbnail key={`${job.id}:${item.id}`} jobId={job.id} generation={item} index={index} active={generation?.id === item.id} image={generation?.id === item.id ? image : ""} onSelect={() => { setSelected(item.id); setCompare(false); }} />)}</div>
    {copyNotice}
    <div className="result-bottom"><ImageFileActions key={assetKey} jobId={job.id} generationId={generation?.id} disabled={!image} /><button className="outline-button" disabled={!image} onClick={copyPath} title={imagePath} aria-live="polite"><Icon name={copied === assetKey ? "check" : "copy"} />复制图片路径</button>
      <button className="outline-button" disabled={!generation} onClick={() => generation && setModal({ kind: "info", generation, image })}><ResultIcon name="clock" />生成信息</button></div>
    {modal && <dialog className={`result-dialog modal${modal.kind === "zoom" ? " zoom-modal" : ""}`} ref={zoomDialog} aria-label={modal.kind === "zoom" ? "图片预览" : "本次生成信息"}
      onCancel={event => { event.preventDefault(); setModal(undefined); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); setModal(undefined); } }}>
      <div className="modal-head"><img src={logo} alt="" /><h2>{modal.kind === "zoom" ? "图片预览" : "本次生成信息"}</h2><button className="close-btn" aria-label="关闭窗口" onClick={() => setModal(undefined)}>×</button></div>
      {modal.kind === "zoom" ? <div className="zoom-image"><img src={modal.image} alt="生成结果大图" /></div> : <div className="generation-details">
        <p className="hint">模型：{modal.generation.model || job.model || "未记录"} · 语言：{modal.generation.language === "zh" ? "中文" : "英文"}</p>
        <p className="hint">输入：{job.mode === "recreate" ? "纯文字，不附参考图" : "生成时的主体图 + 参考图"}</p>
        <div className="prompt-box"><div className="prompt-text">{modal.generation.prompt || "此记录未保存提示词快照。"}</div><div className="negative"><p>排除项：{modal.generation.negativePrompt || "无"}</p></div></div>
      </div>}
    </dialog>}
  </section>;

  return <section className="generation-card" aria-label="图片生成">
    <div className="generation-heading"><h2><Icon name="image" />{generations.length ? "生成结果" : "图片待生成"}</h2></div>
    {(generic || incomplete) && <p className="fine">请先上传主体图，生成专属提示词。</p>}
    {job.mode === "recreate" && <p className="fine">仅使用提示词生成图片，不附参考图。</p>}
    {job.mode !== "recreate" && !generic && !incomplete && <p className="fine">{subjectImage ? "使用当前主体图与当前提示词生图，更换主体后无需重新逆向。" : "请先上传可用的主体图。"}</p>}
    {action}
    {error && <div className="error" role="alert">{error}</div>}
    {generations.length > 1 && <SelectField label="生成记录" value={generation?.id} onChange={(event) => setSelected(event.target.value)}>
      {[...generations].reverse().map((item, index) => <option key={item.id} value={item.id}>第 {generations.length - index} 次 · {item.language === "zh" ? "中文" : "英文"} · {item.stage}</option>)}
    </SelectField>}
    {generation?.status === "failed" && <div className="error" role="alert">{generation.error || "生图失败，请重试"}</div>}
    {generation?.status === "cancelled" && <p className="fine">图片生成已取消。</p>}
    {generation?.status === "completed" && <>{imageError ? <div className="error" role="alert">{imageError}</div> : image ? <>
      <img className="generated-image" src={image} alt={`${job.result!.title} · 生成结果`} />
      <div className="image-file-actions"><ImageFileActions key={assetKey} jobId={job.id} generationId={generation?.id} disabled={!image} /></div>
      <button className="secondary copy-path-button" onClick={copyPath} title={imagePath} data-copied={copied === assetKey} aria-live="polite"><Icon name={copied === assetKey ? "check" : "copy"} />复制图片路径</button>{copyNotice}
    </> : <p className="fine" role="status">正在读取生成图片…</p>}</>}
  </section>;
}

function ResultIcon({ name }: { name: "compare" | "clock" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={name === "compare" ? "M12 3v18M4 5h4v14H4zM16 5h4v14h-4z" : "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"} /></svg>;
}

function GenerationThumbnail({ jobId, generation, index, active, image, onSelect }: {
  jobId: string; generation: Generation; index: number; active: boolean; image: string; onSelect(): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [thumbnail, setThumbnail] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (image) { setThumbnail(image); setFailed(false); return; }
    if (generation.status !== "completed" || thumbnail || active) return;
    let cancelled = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void request<{ image: string }>({ type: "alchemy:generation-thumbnail", id: jobId, generationId: generation.id }).then(
        value => { if (!cancelled) setThumbnail(value.image); },
        () => { if (!cancelled) setFailed(true); },
      );
    });
    if (button.current) observer.observe(button.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [jobId, generation.id, generation.status, thumbnail, active, image]);
  const status = { running: "生成中", completed: !image && !thumbnail && failed ? "图片不可用" : "已完成", failed: "失败", cancelled: "已取消" }[generation.status];
  return <button ref={button} className={`result-thumb${active ? " active" : ""}`} onClick={onSelect} aria-pressed={active} aria-label={`查看第 ${index + 1} 条生成记录，${status}`} title={generation.error || generation.stage}>
    {image || thumbnail ? <img src={image || thumbnail} alt="" /> : generation.status === "running" ? <span className="static-effect thumbnail-loading" aria-hidden="true" /> : <small>{generation.status === "completed" && !failed ? "读取中" : status}</small>}<span>{index + 1}</span>
  </button>;
}
