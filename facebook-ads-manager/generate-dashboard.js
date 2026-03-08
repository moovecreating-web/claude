/**
 * generate-dashboard.js
 * Generates dashboard/index.html — interactive version with live filters.
 * The HTML embeds the access token and fetches Meta API directly on filter changes.
 */

import axios from 'axios';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN      = process.env.META_ACCESS_TOKEN;
const ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '3762537707372777';

if (!TOKEN) { console.error('❌  META_ACCESS_TOKEN not set'); process.exit(1); }

const client = axios.create({
  baseURL: 'https://graph.facebook.com/v21.0',
  params: { access_token: TOKEN }
});

function fmt(d) { return d.toISOString().split('T')[0]; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const today     = new Date();
const until     = addDays(today, -1);
const since     = addDays(until, -6);
const SINCE     = fmt(since);
const UNTIL     = fmt(until);

async function main() {
  // Fetch campaign list for the filter dropdown
  let campaigns = [];
  try {
    const r = await client.get(`/act_${ACCOUNT_ID}/campaigns`, {
      params: { fields: 'id,name,status', limit: 100, effective_status: JSON.stringify(['ACTIVE','PAUSED']) }
    });
    campaigns = r.data.data || [];
    console.log(`✅  ${campaigns.length} campaigns loaded`);
  } catch(e) {
    console.warn('⚠️  Could not load campaigns:', e.response?.data?.error?.message || e.message);
  }

  const html = buildHTML(campaigns);
  const outDir = path.join(__dirname, 'dashboard');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');
  console.log('✅  Dashboard written → dashboard/index.html');
}

function buildHTML(campaigns) {
  const campsJson   = JSON.stringify(campaigns);
  const updatedAt   = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo' });

return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard – Attorney Isabela</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#011e26;color:#f9f8f3;min-height:100vh}

/* ── HEADER ── */
.header{display:flex;align-items:center;gap:14px;padding:10px 22px;background:#013237;border-bottom:2px solid #bb764d;flex-wrap:wrap}
.logo-wrap{flex-shrink:0;height:46px;display:flex;align-items:center}
.logo-wrap img{height:46px;width:auto;display:block;border-radius:3px}
.hdiv{width:1px;height:40px;background:#024a56;flex-shrink:0}
.hinfo .htitle{font-size:13px;font-weight:600;color:#f9f8f3}
.hinfo .hsub{font-size:10px;color:#6d9ea3}

/* filters bar */
.filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:4px}
.filters label{font-size:11px;color:#6d9ea3}
input[type=date]{background:#012530;border:1px solid #024a56;color:#f9f8f3;padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer}
input[type=date]::-webkit-calendar-picker-indicator{filter:invert(.6)}

/* campaign dropdown */
.camp-wrap{position:relative}
.camp-btn{background:#012530;border:1px solid rgba(187,118,77,0.35);color:#d4a070;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap}
.camp-btn::after{content:'▾';font-size:10px}
.camp-menu{display:none;position:absolute;top:calc(100% + 4px);left:0;background:#013237;border:1px solid #024a56;border-radius:8px;padding:6px;min-width:240px;max-height:280px;overflow-y:auto;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.6)}
.camp-menu.open{display:block}
.camp-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;cursor:pointer;font-size:12px}
.camp-item:hover{background:#01424d}
.camp-item input[type=checkbox]{accent-color:#bb764d;width:14px;height:14px}
.camp-item .cstatus{font-size:10px;padding:1px 5px;border-radius:3px;margin-left:auto}
.cstatus.ACTIVE{background:#1a4a1a;color:#4cd97a}
.cstatus.PAUSED{background:#3a2a1a;color:#e09060}
.camp-actions{display:flex;gap:6px;padding:4px 8px 2px;border-top:1px solid #024a56;margin-top:4px}
.camp-actions button{flex:1;background:#012530;border:1px solid #024a56;color:#a0bfc2;padding:4px;border-radius:4px;font-size:11px;cursor:pointer}

/* apply button */
.apply-btn{background:#bb764d;border:none;color:#fff;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.apply-btn:hover{background:#9a5830}
.apply-btn:disabled{background:#012530;color:#4a8a90;cursor:not-allowed}

/* spinner */
.spinner{display:none;width:16px;height:16px;border:2px solid #bb764d;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* KPI cards */
.kpis{display:flex;gap:10px;margin-left:auto;flex-wrap:wrap}
.kpi{background:#012530;border-radius:12px;padding:12px 18px;display:flex;align-items:center;gap:12px;min-width:170px;border:1px solid #024a56}
.kico{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.kico.gold{background:radial-gradient(circle,#d4895a,#9a5830)}
.kico.blue{background:radial-gradient(circle,#2a8a92,#014a55)}
.kico.green{background:radial-gradient(circle,#4a9aa2,#024a55)}
.klabel{font-size:10px;color:#6d9ea3;text-transform:uppercase;letter-spacing:.5px}
.kval{font-size:24px;font-weight:700;color:#f9f8f3;line-height:1.1}
.kdelta{font-size:11px;margin-top:2px}
.pos{color:#5ec87a}.neg{color:#d96a5a}

.upd{font-size:10px;color:#4a7a80;margin-left:auto;align-self:flex-end;padding-bottom:2px;white-space:nowrap}

/* ── MAIN GRID ── */
.main{display:grid;grid-template-columns:160px 1fr 340px;gap:12px;padding:12px 18px}
.sidebar{display:flex;flex-direction:column;gap:10px}
.donut-card{background:#013237;border-radius:12px;padding:14px;border:1px solid #024a56}
.donut-card canvas{width:100%!important;max-height:100px}
.dleg{display:flex;flex-direction:column;gap:4px;margin-top:8px;font-size:11px}
.dleg-item{display:flex;align-items:center;gap:6px}
.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.mcard{background:#013237;border-radius:12px;padding:12px 14px;border:1px solid #024a56;border-left:3px solid #bb764d}
.mlabel{font-size:10px;color:#6d9ea3;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.mval{font-size:22px;font-weight:700;color:#f9f8f3}

.center{display:flex;flex-direction:column;gap:12px;min-width:0}
.cc{background:#013237;border-radius:12px;padding:16px;border:1px solid #024a56}
.cc h3{font-size:10px;color:#6d9ea3;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
.gauges{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.gauge{background:#013237;border-radius:12px;padding:12px 10px;display:flex;flex-direction:column;align-items:center;border:1px solid #024a56}
.glabel{font-size:10px;color:#6d9ea3;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
.gwrap{width:100%;display:block}

.rp{display:flex;flex-direction:column;gap:12px}
.funnel{background:#013237;border-radius:12px;padding:16px;border:1px solid #024a56}
.ftitle{font-size:10px;color:#6d9ea3;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
.frow{display:flex;align-items:center;justify-content:space-between}
.flabel{font-size:13px;color:#a0c0c4;width:60px}
.fbwrap{flex:1;position:relative;height:28px;margin:2px 8px}
.fb{position:absolute;left:50%;transform:translateX(-50%);height:100%;border-radius:4px;transition:width .5s}
.fval{font-size:15px;font-weight:700;color:#f9f8f3;width:80px;text-align:right}
.fconn{height:5px}

.tcard{background:#013237;border-radius:12px;padding:14px;border:1px solid #024a56}
.tcard h3{font-size:10px;color:#6d9ea3;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{color:#6d9ea3;font-weight:500;padding:4px 6px;text-align:right;border-bottom:1px solid #024a56}
th:first-child{text-align:left}
td{padding:5px 6px;text-align:right;color:#a0c0c4;border-bottom:1px solid #012530}
td:first-child{text-align:left;color:#e8f0f1;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tfoot tr td{color:#f9f8f3;font-weight:700;border-top:1px solid #024a56;border-bottom:none}
tbody tr:hover td{background:#01424d}

/* overlay loading */
.loading-overlay{display:none;position:fixed;inset:0;background:rgba(1,30,38,.85);z-index:200;align-items:center;justify-content:center;flex-direction:column;gap:12px}
.loading-overlay.show{display:flex}
.big-spinner{width:44px;height:44px;border:4px solid #bb764d;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
.loading-overlay p{color:#a0bfc2;font-size:14px}
</style>
</head>
<body>

<div class="loading-overlay" id="overlay">
  <div class="big-spinner"></div>
  <p>Loading data…</p>
</div>

<!-- HEADER -->
<div class="header">
  <div class="logo-wrap">
    <img src="logo Altum Law.JPG" alt="Altum Law">
  </div>
  <div class="hdiv"></div>
  <div class="hinfo">
    <div class="htitle">Attorney Isabela – Ad Performance</div>
    <div class="hsub" id="periodLabel">–</div>
  </div>

  <!-- DATE FILTERS -->
  <div class="filters">
    <label>From</label>
    <input type="date" id="dateSince" value="${SINCE}">
    <label>To</label>
    <input type="date" id="dateUntil" value="${UNTIL}">

    <!-- CAMPAIGN FILTER -->
    <div class="camp-wrap" id="campWrap">
      <div class="camp-btn" id="campBtn">All Campaigns</div>
      <div class="camp-menu" id="campMenu">
        <div class="camp-actions">
          <button onclick="selectAllCamps()">Select All</button>
          <button onclick="clearCamps()">Clear</button>
        </div>
        <div id="campList"></div>
      </div>
    </div>

    <button class="apply-btn" id="applyBtn" onclick="applyFilters()">Apply</button>
    <div class="spinner" id="spinner"></div>
  </div>

  <!-- KPI CARDS -->
  <div class="kpis">
    <div class="kpi">
      <div class="kico gold">💰</div>
      <div>
        <div class="klabel">Amount Spent</div>
        <div class="kval" id="kSpend">–</div>
        <div class="kdelta" id="kSpendD">–</div>
      </div>
    </div>
    <div class="kpi">
      <div class="kico blue">🚀</div>
      <div>
        <div class="klabel">Leads</div>
        <div class="kval" id="kLeads">–</div>
        <div class="kdelta" id="kLeadsD">–</div>
      </div>
    </div>
    <div class="kpi">
      <div class="kico green">👥</div>
      <div>
        <div class="klabel">Cost per Lead</div>
        <div class="kval" id="kCpl">–</div>
        <div class="kdelta" id="kCplD">–</div>
      </div>
    </div>
  </div>
  <div class="upd" id="updLabel">Built: ${updatedAt}</div>
</div>

<!-- MAIN -->
<div class="main">

  <!-- SIDEBAR -->
  <div class="sidebar">
    <div class="donut-card">
      <canvas id="platformChart"></canvas>
      <div class="dleg">
        <div class="dleg-item"><div class="dot" style="background:#bb764d"></div><span id="igLegend" style="color:#bb764d">Instagram –%</span></div>
        <div class="dleg-item"><div class="dot" style="background:#2a8a92"></div><span id="fbLegend" style="color:#6d9ea3">Facebook –%</span></div>
      </div>
    </div>
    <div class="mcard"><div class="mval" id="mImpressions">–</div><div class="mlabel">Impressions</div></div>
    <div class="mcard"><div class="mval" id="mClicks">–</div><div class="mlabel">Link Clicks (CTA)</div></div>
    <div class="mcard"><div class="mval" id="mConvRate">–</div><div class="mlabel">Conversion Rate</div></div>
  </div>

  <!-- CENTER -->
  <div class="center">
    <div class="cc">
      <h3>Amount Spent — Link Clicks</h3>
      <canvas id="dailyChart" height="120"></canvas>
    </div>
    <div class="gauges">
      <div class="gauge">
        <div class="glabel">CPM</div>
        <svg class="gwrap" viewBox="0 0 200 115" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="70" fill="none" stroke="#012530" stroke-width="22" stroke-dasharray="220 220" stroke-dashoffset="-220"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="#bb764d" stroke-width="22" stroke-dasharray="0 440" stroke-dashoffset="-220" stroke-linecap="round" id="gArcCPM"/>
          <text x="22" y="113" fill="#4a7a80" font-size="11" text-anchor="start">$0</text>
          <text x="100" y="113" fill="#f9f8f3" font-size="16" font-weight="bold" text-anchor="middle" id="gvCPM">–</text>
          <text x="178" y="113" fill="#4a7a80" font-size="11" text-anchor="end">$30</text>
        </svg>
      </div>
      <div class="gauge">
        <div class="glabel">Invested / CTA Click</div>
        <svg class="gwrap" viewBox="0 0 200 115" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="70" fill="none" stroke="#012530" stroke-width="22" stroke-dasharray="220 220" stroke-dashoffset="-220"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="#bb764d" stroke-width="22" stroke-dasharray="0 440" stroke-dashoffset="-220" stroke-linecap="round" id="gArcCPC"/>
          <text x="22" y="113" fill="#4a7a80" font-size="11" text-anchor="start">$0</text>
          <text x="100" y="113" fill="#f9f8f3" font-size="16" font-weight="bold" text-anchor="middle" id="gvCPC">–</text>
          <text x="178" y="113" fill="#4a7a80" font-size="11" text-anchor="end">$10</text>
        </svg>
      </div>
      <div class="gauge">
        <div class="glabel">Leads / CTA Clicks</div>
        <svg class="gwrap" viewBox="0 0 200 115" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="70" fill="none" stroke="#012530" stroke-width="22" stroke-dasharray="220 220" stroke-dashoffset="-220"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="#bb764d" stroke-width="22" stroke-dasharray="0 440" stroke-dashoffset="-220" stroke-linecap="round" id="gArcConv"/>
          <text x="22" y="113" fill="#4a7a80" font-size="11" text-anchor="start">0%</text>
          <text x="100" y="113" fill="#f9f8f3" font-size="16" font-weight="bold" text-anchor="middle" id="gvConv">–</text>
          <text x="178" y="113" fill="#4a7a80" font-size="11" text-anchor="end">25%</text>
        </svg>
      </div>
    </div>
    <div class="cc">
      <h3>Clicked and Sent a Message</h3>
      <canvas id="waChart" height="80"></canvas>
    </div>
  </div>

  <!-- RIGHT PANEL -->
  <div class="rp">
    <div class="funnel">
      <div class="ftitle">Conversion Funnel</div>
      <div class="frow"><div class="flabel">Reach</div><div class="fbwrap"><div class="fb" id="fReachBar" style="width:100%;background:linear-gradient(90deg,#024a56,#2a8a92)"></div></div><div class="fval" id="fReach">–</div></div>
      <div class="fconn"></div>
      <div class="frow"><div class="flabel">CTA Clicks</div><div class="fbwrap"><div class="fb" id="fClicksBar" style="background:linear-gradient(90deg,#024a56,#2a8a92);opacity:.85"></div></div><div class="fval" id="fClicks">–</div></div>
      <div class="fconn"></div>
      <div class="frow"><div class="flabel">Leads</div><div class="fbwrap"><div class="fb" id="fLeadsBar" style="background:linear-gradient(90deg,#8a4a28,#bb764d)"></div></div><div class="fval" id="fLeads">–</div></div>
      <div class="fconn"></div>
      <div class="frow"><div class="flabel">CPL</div><div class="fbwrap"><div class="fb" id="fCplBar" style="background:linear-gradient(90deg,#6a3a1a,#9a5a35);opacity:.85"></div></div><div class="fval" id="fCpl">–</div></div>
    </div>
    <div class="tcard">
      <h3>Performance by Creative</h3>
      <table>
        <thead><tr><th>Creative</th><th>All Clicks</th><th>Leads</th><th>CPL</th><th>CTR</th></tr></thead>
        <tbody id="adTableBody"></tbody>
        <tfoot><tr><td>Total</td><td id="ftClicks">–</td><td id="ftLeads">–</td><td id="ftCpl">–</td><td id="ftCtr">–</td></tr></tfoot>
      </table>
    </div>
  </div>

</div>

<script>
// ── CONFIG (baked in at build time) ────────────────────────────────
const ACCESS_TOKEN = '${TOKEN}';
const ACCOUNT_ID   = '${ACCOUNT_ID}';
const BASE        = 'https://graph.facebook.com/v21.0';
const CAMPAIGNS   = ${campsJson};

// ── STATE ──────────────────────────────────────────────────────────
let charts = {};
let selectedCampIds = []; // empty = all

// ── HELPERS ────────────────────────────────────────────────────────
const ga = (actions, type) =>
  parseInt((actions||[]).find(a=>a.action_type===type)?.value||'0');

const fmtN = v => Number(v).toLocaleString('en-US');
const fmt$ = v => '$' + (v>=10000?(v/1000).toFixed(1)+'k':v.toFixed(2));

function fmtDateRange(s, u) {
  const sd = new Date(s+'T12:00:00Z'), ud = new Date(u+'T12:00:00Z');
  const mo = {month:'short', day:'numeric'};
  const label = sd.getMonth()===ud.getMonth()
    ? sd.toLocaleDateString('en-US',mo).replace(',','') + '–' + ud.getDate()
    : sd.toLocaleDateString('en-US',mo) + '–' + ud.toLocaleDateString('en-US',mo);
  return label;
}

function deltaHtml(cur, prev, prevSince, prevUntil, higherIsBetter, fmtFn) {
  if (!prev && prev !== 0) return '<span style="color:#4a7a80">no prev data</span>';
  const up  = cur >= prev;
  const cls = (up === higherIsBetter) ? 'pos' : 'neg';
  const arr = up ? '▲' : '▼';
  const dateLabel = fmtDateRange(prevSince, prevUntil);
  const valLabel  = fmtFn ? fmtFn(prev) : prev;
  return \`<span class="\${cls}">\${arr} \${valLabel}</span> <span style="color:#555570;font-size:10px">(\${dateLabel})</span>\`;
}

async function api(path, params={}) {
  const url = new URL(BASE + path);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const r = await fetch(url.toString());
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.data || j;
}

// ── CAMPAIGN FILTER UI ─────────────────────────────────────────────
function buildCampMenu() {
  const list = document.getElementById('campList');
  list.innerHTML = CAMPAIGNS.map(c => \`
    <label class="camp-item">
      <input type="checkbox" value="\${c.id}" onchange="updateCampLabel()">
      <span>\${c.name}</span>
      <span class="cstatus \${c.status}">\${c.status}</span>
    </label>\`).join('');
}

function updateCampLabel() {
  const checked = [...document.querySelectorAll('#campList input:checked')];
  selectedCampIds = checked.map(c=>c.value);
  const btn = document.getElementById('campBtn');
  btn.textContent = selectedCampIds.length === 0
    ? 'All Campaigns'
    : selectedCampIds.length === 1
      ? CAMPAIGNS.find(c=>c.id===selectedCampIds[0])?.name || '1 campaign'
      : selectedCampIds.length + ' campaigns';
}

function selectAllCamps() {
  document.querySelectorAll('#campList input').forEach(i=>i.checked=true);
  updateCampLabel();
}
function clearCamps() {
  document.querySelectorAll('#campList input').forEach(i=>i.checked=false);
  updateCampLabel();
}

// Toggle menu open/close
document.getElementById('campBtn').addEventListener('click', e=>{
  e.stopPropagation();
  document.getElementById('campMenu').classList.toggle('open');
});
document.addEventListener('click', ()=>document.getElementById('campMenu').classList.remove('open'));
document.getElementById('campMenu').addEventListener('click', e=>e.stopPropagation());

// ── FETCH DATA ─────────────────────────────────────────────────────
async function fetchData(since, until) {
  const tr   = JSON.stringify({since, until});
  const days = Math.round((new Date(until)-new Date(since))/(86400000)) + 1;
  const prevUntil = new Date(since); prevUntil.setDate(prevUntil.getDate()-1);
  const prevSince = new Date(prevUntil); prevSince.setDate(prevSince.getDate()-days+1);
  const trPv = JSON.stringify({since: prevSince.toISOString().split('T')[0], until: prevUntil.toISOString().split('T')[0]});

  const filtering = selectedCampIds.length > 0
    ? JSON.stringify([{field:'campaign.id',operator:'IN',value:selectedCampIds}])
    : undefined;

  const baseP = {time_range: tr, level:'account', ...(filtering&&{filtering})};
  const pvP   = {time_range: trPv, level:'account', ...(filtering&&{filtering})};

  const insPath = \`/act_\${ACCOUNT_ID}/insights\`;

  const [ov, daily, plat, byAd, prev] = await Promise.all([
    api(insPath, {...baseP, fields:'impressions,reach,clicks,spend,ctr,cpm,cpc,actions'}),
    api(insPath, {...baseP, fields:'impressions,clicks,spend,actions', time_increment:1}),
    api(insPath, {time_range:tr,level:'account',...(filtering&&{filtering}),fields:'spend,impressions',breakdowns:'publisher_platform'}),
    api(insPath, {...baseP, fields:'ad_name,impressions,clicks,spend,ctr,actions', level:'ad'}),
    api(insPath, {...pvP,   fields:'spend,actions'}),
  ]);

  return {
    ov: ov[0]||{}, daily: Array.isArray(daily)?daily:[], plat: Array.isArray(plat)?plat:[],
    byAd: Array.isArray(byAd)?byAd:[], prev: prev[0]||{},
    prevSince: prevSince.toISOString().split('T')[0],
    prevUntil: prevUntil.toISOString().split('T')[0]
  };
}

// ── RENDER ─────────────────────────────────────────────────────────
function render(data, since, until) {
  const { ov, daily, plat, byAd, prev, prevSince, prevUntil } = data;

  const spend       = parseFloat(ov.spend||0);
  const impressions = parseInt(ov.impressions||0);
  const reach       = parseInt(ov.reach||0);
  const clicks      = parseInt(ov.clicks||0);
  const cpm         = parseFloat(ov.cpm||0);
  const cpc         = parseFloat(ov.cpc||0);
  const ctr         = parseFloat(ov.ctr||0);
  const linkClicks  = ga(ov.actions,'link_click');
  const leads       = ga(ov.actions,'onsite_conversion.messaging_conversation_started_7d');
  const cpl         = leads>0 ? spend/leads : 0;
  const costPerCTA  = linkClicks>0 ? spend/linkClicks : 0;
  const convRate    = linkClicks>0 ? leads/linkClicks*100 : 0;

  const pvSpend = parseFloat(prev.spend||0);
  const pvLeads = ga(prev.actions,'onsite_conversion.messaging_conversation_started_7d');
  const pvCpl   = pvLeads>0 ? pvSpend/pvLeads : 0;

  // Period label
  const fmt = d => new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  document.getElementById('periodLabel').textContent = fmt(since) + ' – ' + fmt(until);

  // KPIs
  document.getElementById('kSpend').textContent  = fmt$(spend);
  document.getElementById('kLeads').textContent  = leads;
  document.getElementById('kCpl').textContent    = fmt$(cpl);
  document.getElementById('kSpendD').innerHTML   = deltaHtml(spend, pvSpend, prevSince, prevUntil, false, v=>'$'+v.toFixed(2));
  document.getElementById('kLeadsD').innerHTML   = deltaHtml(leads, pvLeads, prevSince, prevUntil, true,  v=>v+' leads');
  document.getElementById('kCplD').innerHTML     = deltaHtml(cpl,   pvCpl,   prevSince, prevUntil, false, v=>'$'+v.toFixed(2));

  // Sidebar metrics
  document.getElementById('mImpressions').textContent = fmtN(impressions);
  document.getElementById('mClicks').textContent      = fmtN(linkClicks);
  document.getElementById('mConvRate').textContent    = convRate.toFixed(2)+'%';

  // Platform donut
  const ig = plat.find(p=>p.publisher_platform==='instagram');
  const fb = plat.find(p=>p.publisher_platform==='facebook');
  const igS = parseFloat(ig?.spend||0), fbS = parseFloat(fb?.spend||0);
  const tot = igS+fbS||1;
  const igP = (igS/tot*100).toFixed(1), fbP = (fbS/tot*100).toFixed(1);
  document.getElementById('igLegend').textContent = 'Instagram '+igP+'%';
  document.getElementById('fbLegend').textContent = 'Facebook '+fbP+'%';
  updateChart('platformChart', c=>{
    c.data.datasets[0].data = [igP, fbP];
    c.update();
  });

  // Daily chart
  const labels       = daily.map(d=>new Date(d.date_start+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric'}));
  const dailySpend   = daily.map(d=>parseFloat(d.spend||0));
  const dailyClicks  = daily.map(d=>ga(d.actions,'link_click'));
  const dailyWA      = daily.map(d=>ga(d.actions,'onsite_conversion.messaging_conversation_started_7d'));

  updateChart('dailyChart', c=>{
    c.data.labels = labels;
    c.data.datasets[0].data = dailySpend;
    c.data.datasets[1].data = dailyClicks;
    c.update();
  });

  // Gauges
  setGauge('gCPM',  cpm,      30,  'gvCPM',  '$'+cpm.toFixed(2));
  setGauge('gCPC',  costPerCTA, 10, 'gvCPC',  '$'+costPerCTA.toFixed(2));
  setGauge('gConv', convRate, 25,  'gvConv', convRate.toFixed(2)+'%');

  // WA chart
  updateChart('waChart', c=>{
    c.data.labels = labels;
    c.data.datasets[0].data = dailyWA;
    c.update();
  });

  // Funnel
  document.getElementById('fReach').textContent  = fmtN(reach);
  document.getElementById('fClicks').textContent = fmtN(linkClicks);
  document.getElementById('fLeads').textContent  = leads;
  document.getElementById('fCpl').textContent    = fmt$(cpl);
  // Funnel bars — log scale garante cascata visual mesmo com ratios muito diferentes
  const _fw = (v, ref) => ref > 0 ? Math.max(Math.min(Math.log(v+1)/Math.log(ref+1)*90, 90), 6) : 6;
  const _cW = Math.min(_fw(linkClicks, reach), 88);
  const _lW = Math.min(_fw(leads, reach), _cW - 6);
  const _dW = Math.max(_lW - 14, 4);
  document.getElementById('fClicksBar').style.width = _cW + '%';
  document.getElementById('fLeadsBar').style.width  = _lW + '%';
  document.getElementById('fCplBar').style.width    = _dW + '%';

  // Ad table
  const adMap = {};
  for (const row of byAd) {
    const name = row.ad_name||'Unknown';
    if (!adMap[name]) adMap[name]={clicks:0,leads:0,spend:0,impressions:0};
    adMap[name].clicks      += parseInt(row.clicks||0);
    adMap[name].leads       += ga(row.actions,'onsite_conversion.messaging_conversation_started_7d');
    adMap[name].spend       += parseFloat(row.spend||0);
    adMap[name].impressions += parseInt(row.impressions||0);
  }
  const rows = Object.entries(adMap).sort((a,b)=>b[1].leads-a[1].leads||b[1].spend-a[1].spend).slice(0,10);
  document.getElementById('adTableBody').innerHTML = rows.map(([name,m])=>{
    const adCpl = m.leads>0 ? '$'+(m.spend/m.leads).toFixed(2) : '–';
    const adCtr = m.impressions>0 ? (m.clicks/m.impressions*100).toFixed(2)+'%' : '–';
    const short = name.length>20 ? name.slice(0,19)+'…' : name;
    return \`<tr><td title="\${name}">\${short}</td><td>\${m.clicks||'–'}</td><td>\${m.leads||'–'}</td><td>\${adCpl}</td><td>\${adCtr}</td></tr>\`;
  }).join('');
  document.getElementById('ftClicks').textContent = fmtN(clicks);
  document.getElementById('ftLeads').textContent  = leads;
  document.getElementById('ftCpl').textContent    = fmt$(cpl);
  document.getElementById('ftCtr').textContent    = ctr.toFixed(2)+'%';
}

// ── CHART HELPERS ──────────────────────────────────────────────────
function updateChart(id, fn) { if (charts[id]) fn(charts[id]); }

function setGauge(id, value, max, labelId, text) {
  const pct = Math.min(value/max, 1);
  const fill = (pct * 220).toFixed(1);
  const gap  = (440 - pct * 220).toFixed(1);
  const arc = document.getElementById(id.replace('g','gArc'));
  if (arc) arc.setAttribute('stroke-dasharray', \`\${fill} \${gap}\`);
  const lbl = document.getElementById(labelId);
  if (lbl) lbl.textContent = text;
}

function initCharts() {
  charts['platformChart'] = new Chart(document.getElementById('platformChart'),{
    type:'doughnut',
    data:{datasets:[{data:[50,50],backgroundColor:['#bb764d','#2a8a92'],borderWidth:0,hoverOffset:4}]},
    options:{cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.toFixed(1)+'%'}}}}
  });

  charts['dailyChart'] = new Chart(document.getElementById('dailyChart'),{
    data:{labels:[],datasets:[
      {type:'bar', label:'Amount Spent ($)',data:[],backgroundColor:'rgba(187,118,77,0.80)',borderRadius:4,yAxisID:'y'},
      {type:'line',label:'Link Clicks',     data:[],borderColor:'#f9f8f3',backgroundColor:'rgba(249,248,243,0.05)',pointBackgroundColor:'#f9f8f3',pointRadius:4,tension:0.3,yAxisID:'y2'}
    ]},
    options:{responsive:true,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:'#6d9ea3',boxWidth:12,font:{size:11}}}},
      scales:{x:{ticks:{color:'#6d9ea3',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},
              y:{ticks:{color:'#6d9ea3',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'},position:'left'},
              y2:{ticks:{color:'#a0bfc2',font:{size:10}},grid:{display:false},position:'right'}}}
  });

  charts['waChart'] = new Chart(document.getElementById('waChart'),{
    type:'line',
    data:{labels:[],datasets:[{label:'Clicked and Sent a Message',data:[],borderColor:'#bb764d',backgroundColor:'rgba(187,118,77,0.15)',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'#bb764d'}]},
    options:{responsive:true,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:'#6d9ea3',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},
              y:{ticks:{color:'#6d9ea3',font:{size:10},stepSize:1},grid:{color:'rgba(255,255,255,0.04)'},min:0}}}
  });
}

// ── APPLY FILTERS ──────────────────────────────────────────────────
async function applyFilters() {
  const since = document.getElementById('dateSince').value;
  const until = document.getElementById('dateUntil').value;
  if (!since || !until || since > until) {
    alert('Invalid date range'); return;
  }
  const btn = document.getElementById('applyBtn');
  const overlay = document.getElementById('overlay');
  btn.disabled = true;
  overlay.classList.add('show');
  try {
    const data = await fetchData(since, until);
    render(data, since, until);
  } catch(e) {
    alert('Error fetching data: ' + e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    overlay.classList.remove('show');
  }
}

// ── INIT ───────────────────────────────────────────────────────────
buildCampMenu();
initCharts();
applyFilters(); // load with default dates on page open
<\/script>
</body>
</html>`;
}

main().catch(e => { console.error('❌', e.response?.data?.error?.message||e.message); process.exit(1); });
