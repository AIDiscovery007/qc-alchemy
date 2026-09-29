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
        if (state.startsWith('generation')) {
          job.reenact={basePrompt:'保留图 1 主体，迁移图 2 风格'};
          job.result.promptZh=job.result.promptZh.replace('[SUBJECT]','图 1 的主体');
          job.result.promptEn=job.result.promptEn.replace('[SUBJECT]','the subject in image 1');
          if(state==='generation-completed')job.generations=[{id:'preview-generation',status:'completed',stage:'图片已生成',language:'zh',extension:'png'}];
        }
        const template = ${JSON.stringify(image)};
        const projectId='a'.repeat(64), secondId='b'.repeat(64);
        job.projectId=projectId;
        const reenact={...structuredClone(job),id:'reenact-preview',mode:'reenact',reenact:{basePrompt:'只用于主体重演的指令'},generations:[],result:{...job.result,title:'主体重演独立提示词',promptZh:'以主体重演路径的图 1 为主体，按照图 2 重演动作与构图。',promptEn:'Reenact the template with the subject in image 1.'}};
        if(state==='projects') {
          job.reenact={basePrompt:'只用于提取风格的指令'};
          job.result.promptZh='以提取风格路径的图 1 为主体，仅迁移图 2 的视觉风格。';
          job.generations=[{id:'preview-generation',status:'completed',stage:'图片已生成',language:'zh',extension:'png'}];
        }
        const older={...structuredClone(job),id:'older-style',createdAt:'2026-09-01T00:00:00Z',result:{...job.result,title:'早期风格版本',promptZh:'早期版本：保留原始构图，迁移平涂质感。'},generations:[]};
        const projects=[{id:projectId,title:'暖纸底几何模板',createdAt:job.createdAt,updatedAt:job.createdAt,sourceUrl:job.sourceUrl,capture:'original',jobs:state.endsWith('-new')?[]:state==='projects'?[job,reenact,older]:[job]},
          {id:secondId,title:'另一个空白项目',createdAt:job.createdAt,updatedAt:job.createdAt,sourceUrl:'https://example.com/second',capture:'original',jobs:[]}];
        const summary=(project)=>({...project,jobCount:project.jobs.length,modes:Object.fromEntries(['style','recreate','reenact'].flatMap(mode=>{const item=project.jobs.find(j=>j.mode===mode);return item?[[mode,{status:item.status,hasImage:!!item.generations?.some(g=>g.status==='completed')}]]:[]}))});
        const selection=(project)=>({id:project.id,projectId:project.id,image:template,capture:'original',sourceUrl:project.sourceUrl});
        const data={preferences:{token:state==='empty'?'':'preview',mode:state.startsWith('reenact')?'reenact':'style'},selection:state==='empty'?undefined:selection(projects[0])};
        const findJob=(id)=>projects.flatMap(p=>p.jobs).find(j=>j.id===id);
        const listeners = new Set();
        globalThis.chrome = {runtime:{id:'preview',getManifest:()=>({name:'Alchemy preview',version:'0.1.9'}),onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendMessage:async(message)=>{
          if(message.type==='alchemy:state')return {ok:true,value:structuredClone({preferences:{paired:!!data.preferences.token,mode:data.preferences.mode},selection:data.selection})};
          if(message.type==='alchemy:query')return {ok:true,value:structuredClone(message.path==='/health'?{ready:true,skill:'alchemy · 预览',active:projects.some(p=>p.jobs.some(j=>j.status==='running'||j.generations?.some(g=>g.status==='running')))?1:0}:message.path==='/projects'?projects.map(summary):message.path.startsWith('/projects/')?summary(projects.find(p=>p.id===message.path.split('/')[2])):findJob(message.path.split('/')[2]))};
          if(message.type==='alchemy:mode'){data.preferences.mode=message.mode;return {ok:true};}
          if(message.type==='alchemy:project-reference'||message.type==='alchemy:open-project') {
            const next=selection(projects.find(p=>p.id===message.id));
            if(message.type==='alchemy:open-project')data.selection=next;
            return {ok:true,value:next};
          }
          if(message.type==='alchemy:reference') {
            const saved=findJob(message.id);
            return {ok:true,value:{...selection(projects.find(p=>p.id===saved.projectId)),jobId:saved.id,reenact:saved.reenact?{...saved.reenact,subjectImage:template}:undefined}};
          }
          if(message.type==='alchemy:start') {
            const project=projects.find(p=>p.id===message.projectId);
            const next={id:'preview-'+Date.now(),projectId:project.id,mode:message.mode,status:'running',stage:'正在逆向…',createdAt:new Date().toISOString(),sourceUrl:project.sourceUrl,capture:'original',reenact:message.reenact?{basePrompt:message.reenact.basePrompt}:undefined};
            project.jobs.unshift(next);data.selection=selection(project);
            setTimeout(()=>{if(next.status==='running'){next.status='completed';next.stage='逆向完成';next.result={...${JSON.stringify(result)},title:message.mode+' 新提示词',promptZh:'当前路径 '+message.mode+' 的独立提示词'};}},1500);
            return {ok:true,value:{selection:data.selection,job:structuredClone(next)}};
          }
          if(message.type==='alchemy:cancel'){const saved=findJob(message.id);saved.status='cancelled';return {ok:true,value:structuredClone(saved)};}
          if(message.type==='alchemy:generation-image')return {ok:true,value:{image:template}};
          if(message.type==='alchemy:generate') {
            const saved=findJob(message.id);
            const generation={id:'preview-'+Date.now(),status:'running',stage:'正在生成图片…',language:message.language,extension:'png'};
            saved.generations||=[];saved.generations.push(generation);
            setTimeout(()=>{if(generation.status==='running'){generation.status='completed';generation.stage='图片已生成';}},5000);
            return {ok:true,value:structuredClone(saved)};
          }
          if(message.type==='alchemy:generation-cancel') {
            const saved=findJob(message.id), generation=saved.generations.find(item=>item.id===message.generationId);
            generation.status='cancelled';generation.stage='已取消';return {ok:true,value:structuredClone(saved)};
          }
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
