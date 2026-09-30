import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/client";
import type { Job } from "../../lib/types";
import Icon from "./Icon";
import SelectField from "./SelectField";

export default function GenerationPanel({ job, lang, disabled, subjectImage, onUpdate }: {
  job: Job; lang: "zh" | "en"; disabled: boolean; subjectImage?: string; onUpdate(job: Job, subjectImage?: string): void;
}) {
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

  return <section className="generation-card" aria-label="图片生成">
    <h2><Icon name="image" />{generations.length ? "生成图片" : "图片待生成"}</h2>
    {(generic || incomplete) && <p className="fine">请先上传主体图，生成专属提示词。</p>}
    {job.mode === "recreate" && <p className="fine">仅使用提示词生成图片，不附参考图。</p>}
    {job.mode !== "recreate" && !generic && !incomplete && <p className="fine">{subjectImage ? "使用当前主体图与当前提示词生图，更换主体后无需重新逆向。" : "请先上传可用的主体图。"}</p>}
    <button className="primary" disabled={disabled || busy || !!running || generic || incomplete || (job.mode !== "recreate" && !subjectImage)} aria-busy={busy || !!running}
      title={`使用${job.mode === "recreate" ? "" : "当前主体图、参考模板与"}${lang === "zh" ? "中文" : "英文"}提示词生成，包含排除项。使用 Codex 生图额度。`} onClick={() => act()}>
      {running ? "正在生成图片…" : busy ? "正在提交…" : generations.length ? "再生成一张" : "用 Codex 生成图片"}
    </button>
    {running && <div className="progress" role="status"><span className="spinner" /><strong>{running.stage}</strong>
      <button className="text-button" disabled={busy} onClick={() => act(true)}>取消</button></div>}
    {error && <div className="error" role="alert">{error}</div>}
    {generations.length > 1 && <SelectField label="生成记录" value={generation?.id} onChange={(e) => setSelected(e.target.value)}>
      {[...generations].reverse().map((item, i) => <option key={item.id} value={item.id}>第 {generations.length - i} 次 · {item.language === "zh" ? "中文" : "英文"} · {item.stage}</option>)}
    </SelectField>}
    {generation?.status === "failed" && <div className="error" role="alert">{generation.error || "生图失败，请重试"}</div>}
    {generation?.status === "cancelled" && <p className="fine">图片生成已取消。</p>}
    {generation?.status === "completed" && <>
      {imageError ? <div className="error" role="alert">{imageError}</div> : image ? <>
        <img className="generated-image" src={image} alt={`${job.result!.title} · 生成结果`} />
        <button className="secondary copy-path-button" onClick={copyPath} title={imagePath} data-copied={copied === assetKey} aria-live="polite">
          <Icon name={copied === assetKey ? "check" : "copy"} />{copied === assetKey ? "已复制路径" : "复制图片路径"}
        </button>
        {copyError && <div className="error" role="alert">{copyError}{imagePath && <p className="file-path">{imagePath}</p>}</div>}
      </> : <p className="fine" role="status">正在读取生成图片…</p>}
    </>}
  </section>;
}
