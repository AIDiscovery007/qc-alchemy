// Visual QA of the built popup; this harness never invokes Codex.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve(".output/chrome-mv3");
const result = {
  title: "暖纸底几何叠色",
  observations: [
    "暖米色纸底承托几何色块。",
    "橄榄绿与陶土红形成克制的对比。",
    "轮廓清晰，表面带细微印刷颗粒。",
  ],
  promptZh:
    "以 [SUBJECT] 为主体，提炼为简洁而可辨识的几何形状。采用暖米色纸张底色，大面积橄榄绿色块构成视觉中心，以少量陶土红横向形体形成遮挡与节奏。保留宽松留白，使用平涂色面与轻微纸张颗粒，避免写实立体塑形。",
  promptEn:
    "Depict [SUBJECT] through simple, recognizable geometric forms on warm cream paper. Build a central mass in muted olive green, balanced by a small terracotta shape. Use generous negative space, flat color planes, crisp silhouettes, and subtle paper grain.",
  negativePrompt: "避免镜面高光、强烈渐变和繁复背景。",
  uncertainties: ["无法确定原始制作软件或生成模型。"],
};
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="#e8e1c9"/><circle cx="160" cy="175" r="95" fill="#5b6f4c"/><rect x="55" y="232" width="210" height="63" fill="#bb6c51"/></svg>';
const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const job = {
  id: "preview",
  mode: "style",
  status: "completed",
  stage: "逆向完成",
  createdAt: new Date().toISOString(),
  sourceUrl: "https://example.com/reference",
  capture: "original",
  result,
};

createServer(async (req, res) => {
  try {
    if (req.headers.host !== "127.0.0.1:43188") {
      res.writeHead(403);
      res.end();
      return;
    }
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (path === "/preview.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(`
        const state = new URLSearchParams(location.search).get('state') || 'result';
        const job = ${JSON.stringify(job)};
        if (state === 'running') { job.status='running';job.stage='Codex 正在观察图片…';delete job.result; }
        if (state === 'failed') { job.status='failed';job.error='Codex 连接失败，请检查登录状态后重试';delete job.result; }
        const data = { preferences:{token:state==='empty'?'':'preview',mode:state.startsWith('reenact')?'reenact':'style'}, selection:state==='empty'?undefined:{id:'preview',jobId:state==='reenact-new'?undefined:'preview',image:${JSON.stringify(image)},capture:'original',sourceUrl:job.sourceUrl} };
        const listeners = new Set();
        globalThis.chrome = {runtime:{id:'preview',getManifest:()=>({name:'Alchemy preview',version:'0.1.6'}),onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendMessage:async(message)=>{
          if(message.type==='alchemy:state')return {ok:true,value:{preferences:{paired:!!data.preferences.token,mode:data.preferences.mode},selection:data.selection}};
          if(message.type==='alchemy:query')return {ok:true,value:message.path==='/health'?{ready:true,skill:'alchemy · 预览'}:message.path==='/jobs'?[job]:job};
          if(message.type==='alchemy:mode'){data.preferences.mode=message.mode;return {ok:true};}
          if(message.type==='alchemy:reference')return {ok:true,value:{...data.selection,id:job.id,jobId:job.id}};
          if(message.type==='alchemy:select'){
            if(state==='invalidated')throw new Error('Extension context invalidated.');
            listeners.forEach(fn=>fn({type:'alchemy:show'},{},()=>{}));return {ok:true};
          }
          return {error:'界面预览不会执行逆向，请在扩展中使用。'};
        }}};
      `);
      return;
    }
    if (path === "/content-preview") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<html><head><meta charset="UTF-8"><script src="/preview.js"></script></head><body style="padding:40px;background:#eee;font:16px system-ui"><h1>网页浮层验收</h1><p>示例数据 · 不执行逆向 · 将鼠标移到图片并点击逆向风格</p><img width="320" height="400" alt="预览参考图" src="${image}"><script src="/content-scripts/content.js"></script></body></html>`);
      return;
    }
    const file = resolve(root, "." + (path === "/" ? "/popup.html" : path));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let content = await readFile(file);
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[extname(file)] || "application/octet-stream";
    if (extname(file) === ".html")
      content = Buffer.from(
        content
          .toString()
          .replace(
            "<head>",
            '<head><script src="/preview.js"></script><style>body{max-width:400px;margin:0 auto!important;box-shadow:0 0 0 1px #e0e3d9}#preview-notice{padding:8px 16px;background:#e6ebdc;color:#687959;text-align:center;font:10px system-ui}</style>',
          )
          .replace(
            "<body>",
            '<body><div id="preview-notice">界面预览 · 示例数据 · 不执行逆向</div>',
          ),
      );
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("请先运行 npm run build");
  }
}).listen(43188, "127.0.0.1", () =>
  console.log(
    "UI preview: http://127.0.0.1:43188/?state=result (empty / running / failed)",
  ),
);
