import { useEffect, useState } from "react";
import { query, request } from "../../lib/client";
import type { ModelCatalog } from "../../lib/types";
import SelectField from "./SelectField";

export default function ModelSettings({ serviceBusy }: { serviceBusy: boolean }) {
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
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await query<ModelCatalog>("/models");
        if (cancelled) return;
        accept(value);
        setError("");
        if (value.verification?.status !== "running") return;
      } catch (e) { if (!cancelled) setError((e as Error).message); }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [verifying]);
  const act = async (type: "alchemy:models-refresh" | "alchemy:model-verify") => {
    setLoading(true);
    setError("");
    try { accept(await request<ModelCatalog>({ type, model: draft })); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  const failure = catalog?.verification?.model === draft && catalog.verification.status === "failed" ? catalog.verification.error : "";
  return <div className="model-settings" aria-busy={loading || verifying}>
    <div className="model-heading">
      <h2>插件模型</h2>
      <button className="text-button" disabled={loading || verifying || serviceBusy} onClick={() => void act("alchemy:models-refresh")}>刷新列表</button>
    </div>
    <p className="fine">{catalog?.accountLabel || "本机 Codex"} · 仅用于本插件</p>
    <SelectField label="模型" value={draft} disabled={loading || verifying || !catalog?.models.length} onChange={(e) => { setDraft(e.target.value); setError(""); }}>
      {!catalog?.models.length && <option value="">{loading ? "正在读取模型…" : "暂无可选模型"}</option>}
      {catalog?.models.map((m) => <option key={m.model} value={m.model}>{m.label} · {m.status === "verified" ? "已验证" : m.status === "unavailable" ? "不可用" : "待验证"}</option>)}
    </SelectField>
    <button className="primary" disabled={loading || verifying || serviceBusy || !draft} onClick={() => void act("alchemy:model-verify")}>
      {verifying ? "正在验证…" : "验证并使用"}
    </button>
    <p className="fine" role="status">{verifying ? "正在发送简短请求，验证当前账号能否调用。" : catalog?.selected ? `当前使用：${catalog.models.find((m) => m.model === catalog.selected)?.label || catalog.selected}` : "验证会发送一次简短请求，成功后保存选择。"}</p>
    {(error || failure) && <div className="error" role="alert">{error || failure}</div>}
  </div>;
}
