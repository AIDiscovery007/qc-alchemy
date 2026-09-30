import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

// One child per operation, using the same local login and provider as inference.
export async function withCodex({ cwd, signal, onNotification = () => {}, timeoutMs = 600_000 }, action) {
  if (signal?.aborted) throw new Error("任务已取消");
  const proc = spawn(process.env.CODEX_BIN || "codex", ["app-server"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 0;
  let failure;
  let rejectFailure;
  const failed = new Promise((_, reject) => { rejectFailure = reject; });
  failed.catch(() => {});
  const send = (message) => proc.stdin.write(JSON.stringify(message) + "\n");
  const stop = (error) => {
    failure ||= error;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    rejectFailure(error);
  };
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex 接口超时：${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
  const abort = () => stop(new Error("任务已取消"));
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => stop(new Error("Codex 请求超时，请重试")), timeoutMs);
  proc.on("error", (error) => stop(new Error(`无法启动 Codex：${error.message}。请安装并登录 Codex CLI。`)));
  proc.stdin.on("error", stop);
  // Do not forward stderr: third-party providers may include credentials in logs.
  proc.stderr.resume();
  proc.on("exit", (code) => stop(new Error(`Codex 进程结束（${code}），请检查 CLI 登录与配置。`)));
  createInterface({ input: proc.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiting = pending.get(message.id);
    if (waiting && !message.method) {
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    } else if (message.id !== undefined && message.method) {
      send({ id: message.id, error: { code: -32601, message: "Interactive approvals are unavailable in QC Alchemy." } });
      stop(new Error("Codex 请求交互式操作，请在 Codex 中检查后重试。"));
    } else {
      try { onNotification(message); } catch (error) { stop(error); }
    }
  });
  try {
    return await Promise.race([failed, (async () => {
      await request("initialize", { clientInfo: { name: "qc_alchemy", title: "QC Alchemy", version } });
      send({ method: "initialized", params: {} });
      return action(request);
    })()]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    stop(new Error("任务已结束"));
    proc.kill();
  }
}
