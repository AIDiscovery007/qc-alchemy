import { createServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_BODY = 24 * 1024 * 1024;
const bad = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function decodeImage(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_BODY)
    throw bad("图片过大，最多 8 MB");
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw bad("仅支持 PNG、JPEG、WebP 图片");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE)
    throw bad("图片为空或超过 8 MB");
  const signatures = {
    png: bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    webp:
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP",
  };
  if (!signatures[match[1]]) throw bad("图片内容与格式不匹配");
  return { bytes, extension: match[1] };
}

export async function createBridge({
  dataDir = resolve(process.env.ALCHEMY_DATA_DIR || join(root, ".local")),
  skillPath = resolve(
    process.env.ALCHEMY_SKILL_PATH ||
      join(root, "../.agents/skills/alchemy/SKILL.md"),
  ),
  agent = runAgent,
} = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const tokenPath = join(dataDir, "token");
  let token;
  try {
    token = (await readFile(tokenPath, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    token = randomBytes(32).toString("hex");
    await writeFile(tokenPath, token, { mode: 0o600 });
  }
  const jobs = new Map();
  const controllers = new Map();
  const save = (job) =>
    writeFile(join(dataDir, `${job.id}.json`), JSON.stringify(job), {
      mode: 0o600,
    });
  const storedImage = async (id, subject = false) => {
    for (const extension of ["png", "jpeg", "webp"]) {
      let bytes;
      try {
        bytes = await readFile(join(dataDir, `${id}${subject ? "-subject" : ""}.${extension}`));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const image = `data:image/${extension};base64,${bytes.toString("base64")}`;
      decodeImage(image);
      return image;
    }
    throw bad(subject ? "这条记录的主体图已不存在，请重新上传主体图。" : "这条历史记录的原图已不存在，请回到网页重新选择图片。", 404);
  };
  for (const file of await readdir(dataDir)) {
    if (!/^[\da-f-]{36}\.json$/.test(file)) continue;
    try {
      const job = JSON.parse(await readFile(join(dataDir, file), "utf8"));
      if (job.status === "running") {
        job.status = "failed";
        job.error = "本机服务已重启，请重新逆向";
        await save(job);
      }
      jobs.set(job.id, job);
    } catch {
      /* A damaged history record must not prevent startup. */
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || ""))
        throw bad("Invalid host", 403);
      const origin = req.headers.origin;
      if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
        throw bad("Origin not allowed", 403);
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        res.writeHead(204);
        res.end();
        return;
      }
      const supplied = Buffer.from(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      const expected = Buffer.from(token);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        throw bad("配对码不正确，请在设置中重新连接", 401);
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      if (req.method === "GET" && path === "/health") {
        let skill;
        try {
          skill = (await readFile(skillPath, "utf8"))
            .match(/^name:\s*(.+)$/m)?.[1]
            ?.trim();
        } catch {}
        json(200, {
          version: "0.1.6",
          skill: skill || null,
          ready: Boolean(skill),
          active: controllers.size,
        });
        return;
      }
      if (req.method === "GET" && path === "/jobs") {
        json(
          200,
          [...jobs.values()]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 30),
        );
        return;
      }
      const idMatch = /^\/jobs\/([\da-f-]{36})(\/(?:cancel|reference))?$/.exec(path);
      if (idMatch) {
        const job = jobs.get(idMatch[1]);
        if (!job) throw bad("任务不存在", 404);
        if (req.method === "GET" && idMatch[2] === "/reference") {
          const image = await storedImage(job.id);
          let reenact, subjectError;
          if (job.reenact) {
            reenact = { ...job.reenact, subjectImage: "" };
            try {
              reenact.subjectImage = await storedImage(job.id, true);
            } catch (error) {
              if (error.status !== 404) throw error;
              subjectError = error.message;
            }
          }
          json(200, { id: job.id, jobId: job.id, image, sourceUrl: job.sourceUrl, capture: job.capture, reenact, subjectError });
          return;
        }
        if (req.method === "POST" && idMatch[2] === "/cancel") {
          if (job.status === "running") {
            job.status = "cancelled";
            job.stage = "已取消";
            controllers.get(job.id)?.abort();
            await save(job);
          }
          json(200, job);
          return;
        }
        if (req.method === "GET" && !idMatch[2]) {
          json(200, job);
          return;
        }
      }
      if (req.method !== "POST" || path !== "/jobs")
        throw bad("Not found", 404);
      if (controllers.size)
        throw bad("已有图片正在逆向，请等待完成或取消当前任务", 409);
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw bad("Content-Type must be application/json", 415);
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw bad("请求过大", 413);
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw bad("无效 JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw bad("无效请求");
      if (!["style", "recreate", "reenact"].includes(body.mode)) throw bad("无效逆向模式");
      const { bytes, extension } = decodeImage(body.image);
      let subject, reenact;
      if (body.mode === "reenact") {
        if (!body.reenact || typeof body.reenact.basePrompt !== "string" || !body.reenact.basePrompt.trim())
          throw bad("主体重演需要主体图和任务指令");
        if (body.reenact.basePrompt.length > 20000) throw bad("任务指令最多 20000 字符");
        subject = decodeImage(body.reenact.subjectImage);
        // Keep the paired images within the extension's storage quota.
        if (bytes.length > 4 * 1024 * 1024 || subject.bytes.length > 2 * 1024 * 1024)
          throw bad("参考图最多 4 MB，主体图最多 2 MB，请压缩后重试");
        const promptSourceJobId = body.reenact.promptSourceJobId;
        if (promptSourceJobId !== undefined) {
          const source = jobs.get(promptSourceJobId);
          if (!source?.result || source.status !== "completed") throw bad("参考 Prompt 的来源任务不存在或尚未完成");
          if (!bytes.equals(decodeImage(await storedImage(source.id)).bytes))
            throw bad("参考图与 Prompt 的来源不一致，请重新选择历史记录");
        }
        reenact = { basePrompt: body.reenact.basePrompt.trim(), ...(promptSourceJobId ? { promptSourceJobId } : {}) };
      }
      try {
        await readFile(skillPath);
      } catch {
        throw bad("找不到 Alchemy 技能，请设置 ALCHEMY_SKILL_PATH", 503);
      }
      // Recheck after body I/O so simultaneous requests cannot both start.
      if (controllers.size) throw bad("已有图片正在逆向", 409);
      const id = randomUUID();
      const controller = new AbortController();
      controllers.set(id, controller);
      const imagePath = join(dataDir, `${id}.${extension}`);
      const subjectImagePath = subject ? join(dataDir, `${id}-subject.${subject.extension}`) : undefined;
      let sourceUrl = "";
      try {
        const url = new URL(body.sourceUrl);
        if (["http:", "https:"].includes(url.protocol)) {
          url.search = "";
          url.hash = "";
          sourceUrl = url.href;
        }
      } catch {}
      const job = {
        id,
        mode: body.mode,
        status: "running",
        stage: "正在连接本机 Codex…",
        createdAt: new Date().toISOString(),
        sourceUrl,
        capture: body.capture === "screenshot" ? "screenshot" : "original",
        ...(reenact ? { reenact } : {}),
      };
      try {
        await writeFile(imagePath, bytes, { mode: 0o600 });
        if (subject) await writeFile(subjectImagePath, subject.bytes, { mode: 0o600 });
        await save(job);
      } catch (error) {
        controllers.delete(id);
        throw error;
      }
      jobs.set(id, job);
      json(202, job);
      void (async () => {
        try {
          const result = await agent({
            imagePath,
            subjectImagePath,
            basePrompt: reenact?.basePrompt,
            mode: job.mode,
            skillPath,
            cwd: root,
            signal: controller.signal,
            onProgress: (update) => {
              if (job.status === "running") Object.assign(job, update);
            },
          });
          if (job.status === "running")
            Object.assign(job, {
              result,
              status: "completed",
              stage: "逆向完成",
            });
        } catch (error) {
          if (job.status === "running")
            Object.assign(job, {
              status: "failed",
              error: error.message,
              stage: "逆向失败",
            });
        } finally {
          controllers.delete(id);
          await save(job).catch((error) =>
            console.error("保存任务失败:", error.message),
          );
        }
      })();
    } catch (error) {
      if (!res.headersSent)
        json(error.status || 500, {
          error: error.status ? error.message : "本机服务异常，请检查终端日志",
        });
    }
  });
  server.on("close", () => {
    for (const controller of controllers.values()) controller.abort();
  });
  return { server, token, tokenPath };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server, token, tokenPath } = await createBridge();
  const port = Number(process.env.ALCHEMY_PORT || 43187);
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `端口 ${port} 已占用，请检查已启动的 bridge。`
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `QC Alchemy 本机服务：http://127.0.0.1:${port}\n在插件设置中粘贴配对码：${token}\n配对码保存在 ${tokenPath}\n仅调用本机 Codex，按 Ctrl+C 停止。`,
    );
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
}
