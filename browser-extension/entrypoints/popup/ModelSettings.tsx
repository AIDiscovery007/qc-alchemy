import { pollWhileVisible } from "../../lib/visible-poll";
import { useEffect, useState } from "react";
import { query, request } from "../../lib/client";
import type { ModelCatalog } from "../../lib/types";
import SelectField from "./SelectField";

export default function ModelSettings({ serviceBusy, wide = false, onCheckCli }: { serviceBusy: boolean; wide?: boolean; onCheckCli?(): void }) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const verifying = catalog?.verification?.status === "running";
  const accept = (value: ModelCatalog) => {
    setCatalog(value);
    setDraft((previous) => value.models.some((m) => m.model === previous) ? previous
      : value.selected || value.models.find((m) => m.isDefault)?.model || value.models[0]?.model || "");
  };
  useEffect(() => {
    let cancelled = false;
    const load = serviceBusy ? query<ModelCatalog>("/models") : request<ModelCatalog>({ type: "alchemy:models-refresh" });
    void load.then((value) => { if (!cancelled) accept(value); }, (e) => {
      if (!cancelled) setError(e.message === "Not found" ? "请重启本机服务，以启用模型选择。" : e.message);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!verifying) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const value = await query<ModelCatalog>("/models");
        if (cancelled) return 1500;
        accept(value);
        setError("");

      } catch (e) { if (!cancelled) setError((e as Error).message); }
      return 1500;
    };
    const stop = pollWhileVisible(poll);
    return () => { cancelled = true; stop(); };
  }, [verifying]);
  const act = async (type: "alchemy:models-refresh" | "alchemy:model-verify") => {
    setLoading(true);
    setError("");
    try { accept(await request<ModelCatalog>({ type, model: draft })); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  const failure = catalog?.verification?.model === draft && catalog.verification.status === "failed" ? catalog.verification.error : "";
  const selected = catalog?.models.find((m) => m.model === catalog.selected);
  return <div className="model-settings" aria-busy={loading || verifying}>
    {wide ? <>
      <h3>选择创作模型</h3>
      <div className="settings-model-feature"><span className="settings-symbol" aria-hidden="true">✳</span><div><strong>{selected?.label || catalog?.selected || "尚未选择模型"}</strong><small>{catalog?.selected ? `当前使用 · ${selected?.status === "verified" ? "已验证" : "待验证"}` : "待选择"}{catalog?.accountLabel ? ` / ${catalog.accountLabel}` : ""}</small></div></div>
    </> : <><div className="model-heading">
      <h2>插件模型</h2>
      <button className="text-button" disabled={loading || verifying || serviceBusy} onClick={() => void act("alchemy:models-refresh")}>{loading ? "正在刷新…" : "刷新列表"}</button>
    </div><p className="fine">{catalog?.accountLabel || "本机 Codex"}</p></>}
    <SelectField label={wide ? "可用模型" : "模型"} value={draft} disabled={loading || verifying || serviceBusy || !catalog?.models.length} onChange={(e) => { setDraft(e.target.value); setError(""); }}>
      {!catalog?.models.length && <option value="">{loading ? "正在读取模型…" : "暂无可选模型"}</option>}
      {catalog?.models.map((m) => <option key={m.model} value={m.model}>{m.label} · {m.status === "verified" ? "已验证" : m.status === "unavailable" ? "不可用" : "待验证"}</option>)}
    </SelectField>
    {wide && <div className="settings-row"><span className="settings-label">模型列表</span><button disabled={loading || verifying || serviceBusy} onClick={() => void act("alchemy:models-refresh")}>{loading ? "正在刷新…" : "刷新列表"}</button></div>}
    <button className="primary" disabled={loading || verifying || serviceBusy || !draft} onClick={() => void act("alchemy:model-verify")}>
      {verifying ? "正在验证…" : "验证并使用"}
    </button>
    <p className="fine model-status" role="status">{serviceBusy && !verifying ? "请等待正在执行的任务完成，再切换模型。" : wide && !verifying ? "验证会消耗少量模型额度。" : verifying ? "正在发送简短请求，验证当前账号能否调用。" : catalog?.selected ? `当前使用：${catalog.models.find((m) => m.model === catalog.selected)?.label || catalog.selected}` : "验证会消耗少量模型额度。"}</p>
    {(error || failure) && <div className="error" role="alert">{error || failure}</div>}
    {wide && onCheckCli && <button className="secondary" onClick={onCheckCli}>检查 Codex 版本 →</button>}
  </div>;
}
