// THROWAWAY: three gallery structures on /workspace.html?variant=A|B|C.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Icon from '../../popup/Icon';
import SelectField from '../../popup/SelectField';
import '../../popup/style.css';
import '../workspace.css';
import './prototype.css';

const names = ['街头字形海报','水彩咖啡日记','光影人物习作','赤色机甲档案','山野之间','蓝色时刻','无界形状','柔软物质','慢生活手记','白日梦'];
const sizes: [number, number][] = [[1049,1499],[1109,1419],[1024,1536],[941,1672],[1600,1000],[1200,1200],[1800,900],[1000,1400],[1600,900],[1200,1200]];
const folders = ['urban-poster','watercolor-mug','watercolor-portrait','red-mecha'];
const modes = ['完整复刻','提取风格','主体重演','多图重演'];
const variants = ['A','B','C'];
const labels = ['自由瀑布流','项目画册','聚焦浏览'];
const designs = ['按原图比例汇入最短列，跨项目连续浏览。','按项目分组，每组独立横向浏览生成结果。','左侧选择作品，右侧放大查看来源和生成信息。'];
type Work = { id: number; project: number; title: string; width: number; height: number; src: string; full: string; mode: string; version: number; day: string };
function works(count: number): Work[] { return Array.from({ length: count }, (_, id) => { const project = (id * 7) % 10, [width,height] = sizes[project]!; return { id,project,title:names[project]!,width,height,src:project < 4 ? `/prototype-thumb/${project}` : `/prototype-art/${project - 4}`,full:project < 4 ? `/docs/gallery/${folders[project]}/result.png` : `/prototype-art/${project - 4}`,mode:modes[id % 4]!,version:1 + id % 3,day:id < 12 ? '今天' : id < 24 ? '昨天' : '9 月 30 日' }; }); }
function Picture({ work, full = false, priority = false }: { work: Work; full?: boolean; priority?: boolean }) { return <img src={full ? work.full : work.src} width={work.width} height={work.height} alt={`${work.title} · 生成结果 ${work.id + 1}`} loading={priority || full ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : undefined} />; }
function App() {
  const initial = new URLSearchParams(location.search).get('variant') || 'A';
  const [variant,setVariant] = useState(variants.includes(initial) ? initial : 'A');
  const [large,setLarge] = useState(false), [query,setQuery] = useState(''), [ratio,setRatio] = useState('all'), [project,setProject] = useState('all'), [sort,setSort] = useState('new'), [dense,setDense] = useState(false), [page,setPage] = useState('gallery'), [collapsed,setCollapsed] = useState(false);
  const [narrow,setNarrow] = useState(() => matchMedia('(max-width: 759px)').matches);
  const sidebarCollapsed = narrow || collapsed;
  useEffect(() => {
    const media = matchMedia('(max-width: 759px)'), update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [current,setCurrent] = useState<Work | null>(null), [focus,setFocus] = useState(0), [debug,setDebug] = useState(false), [mounted,setMounted] = useState(0);
  const [viewport,setViewport] = useState({ top:0,height:800,width:1000 });
  const scroller = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null), pending = useRef(0);
  const all = useMemo(() => works(large ? 1200 : 36), [large]);
  const filtered = useMemo(() => {
    const list = all.filter(w => (project === 'all' || w.project === Number(project)) && w.title.includes(query.trim()) && (ratio === 'all' || ratio === 'landscape' && w.width > w.height || ratio === 'portrait' && w.width < w.height || ratio === 'square' && w.width === w.height));
    return sort === 'old' ? list.reverse() : list;
  },[all,project,query,ratio,sort]);
  const position = useMemo(() => {
    const width = viewport.width, gap = dense ? 12 : 18;
    const cols = Math.max(1,Math.floor((width + gap) / (dense ? 180 : 235)));
    const cell = (width - gap * (cols - 1)) / cols, heights = Array(cols).fill(0);
    const rects = filtered.map(work => { const col = heights.indexOf(Math.min(...heights)), y = heights[col], height = cell * work.height / work.width + 52; heights[col] += height + gap; return { work,x:col * (cell + gap),y,width:cell,height }; });
    return { rects,height:Math.max(0,...heights),cols,width,gap,items:filtered };
  },[filtered,viewport.width,dense]);
  const previousLayout = useRef<typeof position | null>(null);
  const scrollSnapshot = useRef({ top:0, max:0 });
  function rememberScroll() {
    const el = scroller.current;
    if (el) scrollSnapshot.current = { top:el.scrollTop, max:el.scrollHeight - el.clientHeight };
  }
  useLayoutEffect(() => {
    const old = previousLayout.current, el = scroller.current, { top,max } = scrollSnapshot.current;
    if (variant === 'A' && old?.items === position.items && el && top > 0 &&
        (old.width !== position.width || old.cols !== position.cols || old.gap !== position.gap)) {
      // Use the pre-commit snapshot: the shorter DOM may already have clamped scrollTop.
      if (Math.abs(max - top) < 2) el.scrollTop = el.scrollHeight;
      else {
        const anchor = old.rects.find(r => r.y + r.height > top);
        const next = anchor && position.rects.find(r => r.work.id === anchor.work.id);
        if (anchor && next) el.scrollTop = next.y + (top - anchor.y) * next.height / anchor.height;
      }
      measure();
    }
    previousLayout.current = position;
    rememberScroll();
  }, [position]);
  const visible = position.rects.filter(r => r.y + r.height > viewport.top - 650 && r.y < viewport.top + viewport.height + 650);
  function measure() { const el = scroller.current; if (el) setViewport({ top:el.scrollTop,height:el.clientHeight,width:el.clientWidth }); }
  function onScroll() {
    rememberScroll();
    if (!pending.current) pending.current = requestAnimationFrame(() => { pending.current = 0; measure(); });
  }
  useLayoutEffect(() => { measure(); const observer = new ResizeObserver(measure); if (scroller.current) observer.observe(scroller.current); return () => { observer.disconnect(); cancelAnimationFrame(pending.current); pending.current = 0; }; },[variant,page]);
  useEffect(() => { scroller.current?.scrollTo({top:0}); setFocus(0); },[query,project,ratio,sort,large,variant]);
  useEffect(() => setMounted(variant === 'A' ? visible.length : variant === 'B' ? Math.min(8,filtered.length) * Math.min(10,new Set(filtered.map(w => w.project)).size) : Math.min(12,filtered.length) + 1),[variant,visible.length,filtered.length]);
  function changeVariant(next: string) { setVariant(next);setPage('gallery'); const url = new URL(location.href);url.searchParams.set('variant',next);history.replaceState(null,'',url); }
  function cycle(delta: number) { changeVariant(variants[(variants.indexOf(variant) + delta + 3) % 3]!); }
  useEffect(() => { function keys(e: KeyboardEvent) { if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]') || dialog.current?.open) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycle(e.key === 'ArrowLeft' ? -1 : 1); } } window.addEventListener('keydown',keys);return () => window.removeEventListener('keydown',keys); },[variant]);
  function open(work: Work, target: HTMLElement) { opener.current = target;setCurrent(work);dialog.current?.showModal(); }
  function close() { dialog.current?.close();opener.current?.focus({preventScroll:true}); }
  function goProject(work: Work) { close();setProject(String(work.project));setPage('project'); }
  const focused = (filtered[focus] || filtered[0])!;
  const thumbStart = Math.max(0,Math.min(focus - 3,filtered.length - 12));
  return <div className="app workspace-app gallery-prototype" data-sidebar-collapsed={sidebarCollapsed}>
    <aside className="sidebar" aria-label="工作台导航">
      <div className="logo-row"><img src="/assets/brand/reframe.svg" alt=""/><strong>QC-Reframe</strong><button className="icon-button sidebar-toggle" aria-label={sidebarCollapsed ? '展开项目栏' : '收起项目栏'} disabled={narrow} onClick={() => setCollapsed(!collapsed)}><Icon name="sidebar"/></button></div>
      <button className="new-project" aria-label="新建项目" onClick={() => setPage('new')}><Icon name="plus"/><span>新建项目</span></button>
      <button className={`nav-action ${page === 'gallery' ? 'active' : ''}`} aria-label="作品画廊" onClick={() => {setPage('gallery');setProject('all');}}><Icon name="image"/><span>作品画廊</span></button>
      <button className={`nav-action ${page === 'projects' ? 'active' : ''}`} aria-label="全部项目" onClick={() => setPage('projects')}><Icon name="grid"/><span>全部项目</span><small className="count">10</small></button>
      <button className="nav-action" aria-label="任务中心" onClick={() => setPage('tasks')}><Icon name="clock"/><span>任务中心</span></button>
      <div className="sidebar-label">最近项目</div>
      <div className="project-nav">{all.slice(0,8).map(w => <button key={w.id} className="prototype-project" title={w.title} onClick={() => { setProject(String(w.project));setPage('project'); }}><Picture work={w}/><span><strong>{w.title}</strong><small>{w.mode}</small></span></button>)}</div>
      <div className="sidebar-bottom"><button className="nav-action" aria-label="设置中心" onClick={() => setPage('settings')}><Icon name="settings"/><span>设置中心</span></button><div className="connection-state"><i className="online-dot"/>本地原型</div></div>
    </aside>
    <div className="gallery-main">
      <header className="gallery-head"><div><h1>{page === 'gallery' ? '作品画廊' : page === 'projects' ? '全部项目' : page === 'project' ? names[Number(project)] : page === 'new' ? '新建项目' : page === 'tasks' ? '任务中心' : '设置中心'}</h1>{page === 'gallery' && <p>{all.length.toLocaleString()} 件作品<span>·</span>10 个项目</p>}</div>{(page === 'gallery' || page === 'projects') && <label className="gallery-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input aria-label="搜索项目或作品" placeholder="搜索项目或作品" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><Icon name="close"/></button>}</label>}</header>
      {page === 'gallery' ? <>
        <div className="gallery-toolbar"><div className="ratio-tabs" aria-label="作品比例">{[['all','全部作品'],['portrait','竖图'],['landscape','横图'],['square','方图']].map(([key,label]) => <button key={key} aria-pressed={ratio === key} className={ratio === key ? 'selected' : ''} onClick={() => setRatio(key!)}>{label}</button>)}</div><div className="gallery-filters"><SelectField label="项目" aria-label="筛选项目" value={project} onChange={e => setProject(e.target.value)}><option value="all">所有项目</option>{names.map((n,i) => <option key={n} value={i}>{n}</option>)}</SelectField><SelectField label="排序" aria-label="排序" value={sort} onChange={e => setSort(e.target.value)}><option value="new">最新生成</option><option value="old">最早生成</option></SelectField>{variant === 'A' && <button className="density-button" aria-label="切换图片密度" aria-pressed={dense} onClick={() => setDense(!dense)}><Icon name="grid"/></button>}</div></div>
        <div className="gallery-scroll" ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="浏览生成作品">
          {!filtered.length ? <div className="gallery-empty"><Icon name="image"/><h2>没有找到作品</h2><p>试试其他项目、比例或关键词。</p><button onClick={() => {setQuery('');setRatio('all');setProject('all');}}>清除筛选</button></div> : variant === 'A' ? <div className="masonry" style={{height:position.height}} aria-label="作品瀑布流">{visible.map(({work,x,y,width,height}) => <button key={work.id} className="art-card" data-work={work.id} style={{transform:`translate(${x}px, ${y}px)`,width,height}} onClick={e => open(work,e.currentTarget)}><div className="art-image"><Picture work={work} priority={work.id === 0}/><span className="art-hover"><span>{work.width} × {work.height}</span><Icon name="maximize"/></span></div><div className="art-caption"><strong>{work.title}</strong><small>{work.day} · V{work.version}</small></div></button>)}</div> : variant === 'B' ? <div className="project-albums">{Array.from(new Set(filtered.map(w => w.project))).map(p => { const group = filtered.filter(w => w.project === p); return <section key={p} className="project-album"><div className="album-info"><span className="album-index">{String(p + 1).padStart(2,'0')}</span><h2>{names[p]}</h2><p>{group.length} 件作品</p><button onClick={() => {setProject(String(p));changeVariant('A');}}>展开全部 <Icon name="arrow"/></button></div><div className="album-strip">{group.slice(0,8).map(work => <button key={work.id} className="album-work" onClick={e => open(work,e.currentTarget)}><Picture work={work}/><span>V{work.version} · {work.mode}</span></button>)}</div></section>; })}</div> : <div className="focus-browser"><div className="focus-list"><p>{focus + 1} / {filtered.length}</p>{filtered.slice(thumbStart,thumbStart + 12).map((work,i) => <button key={work.id} className={work.id === focused.id ? 'chosen' : ''} onClick={() => setFocus(thumbStart + i)}><Picture work={work}/><span><strong>{work.title}</strong><small>{work.mode} · V{work.version}</small></span></button>)}</div><div className="focus-stage"><button className="focus-art" onClick={e => open(focused,e.currentTarget)}><Picture work={focused} full/></button><div className="focus-bottom"><div><h2>{focused.title}</h2><p>{focused.width} × {focused.height} · {focused.mode} · V{focused.version}</p></div><div><button aria-label="上一件作品" disabled={focus === 0} onClick={() => setFocus(focus - 1)}><Icon name="back"/></button><button aria-label="下一件作品" disabled={focus >= filtered.length - 1} onClick={() => setFocus(focus + 1)}><Icon name="arrow"/></button><button onClick={() => goProject(focused)}>查看项目 <Icon name="arrow"/></button></div></div></div></div>}
        </div>
      </> : page === 'projects' ? <div className="prototype-library">{names.filter(n => n.includes(query)).map(n => {const w = all.find(w => w.title === n)!;return <button key={n} onClick={() => goProject(w)}><Picture work={w}/><strong>{n}</strong><small>{all.filter(a => a.title === n).length} 件生成作品</small></button>;})}</div> : page === 'project' ? <div className="prototype-detail"><button className="back-gallery" onClick={() => setPage('gallery')}><Icon name="back"/> 返回作品画廊</button><div className="detail-art"><Picture work={current?.project === Number(project) ? current : all.find(w => w.project === Number(project))!} full/></div><p>项目详情示意 · 实际接入后定位到对应生成记录</p></div> : <div className="gallery-empty"><Icon name={page === 'tasks' ? 'clock' : page === 'settings' ? 'settings' : 'plus'}/><h2>{page === 'tasks' ? '暂无进行中的任务' : page === 'settings' ? '设置中心不在本次原型范围内' : '从一张参考图开始'}</h2><p>当前为画廊体验原型，使用公开素材与合成示例。</p><button onClick={() => setPage('gallery')}>浏览作品画廊 <Icon name="arrow"/></button></div>}
    </div>
    {import.meta.env.DEV && <div className="prototype-switcher"><span className="prototype-badge">PROTOTYPE</span><button aria-label="上一个方案" onClick={() => cycle(-1)}><Icon name="back"/></button><button className="variant-label" onClick={() => cycle(1)}>{variant} · {labels[variants.indexOf(variant)]}</button><button aria-label="下一个方案" onClick={() => cycle(1)}><Icon name="arrow"/></button><i/><button className={debug ? 'on' : ''} onClick={() => setDebug(!debug)}>实验台</button></div>}
    {debug && <aside className="prototype-debug"><strong>{variant} · {labels[variants.indexOf(variant)]}</strong><p>{designs[variants.indexOf(variant)]}</p><label><input type="checkbox" checked={large} onChange={e => setLarge(e.target.checked)}/>1,200 张压力示例（重复素材）</label><p>数据 {filtered.length} · {variant === 'A' ? `挂载 ${mounted} / ${position.cols} 列` : '分段展示'} · 视口 {Math.round(viewport.width)} × {viewport.height}</p><p>缩略图最长边 800px；原图仅在聚焦或预览时读取。示例不写入项目。</p>{variant === 'A' && <button onClick={() => scroller.current?.scrollTo({top:position.height / 2})}>跳至中段</button>}</aside>}
    <dialog ref={dialog} className="gallery-preview" onCancel={e => {e.preventDefault();close();}} onClick={e => {if (e.target === e.currentTarget) close();}} aria-label="生成作品预览"><div className="preview-layout"><button className="preview-close" aria-label="关闭预览" onClick={close}><Icon name="close"/></button>{current && <><div className="preview-art"><Picture work={current} full/></div><div className="preview-info"><span className="eyebrow">生成作品</span><h2>{current.title}</h2><dl><dt>图片尺寸</dt><dd>{current.width} × {current.height}</dd><dt>生成模式</dt><dd>{current.mode}</dd><dt>提示词版本</dt><dd>版本 {current.version}</dd><dt>生成时间</dt><dd>{current.day} 14:32 · 示例</dd></dl><button className="view-project" onClick={() => goProject(current)}>查看所在项目 <Icon name="arrow"/></button><div className="preview-pagination"><button aria-label="上一张" disabled={filtered.findIndex(w => w.id === current.id) <= 0} onClick={() => setCurrent(filtered[filtered.findIndex(w => w.id === current.id) - 1]!)}><Icon name="back"/></button><span>{filtered.findIndex(w => w.id === current.id) + 1} / {filtered.length}</span><button aria-label="下一张" disabled={filtered.findIndex(w => w.id === current.id) >= filtered.length - 1} onClick={() => setCurrent(filtered[filtered.findIndex(w => w.id === current.id) + 1]!)}><Icon name="arrow"/></button></div></div></>}</div></dialog>
  </div>;
}
document.documentElement.classList.add('embedded','workspace-page');
createRoot(document.getElementById('root')!).render(<App/>);
