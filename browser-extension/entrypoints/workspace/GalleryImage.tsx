import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/client";
import type { GalleryWork } from "../../lib/types";

// Each gallery owns a bounded thumbnail cache; originals live only in the open preview.
export function thumbnailLoader() {
  const cache = new Map<string, string>();
  const queue: (() => Promise<void>)[] = [];
  let active = 0;
  function drain() {
    while (active < 4 && queue.length) {
      const run = queue.shift()!; active++;
      void run().finally(() => { active--; drain(); });
    }
  }
  return (work: GalleryWork, signal: AbortSignal) => new Promise<string>((resolve, reject) => {
    const key = `${work.jobId}:${work.generationId}`, saved = cache.get(key);
    if (saved) { cache.delete(key); cache.set(key, saved); resolve(saved); return; }
    queue.push(async () => {
      if (signal.aborted) { resolve(""); return; }
      try {
        const { image } = await request<{ image: string }>({ type: "alchemy:generation-thumbnail", id: work.jobId, generationId: work.generationId });
        if (!image) throw new Error("图片暂不可用");
        cache.set(key, image);
        if (cache.size > 80) cache.delete(cache.keys().next().value!);
        resolve(image);
      } catch (error) { reject(error); }
    });
    drain();
  });
}

export default function GalleryImage({ work, load, full = false, priority = false }: {
  work: GalleryWork; load: ReturnType<typeof thumbnailLoader>; full?: boolean; priority?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState(""), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setImage(""); setError("");
    async function read() {
      try {
        const image = full ? (await request<{ image: string }>({ type: "alchemy:generation-image", id: work.jobId, generationId: work.generationId })).image : await load(work, abort.signal);
        if (!image) throw new Error("图片暂不可用");
        if (!abort.signal.aborted) setImage(image);
      } catch (reason) { if (!abort.signal.aborted) setError((reason as Error).message); }
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void read(); }
    }, { root: host.current?.closest(".gallery-scroll"), rootMargin: "150px" });
    if (full || priority) void read();
    else if (host.current) observer.observe(host.current);
    return () => { abort.abort(); observer.disconnect(); };
  }, [work.jobId, work.generationId, full, priority, load, retry]);
  return <span className="gallery-picture" ref={host}>
    {image && !error ? <img data-gallery-original={full || undefined} data-reminder-task={full ? work.generationId : undefined} src={image} width={work.width} height={work.height} alt={`${work.title} · 生成结果`} loading={full || priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : undefined} onError={() => setError("图片无法显示")} />
      : <span className="gallery-image-status" role={error ? "status" : undefined}>{error || "读取中…"}{full && error && <button onClick={() => setRetry(value => value + 1)}>重新读取</button>}</span>}
  </span>;
}
