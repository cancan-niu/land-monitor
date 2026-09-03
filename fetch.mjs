// 每日土地状态监测: 拉规自委挂牌/成交 + 预申请列表, 与上次快照 diff, 生成动态页
import fs from 'fs';
import path from 'path';

const API_BASE = 'https://yewu.ghzrzyw.beijing.gov.cn/zkdncms';
const HEADERS = {
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};
const STATE_FILE = path.join(process.cwd(), 'data', 'state.json');
const DYN_FILE = path.join(process.cwd(), 'site', 'index.html');

async function fetchAll(url, pageSize = 500) {
  const all = [];
  let page = 1, count = Infinity;
  while (all.length < count && page <= 12) {
    const u = `${url}?page=${page}&limit=${pageSize}`;
    const res = await fetch(u, { headers: HEADERS });
    const j = await res.json();
    if (j.code !== '0' && j.code !== 0) throw new Error(`API ${j.code}: ${j.msg}`);
    count = Number(j.count || 0);
    all.push(...(j.data || []));
    if (!j.data || !j.data.length) break;
    page++;
  }
  return all;
}

const s = v => String(v == null ? '' : v).trim();
const norm = r => ({
  id: s(r.landid),
  title: s(r.title),
  loc: s(r.landlocation),
  use: s(r.landusetype2),
  status: s(r.issuccessDictText),
  dealDate: s(r.chegnJiaoShiJian).slice(0, 10),
  startPrice: s(r.startprice),
  area: s(r.maxarea),
  pubDate: (s(r.publishTime) || s(r.createDateTime)).slice(0, 10),
  updated: s(r.updateDateTime).slice(0, 10),
});
const normYsq = r => ({
  id: s(r.landid),
  title: s(r.title),
  loc: s(r.landlocation),
  use: s(r.landusetype2),
  status: s(r.issuccessDictText),
  pubDate: (s(r.publishTime) || s(r.createDateTime)).slice(0, 10),
});

function diff(prev, cur, key = 'id') {
  const prevMap = new Map((prev || []).map(x => [x[key], x]));
  const added = [], changed = [];
  for (const c of cur) {
    const p = prevMap.get(c[key]);
    if (!p) added.push(c);
    else if (p.status !== c.status || p.dealDate !== c.dealDate) changed.push({ ...c, prevStatus: p.status });
  }
  return { added, changed };
}

const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toDate = dt => new Date(dt).toISOString().slice(0, 10);

function render(runs) {
  // runs: [{date, newDeals:[], newGuaPai:[], newYsq:[], statusFlip:[]}]
  const row = (t, cls) => `<tr class="${cls}"><td>${esc(t.id)}</td><td>${esc(t.title || t.loc)}</td><td>${esc(t.use)}</td><td>${esc(t.status)}</td><td>${esc(t.dealDate || t.pubDate || '')}</td><td>${esc(t.startPrice ? t.startPrice + ' 万' : '')}</td></tr>`;
  const sec = (title, items, cls, note) => items.length ? `
    <h2>${title} <span class="cnt">${items.length}</span></h2>
    ${note ? `<p class="note">${note}</p>` : ''}
    <table><tr><th>编号</th><th>地块</th><th>用途</th><th>状态</th><th>日期</th><th>起始价</th></tr>${items.map(t => row(t, cls)).join('')}</table>` : '';
  const latest = runs[0];
  const hist = runs.slice(1);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>北京土地动态 · 每日监测</title><style>
body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1f2937}
h1{font-size:20px}h2{font-size:16px;margin:24px 0 8px}.cnt{background:#0891b2;color:#fff;border-radius:10px;padding:1px 9px;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #e5e7eb;padding:5px 9px;text-align:left}
th{background:#f8fafc}tr.new td{background:#ecfeff}tr.flip td{background:#fefce8}
.note{color:#6b7280;font-size:12px;margin:4px 0}.meta{color:#9ca3af;font-size:12px}
.deal td{background:#f0fdf4}
</style></head><body>
<h1>北京土地动态 · 每日监测</h1>
<p class="meta">数据源: 北京市规自委业务站公开接口 · 每日 06:30 (UTC+8) 自动运行 · 竞得企业/成交价待开机后本地台账补录</p>
${latest ? `<p class="meta">最近一次: ${latest.date}</p>` + sec('新挂牌', latest.newGuaPai, 'new') + sec('新成交(状态转已成交)', [...latest.newDeals, ...latest.statusFlip], 'deal', '状态由在挂转为已成交——竞得人与成交价需从成交公告补录') + sec('新预申请', latest.newYsq, 'new') + (latest.newGuaPai.length + latest.newDeals.length + latest.statusFlip.length + latest.newYsq.length === 0 ? '<h2>今日无变化</h2>' : '') : '<h2>首次运行, 建立基线快照</h2>'}
${hist.length ? '<h2>历史动态</h2>' + hist.map(r => `<p class="meta">${r.date}: 新挂牌 ${r.newGuaPai.length} · 新成交 ${r.newDeals.length + r.statusFlip.length} · 新预申请 ${r.newYsq.length}</p>`).join('') : ''}
</body></html>`;
}

const today = toDate(process.env.RUN_DATE || new Date());
console.log('RUN_DATE', today);
const guapai = (await fetchAll(`${API_BASE}/tdgltdsc/tdzpgxm/esSearchList`)).map(norm);
const ysq = (await fetchAll(`${API_BASE}/tdgltdscydysq/esSearchList`)).map(normYsq);
console.log('guapai', guapai.length, 'ysq', ysq.length);

let prev = null;
try { prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
const cur = { guapai, ysq };
let run;
if (!prev) {
  run = { date: today, newGuaPai: [], newDeals: [], newYsq: [], statusFlip: [], baseline: true };
} else {
  const dG = diff(prev.guapai, guapai);
  const dY = diff(prev.ysq, ysq);
  run = {
    date: today,
    newGuaPai: dG.added,
    newDeals: dG.added.filter(x => x.status === '已成交'),
    statusFlip: dG.changed,
    newYsq: dY.added,
  };
}
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
fs.writeFileSync(STATE_FILE, JSON.stringify(cur, null, 1));
fs.writeFileSync('data/runs.json', JSON.stringify([run, ...((() => { try { return JSON.parse(fs.readFileSync('data/runs.json', 'utf8')); } catch { return []; } })())].slice(0, 30), null, 1));
fs.mkdirSync(path.dirname(DYN_FILE), { recursive: true });
fs.writeFileSync(DYN_FILE, render(JSON.parse(fs.readFileSync('data/runs.json', 'utf8'))));
console.log('diff: 新挂牌', run.newGuaPai.length, '新成交', run.newDeals.length, '状态翻转', run.statusFlip.length, '新预申请', run.newYsq.length);
