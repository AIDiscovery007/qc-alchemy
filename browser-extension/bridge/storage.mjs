import { mkdir, lstat, readFile, readdir, link, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";

export const recordFilePattern = /^(?:project-[a-f0-9]{64}|[a-f0-9-]{36})\.json$/;
export function storagePaths(root) {
  return {
    root, config: join(root, "config"), records: join(root, "records"),
    images: join(root, "images"), logs: join(root, "logs"), runtime: join(root, "runtime"),
    token: join(root, "config", "token"), models: join(root, "config", "model-settings.json"),
    settings: join(root, "config", "runtime.json"), log: join(root, "logs", "bridge.log"),
  };
}

export async function ensureStorage(root) {
  const paths = storagePaths(root);
  for (const path of [root, paths.config, paths.records, paths.images, paths.logs, paths.runtime]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!(await lstat(path)).isDirectory()) throw new Error("本机数据目录无效，请检查目录是否为符号链接。");
  }
  return paths;
}

// Read-only commands can still control an old service before migration on restart.
export async function readStoredConfig(root, name) {
  if (!["token", "runtime.json", "model-settings.json"].includes(name)) throw new Error("配置名称无效");
  for (const path of [join(root, "config", name), join(root, name)]) {
    try { return await readFile(path, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export async function moveLegacyFile(source, destination) {
  try { if (!(await lstat(source)).isFile()) throw new Error("旧数据文件无效，已保留原文件。"); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  try { await link(source, destination); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await lstat(destination)).isFile() || !(await readFile(source)).equals(await readFile(destination)))
      throw new Error("新旧数据目录存在不同内容的同名文件，已保留双方数据，请先解决冲突。");
  }
  await rm(source);
}

// Only run while the service is stopped. Each file move can resume after interruption.
export async function migrateStorage(root) {
  const paths = await ensureStorage(root);
  for (const name of await readdir(root)) {
    const directory = ["token", "runtime.json", "model-settings.json"].includes(name) ? paths.config
      : recordFilePattern.test(name) || name === ".project-deletion.json" ? paths.records
      : name === "bridge.log" ? paths.logs : undefined;
    if (directory) await moveLegacyFile(join(root, name), join(directory, name));
  }
  return paths;
}

export async function rotateServiceLog(path) {
  try {
    if ((await stat(path)).size < 5 * 1024 * 1024) return;
    await rename(path, `${path}.1`);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
