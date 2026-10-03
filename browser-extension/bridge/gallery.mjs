import { lstat } from "node:fs/promises";
import sharp from "sharp";

export function createGalleryStore({ projects, images }) {
  const dimensions = new Map();
  let snapshot;
  async function build(revision) {
    const entries = [];
    for (const project of projects.list({ includeHidden: true })) {
      const versions = new Map();
      for (const job of [...projects.get(project.id).jobs].reverse()) {
        const version = (versions.get(job.mode) || 0) + 1;
        versions.set(job.mode, version);
        for (const generation of job.generations || []) {
          if (generation.status !== "completed") continue;
          let file;
          try { file = images.generationPath(generation); } catch { continue; }
          entries.push({ file, hidden: project.hidden === true,
            id: generation.id, projectId: project.id, projectTitle: project.title,
            jobId: job.id, generationId: generation.id, mode: job.mode, version,
            createdAt: generation.createdAt, title: job.result?.title || project.title });
        }
      }
    }
    const files = [...new Set(entries.map(item => item.file))];
    const available = new Map();
    let cursor = 0;
    // Header reads never decode pixels or keep original image bytes in memory.
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        try {
          const stat = await lstat(file);
          if (!stat.isFile()) continue;
          const cached = dimensions.get(file);
          let size = cached?.mtime === stat.mtimeMs && cached?.bytes === stat.size ? cached : undefined;
          if (!size) {
            const metadata = await sharp(file, { limitInputPixels: 40_000_000 }).metadata();
            const { width, height } = metadata.autoOrient;
            if (!width || !height || metadata.format !== file.split(".").at(-1)) continue;
            size = { width, height, mtime: stat.mtimeMs, bytes: stat.size };
            dimensions.set(file, size);
          }
          available.set(file, size);
        } catch { /* Missing or invalid image assets are not gallery results. */ }
      }
    }));
    for (const file of dimensions.keys()) if (!available.has(file)) dimensions.delete(file);
    return { revision, items: entries.flatMap(({ file, ...item }) => {
      const size = available.get(file);
      return size ? [{ ...item, width: size.width, height: size.height }] : [];
    }) };
  }
  return {
    async page({ offset = 0, limit = 100, search = "", projectId, ratio = "all", sort = "newest", includeHidden = false } = {}) {
      const revision = projects.revision;
      if (snapshot?.revision !== revision) snapshot = { revision, value: build(revision) };
      const data = await snapshot.value;
      const visible = data.items.filter(item => includeHidden || !item.hidden);
      const projectList = [...new Map(visible.map(item => [item.projectId, { id: item.projectId, title: item.projectTitle }])).values()];
      const query = search.trim().toLocaleLowerCase();
      const matching = visible.filter(item => (!projectId || item.projectId === projectId) &&
        (!query || `${item.title} ${item.projectTitle}`.toLocaleLowerCase().includes(query)) &&
        (ratio === "all" || (ratio === "square" ? item.width === item.height : ratio === "portrait" ? item.width < item.height : item.width > item.height)))
        .sort((a, b) => (sort === "oldest" ? 1 : -1) * a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return { items: matching.slice(offset, offset + limit), total: matching.length, totalWorks: visible.length,
        projectCount: projectList.length, projects: projectList, revision: data.revision, offset, limit };
    },
  };
}
