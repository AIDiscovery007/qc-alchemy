// Throwaway, local-only gallery preview. Never writes to project data.
import { createServer } from 'vite';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const originals = ['urban-poster', 'watercolor-mug', 'watercolor-portrait', 'red-mecha'];
const thumbs = await Promise.all(originals.map(name => sharp(`${root}docs/gallery/${name}/result.png`).resize({ width: 640, height: 800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()));
const colors = [['#ede5d4','#b75536','#d8a965'],['#142d34','#aac6bb','#e3af60'],['#e5e9ed','#17457a','#ec5d32'],['#eedbe3','#932f55','#dac172'],['#e4e8dc','#637e4b','#ca9b62'],['#e4e0f2','#6c5ca2','#f59e69']];
function art(i) {
  const [bg,fg,accent] = colors[i % colors.length], w = [1600,1200,1800,1000,1600,1200][i % 6], h = [1000,1200,900,1400,900,1200][i % 6];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1600 1200" preserveAspectRatio="none"><rect width="1600" height="1200" fill="${bg}"/><circle cx="1150" cy="370" r="230" fill="${accent}"/><path d="M-100 1050 Q400 210 820 700T1800 470V1300H-100Z" fill="${fg}"/><path d="M-80 1130 Q500 600 920 960T1700 710V1300H-80Z" fill="${accent}" opacity=".55"/><g fill="${fg}" font-family="Georgia,serif"><text x="100" y="160" font-size="32" letter-spacing="12">REFRAME / STUDIES</text><text x="90" y="360" font-size="150">${['Quiet forms.','Blue hour.','Beyond.','Soft matter.','Slow living.','Daydream.'][i % 6]}</text></g><text x="100" y="1100" fill="${bg}" font-family="sans-serif" font-size="26" letter-spacing="8">${String(i + 1).padStart(2,'0')} — SHAPE, LIGHT &amp; COLOR</text></svg>`;
}
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 43219, strictPort: true }, plugins: [{ name: 'gallery-prototype', configureServer(server) { server.middlewares.use(async (req,res,next) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/workspace.html' || path === '/') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(await server.transformIndexHtml('/workspace.html', '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>作品画廊 · Reframe Prototype</title></head><body><div id="root"></div><script type="module" src="/entrypoints/workspace/gallery-prototype/main.tsx"></script></body></html>')); return;
  }
  if (/^\/prototype-thumb\/[0-3]$/.test(path)) {res.setHeader('Content-Type','image/webp');res.end(thumbs[Number(path.at(-1))]);return;}
  if (/^\/prototype-art\/[0-5]$/.test(path)) {res.setHeader('Content-Type','image/svg+xml');res.end(art(Number(path.at(-1))));return;}
  next();
}); }}] });
await server.listen();
console.log('Gallery prototype: http://127.0.0.1:43219/workspace.html?variant=A');
