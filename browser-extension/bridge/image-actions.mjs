import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function openGeneratedImage(path, action, { platform = process.platform, execute = promisify(execFile) } = {}) {
  if (!["open", "reveal"].includes(action)) throw new Error("无效图片操作");
  if (platform !== "darwin") throw new Error("当前系统暂不支持直接打开，请复制图片路径后打开。");
  try {
    await execute("/usr/bin/open", action === "reveal" ? ["-R", path] : [path], { timeout: 5000 });
  } catch {
    throw new Error("无法打开本机图片，请复制图片路径后打开。");
  }
}
