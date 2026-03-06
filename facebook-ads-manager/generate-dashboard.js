/**
 * generate-dashboard.js
 * Fetches live Meta Ads data and generates dashboard/index.html
 * Runs locally or via GitHub Actions (reads token from env var)
 */

import axios from 'axios';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────
const TOKEN      = process.env.META_ACCESS_TOKEN;
const ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '3762537707372777';

if (!TOKEN) {
  console.error('❌  META_ACCESS_TOKEN not set. Exiting.');
  process.exit(1);
}

const client = axios.create({
  baseURL: 'https://graph.facebook.com/v21.0',
  params: { access_token: TOKEN }
});

// ── Date helpers ────────────────────────────────────────────────────
function fmt(d) { return d.toISOString().split('T')[0]; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const today     = new Date();
const until     = addDays(today, -1);        // yesterday
const since     = addDays(until, -6);        // 7-day window
const prevUntil = addDays(since, -1);
const prevSince = addDays(prevUntil, -6);

const SINCE      = fmt(since);
const UNTIL      = fmt(until);
const PREV_SINCE = fmt(prevSince);
const PREV_UNTIL = fmt(prevUntil);

const displayPeriod = `${since.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${until.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;

console.log(`📅  Period : ${SINCE} → ${UNTIL}`);
console.log(`📅  Prev   : ${PREV_SINCE} → ${PREV_UNTIL}`);

// ── API helpers ─────────────────────────────────────────────────────
const getAction = (actions, type) =>
  parseInt((actions || []).find(a => a.action_type === type)?.value || '0');

async function fetch$(params) {
  const r = await client.get(`/act_${ACCOUNT_ID}/insights`, { params });
  return r.data.data || [];
}

// ── Number formatters ───────────────────────────────────────────────
const fmt$ = v => v >= 10000 ? (v/1000).toFixed(1)+'k' : v.toFixed(2);
const fmtN = v => Number(v).toLocaleString('en-US');
const sign = (cur, prev, higherIsBetter) => {
  const diff = cur - prev;
  const up   = diff >= 0;
  return {
    arrow: up ? '▲' : '▼',
    cls  : (up === higherIsBetter) ? 'pos' : 'neg',
    val  : Math.abs(diff)
  };
};

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  try {
    const tr   = JSON.stringify({ since: SINCE,      until: UNTIL      });
    const trPv = JSON.stringify({ since: PREV_SINCE, until: PREV_UNTIL });

    console.log('🔄  Fetching data from Meta API…');
    const [overall, daily, platform, byAd, previous] = await Promise.all([
      fetch$({ fields: 'impressions,reach,clicks,spend,ctr,cpm,cpc,actions', time_range: tr,   level: 'account' }),
      fetch$({ fields: 'impressions,clicks,spend,actions',                   time_range: tr,   time_increment: 1, level: 'account' }),
      fetch$({ fields: 'spend,impressions',                                  time_range: tr,   breakdowns: 'publisher_platform', level: 'account' }),
      fetch$({ fields: 'ad_name,impressions,clicks,spend,ctr,actions',       time_range: tr,   level: 'ad' }),
      fetch$({ fields: 'spend,actions',                                      time_range: trPv, level: 'account' }),
    ]);

    // ── Overall KPIs ──────────────────────────────────────────────
    const ov          = overall[0] || {};
    const spend       = parseFloat(ov.spend       || 0);
    const impressions = parseInt  (ov.impressions  || 0);
    const reach       = parseInt  (ov.reach        || 0);
    const clicks      = parseInt  (ov.clicks       || 0);
    const cpm         = parseFloat(ov.cpm          || 0);
    const cpc         = parseFloat(ov.cpc          || 0);
    const ctr         = parseFloat(ov.ctr          || 0);
    const linkClicks  = getAction(ov.actions, 'link_click');
    const leads       = getAction(ov.actions, 'onsite_conversion.messaging_conversation_started_7d');
    const cpl         = leads > 0 ? spend / leads : 0;
    const convRate    = linkClicks > 0 ? (leads / linkClicks * 100) : 0;

    // ── Previous period ───────────────────────────────────────────
    const pv       = previous[0] || {};
    const pvSpend  = parseFloat(pv.spend || 0);
    const pvLeads  = getAction(pv.actions, 'onsite_conversion.messaging_conversation_started_7d');
    const pvCpl    = pvLeads > 0 ? pvSpend / pvLeads : 0;

    const dSpend = sign(spend, pvSpend, false);
    const dLeads = sign(leads, pvLeads, true);
    const dCpl   = sign(cpl,   pvCpl,   false);

    // ── Daily arrays ─────────────────────────────────────────────
    const dailyLabels = daily.map(d => {
      const dt = new Date(d.date_start + 'T12:00:00Z');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const dailySpend      = daily.map(d => parseFloat(d.spend || 0));
    const dailyLinkClicks = daily.map(d => getAction(d.actions, 'link_click'));
    const dailyWA         = daily.map(d => getAction(d.actions, 'onsite_conversion.messaging_conversation_started_7d'));

    // ── Platform split ────────────────────────────────────────────
    const igRow   = platform.find(p => p.publisher_platform === 'instagram');
    const fbRow   = platform.find(p => p.publisher_platform === 'facebook');
    const igSpend = parseFloat(igRow?.spend || 0);
    const fbSpend = parseFloat(fbRow?.spend || 0);
    const total   = igSpend + fbSpend || 1;
    const igPct   = (igSpend / total * 100).toFixed(1);
    const fbPct   = (fbSpend / total * 100).toFixed(1);

    // ── Aggregate by ad name ──────────────────────────────────────
    const adMap = {};
    for (const row of byAd) {
      const name = row.ad_name || 'Unknown';
      if (!adMap[name]) adMap[name] = { clicks:0, leads:0, spend:0, impressions:0 };
      adMap[name].clicks      += parseInt(row.clicks || 0);
      adMap[name].leads       += getAction(row.actions, 'onsite_conversion.messaging_conversation_started_7d');
      adMap[name].spend       += parseFloat(row.spend || 0);
      adMap[name].impressions += parseInt(row.impressions || 0);
    }

    const adRows = Object.entries(adMap)
      .sort((a, b) => b[1].leads - a[1].leads || b[1].spend - a[1].spend)
      .slice(0, 8)
      .map(([name, m]) => {
        const adCpl = m.leads > 0 ? '$' + (m.spend / m.leads).toFixed(2) : '–';
        const adCtr = m.impressions > 0 ? (m.clicks / m.impressions * 100).toFixed(2) + '%' : '–';
        const short = name.length > 20 ? name.slice(0, 19) + '…' : name;
        return `<tr><td title="${name}">${short}</td><td>${m.clicks||'–'}</td><td>${m.leads||'–'}</td><td>${adCpl}</td><td>${adCtr}</td></tr>`;
      })
      .join('\n          ');

    // Gauge proportions (0–1)
    const gaugeCpm  = Math.min(cpm  / 50,  1).toFixed(4);
    const gaugeCpc  = Math.min(cpc  / 10,  1).toFixed(4);
    const gaugeConv = Math.min(convRate / 25, 1).toFixed(4);

    // Funnel bar widths (visual, not mathematically exact)
    const fwClicks = Math.round(Math.min(clicks / reach * 100 * 3, 95));
    const fwLeads  = Math.round(Math.min(leads  / reach * 100 * 30, 90));
    const fwCpl    = Math.round(Math.min(cpl / 50 * 100, 85));

    const updatedAt = new Date().toLocaleString('en-US', { timeZone:'America/Sao_Paulo', dateStyle:'short', timeStyle:'short' });

    // ── HTML ──────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard – Attorney Isabela | ${displayPeriod}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#151424;color:#e0e0f0;min-height:100vh}
  .header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:#1c1b30;border-bottom:1px solid #2e2d4a;flex-wrap:wrap}
  .logo{width:42px;height:42px;background:linear-gradient(135deg,#b8860b,#d4a017);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:bold;color:#fff;font-style:italic;flex-shrink:0}
  .hinfo .htitle{font-size:14px;font-weight:600;color:#e0e0f0}
  .hinfo .hsub{font-size:11px;color:#7070a0}
  .pill{background:#2a2945;border:1px solid #3d3c5a;color:#b0afd0;padding:7px 14px;border-radius:6px;font-size:13px}
  .kpis{display:flex;gap:12px;margin-left:auto;flex-wrap:wrap}
  .kpi{background:#232240;border-radius:12px;padding:14px 22px;display:flex;align-items:center;gap:14px;min-width:190px}
  .kico{width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0}
  .kico.gold{background:radial-gradient(circle,#f0c040,#b8860b)}
  .kico.blue{background:radial-gradient(circle,#5ab4ff,#1a5faa)}
  .kico.green{background:radial-gradient(circle,#6de88a,#1a7a38)}
  .klabel{font-size:12px;color:#8080a0;text-transform:uppercase;letter-spacing:.5px}
  .kval{font-size:28px;font-weight:700;color:#fff;line-height:1.1}
  .kdelta{font-size:12px;margin-top:2px}
  .pos{color:#4cd97a}.neg{color:#f06060}
  .upd{font-size:10px;color:#555570;margin-left:auto;align-self:flex-end;padding-bottom:2px}
  .main{display:grid;grid-template-columns:160px 1fr 340px;gap:12px;padding:14px 18px}
  .sidebar{display:flex;flex-direction:column;gap:10px}
  .donut-card{background:#1e1d35;border-radius:12px;padding:14px}
  .donut-card canvas{width:100%!important;max-height:100px}
  .dleg{display:flex;flex-direction:column;gap:4px;margin-top:8px;font-size:11px}
  .dleg-item{display:flex;align-items:center;gap:6px}
  .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .mcard{background:#1e1d35;border-radius:12px;padding:12px 14px}
  .mlabel{font-size:11px;color:#7070a0;text-transform:uppercase;letter-spacing:.4px;margin-top:4px}
  .mval{font-size:22px;font-weight:700;color:#fff}
  .mdelta{font-size:11px}
  .center{display:flex;flex-direction:column;gap:12px;min-width:0}
  .cc{background:#1e1d35;border-radius:12px;padding:16px}
  .cc h3{font-size:12px;color:#7070a0;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px}
  .gauges{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .gauge{background:#1e1d35;border-radius:12px;padding:12px 10px;display:flex;flex-direction:column;align-items:center}
  .glabel{font-size:11px;color:#7070a0;text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px}
  .gval{font-size:18px;font-weight:700;color:#fff;margin-top:-10px}
  .grange{display:flex;justify-content:space-between;width:100%;font-size:10px;color:#555570;margin-top:2px;padding:0 4px}
  .gwrap{width:100%;max-height:65px}
  .rp{display:flex;flex-direction:column;gap:12px}
  .funnel{background:#1e1d35;border-radius:12px;padding:16px}
  .ftitle{font-size:11px;color:#7070a0;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px}
  .frow{display:flex;align-items:center;justify-content:space-between}
  .flabel{font-size:13px;color:#a0a0c0;width:60px}
  .fbwrap{flex:1;position:relative;height:30px;margin:2px 8px}
  .fb{position:absolute;left:50%;transform:translateX(-50%);height:100%;border-radius:4px}
  .fval{font-size:16px;font-weight:700;color:#fff;width:80px;text-align:right}
  .fconn{height:6px}
  .tcard{background:#1e1d35;border-radius:12px;padding:14px}
  .tcard h3{font-size:11px;color:#7070a0;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{color:#7070a0;font-weight:500;padding:4px 6px;text-align:right;border-bottom:1px solid #2e2d4a}
  th:first-child{text-align:left}
  td{padding:5px 6px;text-align:right;color:#c0c0d8;border-bottom:1px solid #1a1930}
  td:first-child{text-align:left;color:#e0e0f0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  tfoot tr td{color:#fff;font-weight:700;border-top:1px solid #2e2d4a;border-bottom:none}
  tbody tr:hover td{background:#252445}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="logo">A</div>
  <div class="hinfo">
    <div class="htitle">Attorney Isabela – Ad Performance</div>
    <div class="hsub">${displayPeriod}</div>
  </div>
  <div class="pill">${displayPeriod}</div>
  <div class="kpis">
    <div class="kpi">
      <div class="kico gold">💰</div>
      <div>
        <div class="klabel">Amount Spent</div>
        <div class="kval">$${fmt$(spend)}</div>
        <div class="kdelta ${dSpend.cls}">${dSpend.arrow} $${dSpend.val.toFixed(2)} vs prev</div>
      </div>
    </div>
    <div class="kpi">
      <div class="kico blue">🚀</div>
      <div>
        <div class="klabel">Leads</div>
        <div class="kval">${leads}</div>
        <div class="kdelta ${dLeads.cls}">${dLeads.arrow} ${dLeads.val} vs prev</div>
      </div>
    </div>
    <div class="kpi">
      <div class="kico green">👥</div>
      <div>
        <div class="klabel">Cost per Lead</div>
        <div class="kval">$${cpl.toFixed(2)}</div>
        <div class="kdelta ${dCpl.cls}">${dCpl.arrow} $${dCpl.val.toFixed(2)} vs prev</div>
      </div>
    </div>
  </div>
  <div class="upd">Updated: ${updatedAt} (BRT)</div>
</div>

<!-- MAIN -->
<div class="main">

  <!-- SIDEBAR -->
  <div class="sidebar">
    <div class="donut-card">
      <canvas id="platformChart"></canvas>
      <div class="dleg">
        <div class="dleg-item"><div class="dot" style="background:#f0c040"></div><span style="color:#f0c040">Instagram ${igPct}%</span></div>
        <div class="dleg-item"><div class="dot" style="background:#4a90e2"></div><span style="color:#4a90e2">Facebook ${fbPct}%</span></div>
      </div>
    </div>
    <div class="mcard">
      <div class="mval">${fmtN(impressions)}</div>
      <div class="mlabel">Impressions</div>
    </div>
    <div class="mcard">
      <div class="mval">${fmtN(clicks)}</div>
      <div class="mlabel">Clicks</div>
    </div>
    <div class="mcard">
      <div class="mval">${convRate.toFixed(2)}%</div>
      <div class="mlabel">Conversion Rate</div>
    </div>
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
        <div class="gwrap"><canvas id="gCPM"></canvas></div>
        <div class="gval">$${cpm.toFixed(2)}</div>
        <div class="grange"><span>$0</span><span>$50</span></div>
      </div>
      <div class="gauge">
        <div class="glabel">Invested / Clicks</div>
        <div class="gwrap"><canvas id="gCPC"></canvas></div>
        <div class="gval">$${cpc.toFixed(2)}</div>
        <div class="grange"><span>$0</span><span>$10</span></div>
      </div>
      <div class="gauge">
        <div class="glabel">Leads / Clicks</div>
        <div class="gwrap"><canvas id="gConv"></canvas></div>
        <div class="gval">${convRate.toFixed(2)}%</div>
        <div class="grange"><span>0%</span><span>25%</span></div>
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
      <div class="frow">
        <div class="flabel">Reach</div>
        <div class="fbwrap"><div class="fb" style="width:100%;background:linear-gradient(90deg,#1ecfd6,#10a5aa)"></div></div>
        <div class="fval">${fmtN(reach)}</div>
      </div>
      <div class="fconn"></div>
      <div class="frow">
        <div class="flabel">Clicks</div>
        <div class="fbwrap"><div class="fb" style="width:${fwClicks}%;background:linear-gradient(90deg,#1ecfd6,#10a5aa);opacity:.85"></div></div>
        <div class="fval">${fmtN(clicks)}</div>
      </div>
      <div class="fconn"></div>
      <div class="frow">
        <div class="flabel">Leads</div>
        <div class="fbwrap"><div class="fb" style="width:${fwLeads}%;background:linear-gradient(90deg,#c06020,#a04010)"></div></div>
        <div class="fval">${leads}</div>
      </div>
      <div class="fconn"></div>
      <div class="frow">
        <div class="flabel">CPL</div>
        <div class="fbwrap"><div class="fb" style="width:${fwCpl}%;background:linear-gradient(90deg,#d0c080,#a09040);opacity:.85"></div></div>
        <div class="fval">$${cpl.toFixed(2)}</div>
      </div>
    </div>
    <div class="tcard">
      <h3>Performance by Creative</h3>
      <table>
        <thead><tr><th>Creative</th><th>Clicks</th><th>Leads</th><th>CPL</th><th>CTR</th></tr></thead>
        <tbody>
          ${adRows}
        </tbody>
        <tfoot><tr><td>Grand total</td><td>${fmtN(clicks)}</td><td>${leads}</td><td>$${cpl.toFixed(2)}</td><td>${ctr.toFixed(2)}%</td></tr></tfoot>
      </table>
    </div>
  </div>

</div>

<script>
const labels = ${JSON.stringify(dailyLabels)};

new Chart(document.getElementById('platformChart'),{
  type:'doughnut',
  data:{datasets:[{data:[${igPct},${fbPct}],backgroundColor:['#f0c040','#4a90e2'],borderWidth:0,hoverOffset:4}]},
  options:{cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.toFixed(1)+'%'}}}}
});

new Chart(document.getElementById('dailyChart'),{
  data:{labels,datasets:[
    {type:'bar',  label:'Amount Spent ($)',data:${JSON.stringify(dailySpend)},      backgroundColor:'rgba(74,144,226,0.75)',borderRadius:4,yAxisID:'y'},
    {type:'line', label:'Link Clicks',     data:${JSON.stringify(dailyLinkClicks)}, borderColor:'#fff',backgroundColor:'rgba(255,255,255,0.05)',pointBackgroundColor:'#fff',pointRadius:4,tension:0.3,yAxisID:'y2'}
  ]},
  options:{responsive:true,interaction:{mode:'index',intersect:false},
    plugins:{legend:{labels:{color:'#8080a0',boxWidth:12,font:{size:11}}}},
    scales:{
      x:{ticks:{color:'#7070a0',font:{size:10}},grid:{color:'rgba(255,255,255,0.05)'}},
      y:{ticks:{color:'#7070a0',font:{size:10}},grid:{color:'rgba(255,255,255,0.05)'},position:'left'},
      y2:{ticks:{color:'#a0a0c0',font:{size:10}},grid:{display:false},position:'right'}
    }}
});

function gauge(id,pct,color){
  new Chart(document.getElementById(id),{
    type:'doughnut',
    data:{datasets:[{data:[pct,1-pct],backgroundColor:[color,'#2a2945'],borderWidth:0,circumference:180,rotation:270}]},
    options:{cutout:'72%',plugins:{legend:{display:false},tooltip:{enabled:false}}}
  });
}
gauge('gCPM',  ${gaugeCpm},  '#4caf50');
gauge('gCPC',  ${gaugeCpc},  '#4caf50');
gauge('gConv', ${gaugeConv}, '#4caf50');

new Chart(document.getElementById('waChart'),{
  type:'line',
  data:{labels,datasets:[{label:'Clicked and Sent a Message',data:${JSON.stringify(dailyWA)},borderColor:'#f0c040',backgroundColor:'rgba(240,192,64,0.15)',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'#f0c040'}]},
  options:{responsive:true,plugins:{legend:{display:false}},
    scales:{
      x:{ticks:{color:'#7070a0',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},
      y:{ticks:{color:'#7070a0',font:{size:10},stepSize:1},grid:{color:'rgba(255,255,255,0.04)'},min:0}
    }}
});
<\/script>
</body>
</html>`;

    // ── Write output ───────────────────────────────────────────────
    const outDir = path.join(__dirname, 'dashboard');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    // Prevent GitHub Pages from running Jekyll
    writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');

    console.log(`✅  Dashboard written → dashboard/index.html`);
    console.log(`    Spend: $${spend.toFixed(2)} | Leads: ${leads} | CPL: $${cpl.toFixed(2)} | Period: ${displayPeriod}`);

  } catch (e) {
    console.error('❌  Error:', e.response?.data?.error?.message || e.message);
    if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
    process.exit(1);
  }
}

main();
