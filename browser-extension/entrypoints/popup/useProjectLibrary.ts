import { useEffect, useState } from "react";
import { request } from "../../lib/client";
import type { ProjectPage } from "../../lib/types";

const empty: ProjectPage = { items: [], total: 0, page: 1, pageSize: 24, revision: "" };
async function readPage(page: number, limit: number, q = "", status?: "unstarted") {
  const value = await request<ProjectPage>({ type: "alchemy:projects", page, limit, q, status });
  if (!value || !Array.isArray(value.items) || typeof value.revision !== "string")
    throw new Error("请重启本机服务，以启用项目分页与缩略图。");
  return value;
}

export default function useProjectLibrary(paired: boolean, open: boolean, workspace: boolean, revision: string, showHidden: boolean) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"unstarted" | undefined>();
  const [data, setData] = useState(empty);
  const [recent, setRecent] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { setPage(1); }, [showHidden]);
  useEffect(() => {
    if (!paired || !workspace) return;
    let cancelled = false;
    void readPage(1, 12).then(
      value => { if (!cancelled) setRecent(value); },
      () => { /* The project library exposes retryable connection errors. */ },
    );
    return () => { cancelled = true; };
  }, [paired, workspace, revision, retry, showHidden]);
  useEffect(() => {
    if (!paired || !open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void readPage(page, 24, search.trim(), status).then(value => {
        if (cancelled) return;
        setData(value);
        setPage(value.page);
      }, reason => { if (!cancelled) setError(reason.message); }).finally(() => { if (!cancelled) setLoading(false); });
    }, search ? 180 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [paired, open, page, search, status, revision, retry, showHidden]);
  return { data, recent, page, search, status, loading, error, setPage,
    setSearch: (value: string) => { setSearch(value); setPage(1); },
    setStatus: (value: "unstarted" | undefined) => { setStatus(value); setPage(1); },
    refresh: () => setRetry(value => value + 1),
  };
}
