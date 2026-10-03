import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/client";
import type { GalleryPage } from "../../lib/types";

const empty: GalleryPage = { items: [], total: 0, totalWorks: 0, projectCount: 0, projects: [], revision: "", offset: 0, limit: 96 };
export type GalleryFilter = { search: string; projectId: string; ratio: string; sort: string };

export default function useGallery(filter: GalleryFilter, connected: boolean, revision: string, showHidden: boolean) {
  const key = JSON.stringify([filter, showHidden]);
  const [result, setResult] = useState({ key, showHidden, data: empty });
  const data = result.key === key ? result.data : result.showHidden === showHidden ? { ...result.data, items: empty.items, total: 0 } : empty;
  const latest = useRef(data); latest.current = data;
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0), pending = useRef(false);
  async function read(offset: number) {
    const { projectId, ...query } = filter;
    const page = await request<GalleryPage>({ type: "alchemy:gallery", ...query, ...(projectId ? { projectId } : {}), offset, limit: 96 });
    if (!page || !Array.isArray(page.items) || typeof page.revision !== "string") throw new Error("请重启本机服务，以启用作品画廊。");
    return page;
  }
  useEffect(() => {
    const ticket = ++epoch.current;
    pending.current = true; setLoading(true); setError("");
    if (!connected) { pending.current = false; setLoading(false); return; }
    const timer = setTimeout(async () => {
      try {
        const count = Math.max(96, latest.current.items.length);
        const first = await read(0);
        let items = first.items;
        while (items.length < Math.min(count, first.total)) {
          if (ticket !== epoch.current) return;
          const page = await read(items.length);
          if (page.revision !== first.revision) { setRetry(value => value + 1); return; }
          if (!page.items.length) break;
          items = [...items, ...page.items];
        }
        if (ticket !== epoch.current) return;
        const next = { ...first, items };
        setResult(old => old.key === key && JSON.stringify(old.data) === JSON.stringify(next) ? old : { key, showHidden, data: next });
      } catch (reason) { if (ticket === epoch.current) setError((reason as Error).message); }
      finally { if (ticket === epoch.current) { pending.current = false; setLoading(false); } }
    }, filter.search ? 180 : 0);
    return () => { epoch.current++; clearTimeout(timer); };
  }, [key, connected, revision, retry]);
  async function more() {
    if (pending.current || !connected || latest.current.items.length >= latest.current.total) return;
    const ticket = epoch.current, previous = latest.current;
    pending.current = true; setLoading(true); setError("");
    try {
      const page = await read(previous.items.length);
      if (ticket !== epoch.current) return;
      if (page.revision !== previous.revision) { setRetry(value => value + 1); return; }
      const seen = new Set(previous.items.map(work => work.id));
      const items = [...previous.items, ...page.items.filter(work => !seen.has(work.id))];
      setResult({ key, showHidden, data: { ...page, items } });
      return items;
    } catch (reason) { if (ticket === epoch.current) setError((reason as Error).message); }
    finally { if (ticket === epoch.current) { pending.current = false; setLoading(false); } }
  }
  return { data, loading, error, more, refresh: () => setRetry(value => value + 1), key };
}
