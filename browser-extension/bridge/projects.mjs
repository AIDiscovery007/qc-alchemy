import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

export const projectIdFor = (bytes) => createHash("sha256").update(bytes).digest("hex");
const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt);

export async function createProjectStore({ dataDir, jobs, readReference }) {
  const records = new Map();
  const pending = new Map();
  const save = async (project) => {
    const path = join(dataDir, `project-${project.id}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(project), { mode: 0o600 });
    await rename(temporary, path);
  };
  for (const file of await readdir(dataDir)) {
    const match = /^project-([a-f0-9]{64})\.json$/.exec(file);
    if (!match) continue;
    try {
      const project = JSON.parse(await readFile(join(dataDir, file), "utf8"));
      if (project.id === match[1] && typeof project.createdAt === "string" && typeof project.updatedAt === "string") records.set(project.id, project);
    } catch { /* A damaged project must not hide its recoverable job records. */ }
  }

  async function register({ bytes, extension }, meta = {}) {
    const id = projectIdFor(bytes);
    if (pending.has(id)) return pending.get(id);
    const operation = (async () => {
      const existing = records.get(id);
      const createdAt = meta.createdAt || new Date().toISOString();
      const project = existing || { id, createdAt, updatedAt: createdAt, sourceUrl: meta.sourceUrl || "", capture: meta.capture === "screenshot" ? "screenshot" : "original" };
      if (createdAt < project.createdAt) project.createdAt = createdAt;
      project.extension = extension;
      await writeFile(join(dataDir, `project-${id}.${extension}`), bytes, { mode: 0o600 });
      await save(project);
      records.set(id, project);
      return project;
    })();
    pending.set(id, operation);
    try { return await operation; } finally { pending.delete(id); }
  }

  for (const job of [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    let project;
    try {
      project = await register(await readReference(job.id), job);
    } catch {
      // Preserve incomplete legacy records even when their source image was removed.
      const id = /^[a-f0-9]{64}$/.test(job.projectId || "") && records.has(job.projectId)
        ? job.projectId : projectIdFor(`missing-reference:${job.id}`);
      project = records.get(id) || { id, createdAt: job.createdAt, updatedAt: job.createdAt, sourceUrl: job.sourceUrl || "", capture: job.capture === "screenshot" ? "screenshot" : "original" };
      await save(project);
      records.set(id, project);
    }
    if (job.projectId !== project.id) {
      job.projectId = project.id;
      await writeFile(join(dataDir, `${job.id}.json`), JSON.stringify(job), { mode: 0o600 });
    }
  }

  const projectJobs = (id) => [...jobs.values()].filter((job) => job.projectId === id).sort(newestFirst);
  function summary(project, history = projectJobs(project.id)) {
    const modes = {};
    for (const job of history) {
      if (["style", "recreate", "reenact"].includes(job.mode) && !modes[job.mode]) {
        modes[job.mode] = { status: job.status, hasImage: Boolean(job.generations?.some((generation) => generation.status === "completed")) };
      }
    }
    const updatedAt = [project.updatedAt, ...history.flatMap((job) => [job.createdAt, ...(job.generations || []).map((generation) => generation.createdAt).filter(Boolean)])].sort().at(-1);
    return { id: project.id, title: history.find((job) => job.result?.title)?.result.title || "未命名模板项目", createdAt: project.createdAt, updatedAt, sourceUrl: project.sourceUrl, capture: project.capture, jobCount: history.length, modes };
  }
  return {
    register,
    list: () => [...records.values()].map((project) => summary(project)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get(id) {
      const project = records.get(id);
      if (!project) return;
      const history = projectJobs(id);
      return { ...summary(project, history), jobs: history };
    },
    async reference(id) {
      const project = records.get(id);
      if (!project || !["png", "jpeg", "webp"].includes(project.extension)) return;
      try {
        const bytes = await readFile(join(dataDir, `project-${id}.${project.extension}`));
        if (projectIdFor(bytes) !== id) return;
        return { id, projectId: id, image: `data:image/${project.extension};base64,${bytes.toString("base64")}`, sourceUrl: project.sourceUrl, capture: project.capture };
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    },
    async touch(id) {
      const project = records.get(id);
      if (!project) return;
      project.updatedAt = new Date().toISOString();
      await save(project);
    },
  };
}
