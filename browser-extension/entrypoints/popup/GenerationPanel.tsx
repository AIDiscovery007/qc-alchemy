import { useEffect, useState } from "react";
import { request } from "../../lib/client";
import type { Job } from "../../lib/types";

export default function GenerationPanel({ job, lang, disabled, onUpdate }: {
  job: Job; lang: "zh" | "en"; disabled: boolean; onUpdate(job: Job): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [image, setImage] = useState("");
  const [imageError, setImageError] = useState("");
  const generations = job.generations || [];
  const generation = generations.find((item) => item.id === selected) || generations.at(-1);
  const running = generations.find((item) => item.status === "running");
  const generic = job.mode === "style" && !job.reenact;
  const incomplete = /\[SUBJECT\]/i.test(lang === "zh" ? job.result!.promptZh : job.result!.promptEn);

  useEffect(() => {
    setImage("");
    setImageError("");
    if (generation?.status !== "completed") return;
    let cancelled = false;
    void request<{ image: string }>({ type: "alchemy:generation-image", id: job.id, generationId: generation.id }).then(
      (value) => { if (!cancelled) setImage(value.image); },
      (error) => { if (!cancelled) setImageError(error.message); },
    );
    return () => { cancelled = true; };
  }, [job.id, generation?.id, generation?.status]);

  const act = async (cancel = false) => {
    setBusy(true);
    setError("");
    try {
      onUpdate(await request<Job>({ type: cancel ? "alchemy:generation-cancel" : "alchemy:generate",
        id: job.id, language: lang, generationId: running?.id }));
      setSelected("");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };

  const download = () => {
    if (!image || !generation) return;
    const bytes = Uint8Array.from(atob(image.slice(image.indexOf(",") + 1)), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: image.slice(5, image.indexOf(";")) }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `alchemy-${generation.id.slice(0, 8)}.${generation.extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="generation-card" aria-label="图片生成">
    <h2>让提示词成为画面</h2>
    {!generations.length && <p className="generation-empty">图片待生成</p>}
    <p className="fine">{generic || incomplete ? "先上传主体图并生成专属提示词，再一键生成图片。"
      : `${job.reenact ? "发送这条结果对应的图 1、图 2" : "发送这条结果的参考原图"}与当前${lang === "zh" ? "中文" : "英文"}提示词，排除项一并生效。`}</p>
    <button className="primary" disabled={disabled || busy || !!running || generic || incomplete} aria-busy={busy || !!running} onClick={() => act()}>
      {running ? "正在生成图片…" : busy ? "正在提交…" : generations.length ? "再生成一张 ↗" : "用 Codex 生成图片 ↗"}
    </button>
    {!generic && <p className="fine">由本机 Codex 调用 imagegen，使用 Codex 生图额度。</p>}
    {running && <div className="progress" role="status"><span className="spinner" /><div><strong>{running.stage}</strong><p>图片生成可能需要几分钟</p></div>
      <button className="text-button" disabled={busy} onClick={() => act(true)}>取消</button></div>}
    {error && <div className="error" role="alert">{error}</div>}
    {generations.length > 1 && <label className="generation-picker">生成记录
      <select value={generation?.id} onChange={(e) => setSelected(e.target.value)}>
        {[...generations].reverse().map((item, i) => <option key={item.id} value={item.id}>第 {generations.length - i} 次 · {item.language === "zh" ? "中文" : "英文"} · {item.stage}</option>)}
      </select>
    </label>}
    {generation?.status === "failed" && <div className="error" role="alert">{generation.error || "生图失败，请重试"}</div>}
    {generation?.status === "cancelled" && <p className="fine">已取消，本次逆向提示词仍然保留。</p>}
    {generation?.status === "completed" && <>
      {imageError ? <div className="error" role="alert">{imageError}</div> : image ? <>
        <img className="generated-image" src={image} alt={`${job.result!.title} · 生成结果`} />
        <button className="secondary" onClick={download}>下载图片 ↓</button>
      </> : <p className="fine" role="status">正在读取生成图片…</p>}
    </>}
  </section>;
}
