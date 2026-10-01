// Resume once on visibility change; never overlap a still-running request.
export function pollWhileVisible(refresh: () => Promise<number>) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout>;
  const run = async () => {
    clearTimeout(timer);
    if (stopped || document.hidden || running) return;
    running = true;
    let delay = 10_000;
    try { delay = await refresh(); }
    finally {
      running = false;
      if (!stopped && !document.hidden) timer = setTimeout(() => void run(), delay);
    }
  };
  const onVisibility = () => { clearTimeout(timer); if (!document.hidden) void run(); };
  document.addEventListener("visibilitychange", onVisibility);
  void run();
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
}
