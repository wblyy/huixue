/* ===== 回血 · 原型逻辑（无持久化，刷新即重置） ===== */

const $ = s => document.querySelector(s);
const money = n => '¥' + n.toLocaleString('zh-CN');
const total = a => a.reduce((s, x) => s + x.v, 0);

const OPP = [
  { id: 'insurance', cat: '省钱', label: '保险', name: '重复投保的住院医疗', src: '支付宝 · 两份医疗险', v: 480,
    desc: '同一份住院医疗你买了两份，第二份 14 个月零理赔。退掉重复的那份不影响保障。', action: '退掉重复保单', risk: '低', auto: true },
  { id: 'renew', cat: '省钱', label: '订阅', name: '忘了取消的自动续费', src: '4 个订阅服务', v: 312,
    desc: '云盘 / 修图 / 两个视频会员，最近 90 天合计打开 3 次。关掉不影响已购内容。', action: '全部关掉续费', risk: '低', auto: true },
  { id: 'coupon', cat: '省钱', label: '券', name: '快过期的人生优惠券', src: '外卖 · 打车 · 商超', v: 126,
    desc: '11 张券 3 天内到期，其中 7 张是你常点的店，系统已按今天的行程排好使用顺序。', action: '今天下单自动抵扣', risk: '低', auto: true },
  { id: 'deposit', cat: '赚钱', label: '押金', name: '躺在平台里的押金余额', src: '共享单车 · 充电宝 · 洗衣', v: 86,
    desc: '3 个平台的押金可原路退回，平均到账 2 小时。', action: '申请原路退回', risk: '低', auto: true },
  { id: 'cashback', cat: '赚钱', label: '返现', name: '没领的信用卡返现', src: '招商银行 · 掌上生活', v: 214,
    desc: '本月刷卡已满 8 笔，达标返现券还没领，月底清零。', action: '一键领取', risk: '低', auto: true },
  { id: 'points', cat: '赚钱', label: '积分', name: '年底清零的里程积分', src: '航司 · 商超会员', v: 300,
    desc: '4,200 里程 12 月 31 日清零，够换 2 张电影票或 1 张短途机票抵扣。', action: '兑换成电影票', risk: '中', auto: false }
];

// Agent 执行步骤（原型用的伪脚本）
const SCRIPT = {
  insurance: ['登录 支付宝 → 保险服务', '读取 2 份住院医疗保单', '比对保障范围与免赔额', '提交重复保单退订', '保存电子回执'],
  renew: ['登录 微信支付 → 自动续费', '拉取 4 项订阅', '按最近 90 天使用率排序', '逐项关闭自动续费', '记录下次到期日'],
  coupon: ['读取券包 11 张', '过滤 3 天内到期', '匹配你今天的外卖 / 打车行程', '下单时自动勾选抵扣', '同步订单号'],
  deposit: ['登录 3 个共享平台', '定位可退押金', '校验无未结订单', '发起原路退回', '等待平台回执'],
  cashback: ['登录 掌上生活', '核对本月 8 笔刷卡', '领取达标返现券', '选择到账账户', '确认入账'],
  points: ['登录 航司会员中心', '读取 4,200 里程', '计算兑换价值最高的标的', '提交兑换订单', '等待出票']
};

const state = {
  variant: new URLSearchParams(location.search).get('variant') || 'D',
  tab: 'home',
  scanned: false,
  deck: [],
  executed: {},
  scanCount: 0,
  sheet: null
};

const VARIANTS = { A: '仪表盘', B: '清单票据', C: '卡片流', D: '红包狂撒' };

/* ---------- 小工具 ---------- */
const reduce = () => state.deck.filter(o => state.executed[o.id]);
const reducedSum = () => total(reduce());
const potential = () => total(state.deck.length ? state.deck : OPP);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 1900);
}

/* 刮刮乐箔面：SVG 闪光 */
const SPARK = `
<svg class="spark" width="240" height="120" viewBox="0 0 240 120" aria-hidden="true">
  <defs>
    <radialGradient id="sg"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <g fill="url(#sg)">
    <circle cx="34" cy="30" r="3"><animate attributeName="opacity" values="0;1;0" dur="2.6s" begin="0s" repeatCount="indefinite"/></circle>
    <circle cx="198" cy="22" r="2.4"><animate attributeName="opacity" values="0;1;0" dur="2.2s" begin=".4s" repeatCount="indefinite"/></circle>
    <circle cx="120" cy="12" r="2"><animate attributeName="opacity" values="0;1;0" dur="3.1s" begin=".9s" repeatCount="indefinite"/></circle>
    <circle cx="222" cy="82" r="2.6"><animate attributeName="opacity" values="0;1;0" dur="2.8s" begin="1.3s" repeatCount="indefinite"/></circle>
    <circle cx="18" cy="88" r="2.2"><animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="1.7s" repeatCount="indefinite"/></circle>
    <circle cx="168" cy="54" r="1.6"><animate attributeName="opacity" values="0;1;0" dur="2s" begin=".7s" repeatCount="indefinite"/></circle>
  </g>
</svg>`;

/* ---------- 变体 A：仪表盘 ---------- */
function A(t) {
  if (t === 'records') return ARecords();
  if (t === 'me') return AMe();
  const p = state.scanned ? Math.min(total(state.deck) / 2000, 0.92) : 0.06;
  const R = 94, C = 2 * Math.PI * R;
  const shown = state.scanned ? (reducedSum() || total(state.deck)) : 0;
  return `
  <div class="nav">
    <div class="brand"><span class="dot"></span>回血</div>
    <div class="streak">连续 ${state.scanCount + 6} 天</div>
  </div>

  <div class="hero">
    <div class="gauge">
      <svg viewBox="0 0 224 224">
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4BFFC0"/><stop offset="1" stop-color="#0A9E70"/>
          </linearGradient>
        </defs>
        <circle cx="112" cy="112" r="${R}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="13"/>
        <circle cx="112" cy="112" r="${R}" fill="none" stroke="url(#ag)" stroke-width="13" stroke-linecap="round"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - p)).toFixed(1)}"
          style="transition:stroke-dashoffset 1.2s cubic-bezier(.2,.9,.25,1);filter:drop-shadow(0 0 12px rgba(61,245,176,.5))"/>
        ${state.scanned ? '' : `<circle cx="112" cy="112" r="${R}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1.5" stroke-dasharray="2 8" stroke-linecap="round"/>`}
      </svg>
      <div class="gauge-center">
        <div class="lab">${state.scanned ? '今日可回血' : '待扫描'}</div>
        <div class="num">${state.scanned ? money(shown).replace('¥', '') : '???'}<small>${state.scanned ? '元' : ''}</small></div>
        <div class="sub">${state.scanned ? `全网 ${22 + state.scanCount * 4} 个入口已体检` : '点击下方开始今日体检'}</div>
      </div>
    </div>
  </div>

  <button class="cta ${state.scanned ? 'done' : ''}" data-act="scan">
    ${state.scanned ? '再扫一次 · 今日已省 ' + money(reducedSum()) : '开始今日扫描'}
  </button>

  <div class="stats">
    <div class="stat"><b>${state.scanned ? total(state.deck) : '—'}</b><span>发现机会 / 元</span></div>
    <div class="stat"><b>${reduce().length}/${state.deck.length || 6}</b><span>已执行</span></div>
    <div class="stat"><b>+23%</b><span>较上月</span></div>
  </div>

  <div class="h-sec"><h3>今日机会</h3><span>${state.scanned ? state.deck.length + ' 条 · 按收益排序' : '扫描后显示'}</span></div>

  ${state.scanned ? state.deck.map(o => `
    <div class="opp" data-detail="${o.id}">
      <div class="icc">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${o.cat === '赚钱' ? '#FFC466' : '#3DF5B0'}" stroke-width="2" stroke-linecap="round">
          ${o.cat === '赚钱' ? '<path d="M12 19V5M5 12l7-7 7 7"/>' : '<path d="M12 5v14M5 12l7 7 7-7"/>'}
        </svg>
      </div>
      <div class="grow">
        <h4>${o.name}</h4>
        <div class="meta"><span>${o.src}</span></div>
      </div>
      <div style="text-align:right">
        <div class="amt ${o.cat === '赚钱' ? 'earn' : ''}">${state.executed[o.id] ? '已回血' : money(o.v)}</div>
        <div class="go" data-exec="${o.id}" style="margin-top:6px">${state.executed[o.id] ? '已完成' : o.action}</div>
      </div>
    </div>`).join('') : `
    <div class="opp" style="opacity:.5">
      <div class="icc">?</div>
      <div class="grow"><h4>保险 · 订阅 · 券 · 押金 · 返现</h4>
      <div class="meta"><span>5 类入口，扫描后按金额排序</span></div></div>
      <div class="amt muted">待揭晓</div>
    </div>
    <div class="opp" style="opacity:.35">
      <div class="icc">?</div>
      <div class="grow"><h4>闲置 · 积分 · 比价 · 退款</h4>
      <div class="meta"><span>每天更新，只显示今天能做的</span></div></div>
      <div class="amt muted">待揭晓</div>
    </div>`}
  `;
}

function ARecords() {
  const rows = reduce();
  return `
  <div class="nav"><div class="brand"><span class="dot"></span>回血</div><div class="streak">本月</div></div>
  <div class="h-sec" style="margin-top:10px"><h3>已回血</h3><span>${rows.length} 笔</span></div>
  <div class="gauge-center" style="position:static;align-items:flex-start;margin:6px 0 20px">
    <div class="num" style="font-size:44px">${money(reducedSum()).replace('¥','')}<small>元</small></div>
    <div class="sub" style="margin-top:6px">相当于这个月的话费 + 电费</div>
  </div>
  ${rows.length ? rows.map(o => `
    <div class="opp"><div class="icc">✓</div>
      <div class="grow"><h4>${o.name}</h4><div class="meta"><span>${o.src} · 已到账</span></div></div>
      <div class="amt">+${money(o.v)}</div></div>`).join('')
  : `<div class="opp" style="justify-content:center;opacity:.5;padding:26px">还没有执行记录，先扫一次</div>`}
  `;
}

function AMe() {
  return `
  <div class="nav"><div class="brand"><span class="dot"></span>回血</div></div>
  <div class="h-sec" style="margin-top:8px"><h3>我的资产体检</h3></div>
  ${[['已连接账户', '7 个'], ['可执行权限', '自动执行 · 需确认'], ['每日扫描', '09:00'], ['数据来源', '账单 / 订阅 / 券包 / 保险']]
    .map(([k, v]) => `<div class="kv"><span class="muted">${k}</span><b>${v}</b></div>`).join('')}
  <div class="h-sec"><h3>扫描历史</h3></div>
  ${[['11 月 17 日', '¥218'], ['11 月 16 日', '¥96'], ['11 月 15 日', '¥340']].map(([d, v]) =>
    `<div class="kv"><span class="muted">${d}</span><b class="mono">${v}</b></div>`).join('')}
  `;
}

/* ---------- 变体 B：清单票据 ---------- */
function B(t) {
  if (t === 'records') return BRecords();
  if (t === 'me') return BMe();
  const sum = state.scanned ? (reducedSum() || total(state.deck)) : 0;
  return `
  <div class="nav">
    <div class="brand">回<em>血</em><span style="font-size:10px;letter-spacing:3px;font-weight:700;opacity:.5;margin-left:6px">HUÍXUÈ</span></div>
    <div class="dateline">11.18 周三<br>第 ${state.scanCount + 6} 次体检</div>
  </div>

  <div class="balance">
    <div class="big">
      <sup>¥</sup>${state.scanned ? sum.toLocaleString('zh-CN') : '<span class="foilbar">1,284</span>'}
      <span class="cur">可回血</span>
    </div>
    <div class="delta">${state.scanned ? '+' + reducedSum() : '待扫描'}</div>
  </div>
  <div class="scanline"><i></i></div>
  <div class="tiny muted" style="letter-spacing:.4px">${state.scanned ? '6 项体检 · 5 项建议执行 · 预计 3 分钟内完成' : '今天还没体检 · 上一次是 23 小时前'}</div>

  <div class="checklist">
    ${state.scanned ? state.deck.map(o => `
      <div class="ck ${state.executed[o.id] ? 'done' : ''}" data-detail="${o.id}">
        <div class="box"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
        <div class="grow"><div class="name">${o.name}<small>${o.src}</small></div></div>
        <div class="v ${state.executed[o.id] ? 'off' : ''}">${o.cat === '赚钱' ? '+' : ''}${money(o.v)}</div>
      </div>`).join('') : OPP.slice(0, 6).map(o => `
      <div class="ck" style="opacity:.5">
        <div class="box"></div>
        <div class="grow"><div class="name"><span class="foilbar" style="width:${70 + (o.v % 40)}px">${o.name}</span><small>扫描后揭晓</small></div></div>
        <div class="v">¥ ???</div>
      </div>`).join('')}
  </div>

  <div class="ticket">
    <div class="stamp">${state.scanned ? 'SETTLED' : 'PENDING'}</div>
    <div class="tlab">今日已回血 / TODAY</div>
    <div class="tnum">${money(reducedSum())}</div>
    <div class="tiny" style="opacity:.55;margin-top:4px">${reduce().length} / ${state.deck.length || 6} 项已执行 · 平均每项 ${reduce().length ? Math.round(reducedSum() / reduce().length) : 0} 元</div>
    <div class="tfoot">
      <button class="btn-ghost" data-act="scan" style="border-color:#E5451D;color:#E5451D">${state.scanned ? '重新扫描' : '开始扫描'}</button>
      <button class="btn-ghost" data-act="scan" style="border-color:rgba(246,241,231,.4);opacity:.7">看诊断报告</button>
    </div>
  </div>

  <button class="btn-ink" data-act="scan">${state.scanned ? '执行全部 ' + state.deck.length + ' 项 · 回血 ' + money(total(state.deck)) : '刮开今天的体检单'}</button>
  `;
}

function BRecords() {
  return `
  <div class="nav"><div class="brand">回<em>血</em></div><div class="dateline">本月台账</div></div>
  <div class="balance"><div class="big"><sup>¥</sup>${reducedSum().toLocaleString('zh-CN')}<span class="cur">已到账</span></div></div>
  <div class="scanline"><i></i></div>
  ${reduce().length ? reduce().map(o => `<div class="ck done"><div class="box"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4"><path d="M20 6 9 17l-5-5"/></svg></div>
    <div class="grow"><div class="name">${o.name}<small>${o.src}</small></div></div><div class="v">+${money(o.v)}</div></div>`).join('')
  : `<div class="tiny" style="opacity:.5;padding:24px 0">暂无记录</div>`}
  `;
}
function BMe() {
  return `
  <div class="nav"><div class="brand">回<em>血</em></div><div class="dateline">设置</div></div>
  ${[['已连接账户', '7 个'], ['自动化级别', '低风险自动执行'], ['每日体检', '09:00 · 已开启'], ['报告发送', '微信服务号']]
    .map(([k, v]) => `<div class="ck"><div class="grow"><div class="name" style="font-weight:700">${k}</div></div><div class="v" style="font-size:12px;font-weight:700">${v}</div></div>`).join('')}
  `;
}

/* ---------- 变体 C：卡片流 ---------- */
function C(t) {
  if (t === 'records') return CRecords();
  if (t === 'me') return CMe();
  return `
  <div class="nav">
    <div>
      <div class="brand">回血</div>
      <div class="daytag">DAY ${state.scanCount + 6} · 11/18</div>
    </div>
    <div class="ava">H</div>
  </div>

  <div class="deck">
    <div class="sum">
      <div class="n">${state.scanned ? money(reducedSum() || total(state.deck)).replace('¥', '') : '???'}</div>
      <div class="u">${state.scanned ? '元<br>今日可回血' : '元<br>等待扫描'}</div>
    </div>

    <div class="chiprow">
      <div class="chip on">全部 ${state.deck.length || 6}</div>
      <div class="chip">省钱</div>
      <div class="chip">赚钱</div>
      <div class="chip">${reduce().length} 已完成</div>
    </div>

    ${state.scanned ? state.deck.map((o, i) => `
      <div class="card ${i === 0 ? 'p' : i === 1 ? 'l' : ''} ${state.executed[o.id] ? 'done' : ''}" data-detail="${o.id}">
        <div class="ctop">
          <span class="tag">${o.cat}</span>
          <span class="src">${o.src}</span>
        </div>
        <div class="amt-big">${o.cat === '赚钱' ? '+' : ''}${money(o.v).replace('¥', '')}<small>元</small></div>
        <h4>${o.name}</h4>
        <div class="fine">${o.desc}</div>
        <div class="exec">
          <button class="main" data-exec="${o.id}">${state.executed[o.id] ? '已执行' : o.action}</button>
          <button class="alt">细则</button>
        </div>
      </div>`).join('') : `
      ${[0, 1, 2].map(i => `
      <div class="card" style="background:linear-gradient(150deg,#1A1B22,#101116);border-style:dashed">
        <div class="ctop"><span class="tag">待揭晓</span><span class="src">入口 ${i + 1}/3</span></div>
        <div class="amt-big foilbar" style="width:120px">¥ ???</div>
        <h4><span class="foilbar" style="width:${150 + i * 30}px;display:inline-block">扫描后揭晓</span></h4>
        <div class="fine">${['保险 / 订阅 / 券包', '押金 / 返现 / 积分', '退款 / 比价 / 闲置'][i]}</div>
        <div class="exec"><button class="main" data-act="scan" style="width:100%">开始扫描</button></div>
      </div>`).join('')}`}
  </div>
  `;
}
function CRecords() {
  return `
  <div class="nav"><div><div class="brand">回血</div><div class="daytag">记录</div></div><div class="ava">H</div></div>
  <div class="sum" style="margin-top:20px"><div class="n">${reducedSum()}</div><div class="u">元<br>本月已回血</div></div>
  ${reduce().length ? reduce().map(o => `<div class="card"><div class="ctop"><span class="tag">已到账</span><span class="src">${o.src}</span></div><h4>${o.name}</h4><div class="fine">+${money(o.v)}</div></div>`).join('') : `<div class="card"><div class="fine" style="font-size:13px">还没有记录。回首页扫一次。</div></div>`}
  `;
}
function CMe() {
  return `
  <div class="nav"><div><div class="brand">回血</div><div class="daytag">我的</div></div><div class="ava">H</div></div>
  <div class="card" style="margin-top:22px">
    <div class="ctop"><span class="tag">账户</span><span class="src">7 个已连接</span></div>
    <h4>授权越精确，机会越具体</h4>
    <div class="fine">当前：账单 + 订阅 + 券包 + 保险。未接入：抵押 / 理财 / 二手平台。</div>
    <div class="exec"><button class="main">管理授权</button><button class="alt">全部</button></div>
  </div>
  ${[['自动执行', '仅低风险'], ['每日扫描', '09:00'], ['本周回血', money(reducedSum())]]
    .map(([k, v]) => `<div class="card"><div class="ctop"><span class="src" style="opacity:.8;font-size:13px">${k}</span><span class="grow"></span><span class="tag">${v}</span></div></div>`).join('')}
  `;
}

/* ---------- 变体 D：拼多多式 ---------- */
const COINS = ['¥0.3 已到账', '刚有人提现了 ¥18', '好友 阿May 省了 ¥64', '第 3 单红包已发放', '今日已发 1,204,881 个红包', '用 回血 省出一杯奶茶', '刚刚 老陈 回血 ¥112'];
let dTimer = null;

function coinRain() {
  let s = '';
  for (let i = 0; i < 16; i++) {
    const l = (Math.random() * 100).toFixed(1);
    const dur = (2.6 + Math.random() * 3.4).toFixed(2);
    const delay = (-Math.random() * 6).toFixed(2);
    const dx = (Math.random() * 40 - 20).toFixed(0);
    const sz = (8 + Math.random() * 6).toFixed(0);
    s += `<span style="left:${l}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:${delay}s;--dx:${dx}px"></span>`;
  }
  return s;
}

function D(t) {
  if (t === 'records') return DRecords();
  if (t === 'me') return DMe();
  const sum = state.scanned ? total(state.deck) : 1284;
  const got = reducedSum();
  const pctv = state.scanned ? Math.min(97, Math.round((got / sum) * 100)) : 12;
  return `
  <div class="D">
    <div class="rain">${coinRain()}</div>

    <div class="dhead">
      <div class="logo">回血<i>HUÍXUÈ</i></div>
      <div class="topcoins">
        <svg width="13" height="13" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#FFD34D" stroke="#B87A00" stroke-width="2"/><path d="M12 7v10M9 10h5a1.6 1.6 0 0 1 0 3H9" stroke="#8A5600" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
        ${state.scanned ? Math.round(got) : 0} 血值
      </div>
    </div>

    <div class="purse">
      <div class="purse-in">
        <div class="plabel">Agent 今天能替你拿回 · 全网体检</div>
        <div class="pamount">
          <span class="cny">¥</span>
          <span class="n ${state.scanned ? '' : 'foilv'}">${state.scanned ? sum.toLocaleString('zh-CN') : '1,284'}</span>
          <span class="u">元</span>
        </div>
        <div class="prow">
          <span class="btag">${state.scanned ? state.deck.length + ' 个红包' : '神秘红包'}</span>
          <span class="pnote">${state.scanned ? '全部由 Agent 自动执行，你只点一次' : '今天还没开工，Agent 已就绪'}</span>
        </div>

        <div class="progwrap">
          <div class="progtrack"><div class="progfill" style="width:${pctv}%"></div></div>
          <div class="progtxt"><span>已回血 <b>¥${got}</b></span><span>Agent 预计还能拿 <b>¥${Math.max(sum - got, 0)}</b></span></div>
        </div>
      </div>
    </div>

    <div class="clock">
      距今日红包失效
      <span class="digits" id="dclock"><span class="dg">04</span>:<span class="dg">27</span>:<span class="dg">13</span></span>
      后清零
    </div>

    <button class="mega ${state.scanned ? 'done' : ''}" data-act="scan">
      ${state.scanned ? '让 Agent 再跑一轮' : '让 Agent 去帮我领'}
      <small>${state.scanned ? '已回血 ' + money(got) + ' · 还有漏网的' : '它自己登录、自己点、自己填，你只看结果'}</small>
    </button>

    <div class="marquee">
      <div class="mtrack">
        ${[...COINS, ...COINS].map(c => `<span class="mi">${c.replace(/(¥[\d.]+)/, '<b>$1</b>')}</span>`).join('')}
      </div>
    </div>

    <div class="dlsec"><h3>限时红包 · 今日有效</h3><span class="fire">HOT</span></div>

    ${state.scanned ? state.deck.map((o, i) => `
      <div class="lot ${state.executed[o.id] ? 'done' : ''}" data-detail="${o.id}">
        <div class="lb">${o.cat === '赚钱' ? '赚' : '省'}</div>
        <div class="grow">
          <div class="lt">${o.name}</div>
          <div class="ls"><span class="dotrun"></span>Agent 可代办 · ${o.src}</div>
        </div>
        <div class="la">
          <div class="v">¥${o.v}<small>元</small></div>
          <span class="btn" data-exec="${o.id}">${state.executed[o.id] ? '已领' : (o.auto ? 'Agent 代办' : '待确认')}</span>
        </div>
      </div>`).join('') : `
      ${OPP.slice(0, 3).map((o, i) => `
      <div class="lot blind" data-detail="${o.id}">
        <div class="lb">?</div>
        <div class="grow">
          <div class="lt">Agent 待启动的任务 ${i + 1}</div>
          <div class="ls">${['保险 / 订阅 / 券包', '押金 / 返现 / 积分', '退款 / 比价 / 闲置'][i]} · 启动后才知金额</div>
        </div>
        <div class="la">
          <div class="v">¥???</div>
          <span class="btn" data-act="scan">启动</span>
        </div>
      </div>`).join('')}`}

    <div class="tally">
      <span class="tk">今日战绩</span>
      <span class="tc">${reduce().length} 单已领</span>
      <span class="tv">+¥${got}</span>
    </div>
  </div>`;
}

function DRecords() {
  return `
  <div class="D" style="padding-bottom:20px">
    <div class="dhead"><div class="logo">回血<i>台账</i></div></div>
    <div class="purse"><div class="purse-in">
      <div class="plabel">累计已回血</div>
      <div class="pamount"><span class="cny">¥</span><span class="n">${reducedSum()}</span><span class="u">元</span></div>
      <div class="prow"><span class="btag">可提现</span><span class="pnote">满 ¥1 即可原路提现</span></div>
    </div></div>
    <div class="dlsec"><h3>红包明细</h3></div>
    ${reduce().length ? reduce().map(o => `
      <div class="lot done"><div class="lb">✓</div>
        <div class="grow"><div class="lt">${o.name}</div><div class="ls">${o.src} · 已到账</div></div>
        <div class="la"><div class="v">+¥${o.v}</div></div></div>`).join('')
    : `<div class="lot"><div class="lb">!</div><div class="grow"><div class="lt">还没有领取记录</div><div class="ls">回首页刮开今日红包</div></div></div>`}
  </div>`;
}

function DMe() {
  return `
  <div class="D" style="padding-bottom:20px">
    <div class="dhead"><div class="logo">回血<i>我的</i></div></div>
    <div class="purse"><div class="purse-in">
      <div class="plabel">我的血值</div>
      <div class="pamount"><span class="cny">¥</span><span class="n">${reducedSum()}</span><span class="u">元</span></div>
      <div class="progwrap">
        <div class="progtrack"><div class="progfill" style="width:${Math.min(100, reducedSum() / 12)}%"></div></div>
        <div class="progtxt"><span>距离下一档 ¥100 还差 <b>¥${Math.max(0, 100 - reducedSum())}</b></span></div>
      </div>
    </div></div>
    <div class="dlsec"><h3>授权与设置</h3></div>
    ${[['已连接账户', '7 个'], ['每日自动扫描', '09:00 已开启'], ['低风险自动执行', '开启'], ['提现方式', '原路 / 微信']]
      .map(([k, v]) => `<div class="lot"><div class="lb">⚙</div><div class="grow"><div class="lt">${k}</div></div><div class="la"><div class="v" style="font-size:11px;color:#8A4A20">${v}</div></div></div>`).join('')}
  </div>`;
}

function startDClock() {
  clearInterval(dTimer);
  const el = document.getElementById('dclock');
  if (!el) return;
  let sec = 4 * 3600 + 27 * 60 + 13;
  const pad = n => String(n).padStart(2, '0');
  dTimer = setInterval(() => {
    const e = document.getElementById('dclock');
    if (!e || !document.body.dataset.variant || document.body.dataset.variant !== 'D') { clearInterval(dTimer); return; }
    sec = sec > 0 ? sec - 1 : 6 * 3600;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    e.innerHTML = `<span class="dg">${pad(h)}</span>:<span class="dg">${pad(m)}</span>:<span class="dg">${pad(s)}</span>`;
  }, 1000);
}

/* ---------- 渲染外壳 ---------- */
function render() {
  document.body.dataset.variant = state.variant;
  const fn = { A, B, C, D }[state.variant];
  const scr = $('#screen');
  scr.className = 'screen';
  scr.innerHTML = `<div class="vp ${state.variant}">${fn(state.tab)}</div>`;
  scr.scrollTop = 0;
  if (state.variant === 'D') startDClock();

  const tabs = [['home', '首页', 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z'],
    ['records', '记录', 'M4 4h16v16H4zM8 9h8M8 13h5'],
    ['me', '我的', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3.6-6 8-6s8 2 8 6']];
  $('#tabbar').innerHTML = tabs.map(([k, label, d]) =>
    `<button class="${state.tab === k ? 'on' : ''}" data-tab="${k}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>${label}</button>`).join('');
  $('#tabbar').style.visibility = state.sheet ? 'hidden' : 'visible';
  renderBar();
}

function renderBar() {
  $('#pbKey').textContent = state.variant;
  $('#pbName').textContent = VARIANTS[state.variant];
}

/* ---------- 扫描（加载 / 刮刮乐） ---------- */
const PHASES = ['读取账单流水', '比对订阅与续费', '检查券包有效期', '扫描押金与返现', '匹配二手与比价', '汇总今天的动作'];

function startScan() {
  state.scanCount++;
  // 打乱一批机会（每次扫描顺序变化）
  const arr = OPP.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  state.deck = arr.slice(0, 4);
  state.executed = {};

  const ov = $('#overlay');
  ov.classList.add('show');
  ov.innerHTML = `
    <div class="scan">
      <div class="halo">
        <div class="ring"></div><div class="ring"></div><div class="ring"></div>
        <div class="core">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="${state.variant === 'B' ? '#F6F1E7' : '#04251B'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
            <path d="M3 12h18" opacity=".85"><animate attributeName="opacity" values=".2;1;.2" dur="1.6s" repeatCount="indefinite"/></path>
          </svg>
        </div>
      </div>
      <div class="pct">0<small>%</small></div>
      <div class="phase">正在唤醒 Agent</div>
      <div class="log"></div>
      <div class="skip" data-skip>跳过动画 ›</div>
    </div>`;

  const pct = ov.querySelector('.pct'), phase = ov.querySelector('.phase'), log = ov.querySelector('.log');
  let step = 0;
  const steps = [
    [8, '读取账单流水', '· 已读取 1,284 条交易'],
    [26, '比对订阅与续费', '· 发现 4 个沉默订阅'],
    [48, '检查券包有效期', '· 11 张券 3 天内到期'],
    [70, '扫描押金与返现', '· 3 笔押金可退'],
    [88, '匹配二手与比价', '· 命中 2 个高价值机会'],
    [100, '汇总今天的动作', '· 扫描完成，Agent 准备动手']
  ];
  const timer = setInterval(() => {
    if (step >= steps.length) { clearInterval(timer); setTimeout(runAgent, 420); return; }
    const [p, ph, lg] = steps[step];
    pct.innerHTML = p + '<small>%</small>';
    phase.textContent = ph;
    if (lg) {
      const d = document.createElement('div');
      d.textContent = lg;
      log.appendChild(d);
      if (log.children.length > 4) log.firstChild.remove();
    }
    step++;
  }, 520);

  ov.querySelector('[data-skip]').onclick = () => { clearInterval(timer); runAgent(); };
}

function runAgent() {
  const ov = $('#overlay');
  ov.innerHTML = `
    <div class="agent">
      <div class="ahead">
        <div class="alab">AGENT 执行中 · 需要你 0 次操作</div>
        <div class="atitle"><b id="agGot">¥0</b><span>已回血 / 共 <i id="agTotal">${money(total(state.deck))}</i></span></div>
        <div class="abar"><i id="agBar"></i></div>
        <div class="astats"><span>已完成 <b id="agDone">0</b>/${state.deck.length}</span><span>节省你的时间 <b id="agMin">0 分钟</b></span></div>
      </div>
      <div class="alist" id="agList"></div>
      <div class="afoot">
        <button id="agAll" disabled>Agent 正在跑 · 自动帮你确认</button>
        <div class="note">低风险任务由 Agent 自动完成 · 涉及资金变更会找你一次</div>
      </div>
    </div>`;

  const tasks = state.deck.map(o => ({ o, steps: SCRIPT[o.id] || ['处理中'], si: 0, status: 'queued' }));
  let cur = 0, got = 0, doneN = 0;

  const list = ov.querySelector('#agList');
  const draw = () => {
    list.innerHTML = tasks.map((t, i) => {
      const icon = t.status === 'ok' ? '✓' : t.status === 'run' ? '<span class="aspin"></span>' : t.status === 'wait' ? '!' : (i + 1);
      const cls = t.status === 'ok' ? 'ok' : t.status === 'run' ? 'run' : t.status === 'wait' ? 'wait' : '';
      const amt = t.status === 'ok' ? `<div class="tv">+${money(t.o.v)}</div>`
        : t.status === 'wait' ? `<button class="tv" style="background:none;color:#FFC466;font-size:11px;font-weight:900" data-confirm="${i}">点一下确认 ›</button>`
        : `<div class="tv pend">${money(t.o.v)}</div>`;
      return `<div class="task ${cls}">
        <div class="ic">${icon}</div>
        <div class="grow">
          <div class="tt">${t.o.name}</div>
          <div class="tp">${t.status === 'ok' ? '已完成 · ' + t.steps[t.steps.length - 1] : t.steps[Math.min(t.si, t.steps.length - 1)]}</div>
        </div>
        ${amt}
      </div>`;
    }).join('');
    ov.querySelector('#agGot').textContent = money(got);
    ov.querySelector('#agDone').textContent = doneN;
    ov.querySelector('#agMin').textContent = doneN * 4 + ' 分钟';
    ov.querySelector('#agBar').style.width = ((got / Math.max(total(state.deck), 1)) * 100).toFixed(1) + '%';
  };
  draw();

  const finishTask = t => {
    t.status = 'ok';
    t.si = t.steps.length;
    state.executed[t.o.id] = true;
    got += t.o.v; doneN++;
    draw();
  };

  const step = () => {
    const t = tasks[cur];
    if (!t) { endAgent(); return; }
    if (!t.status || t.status === 'queued') t.status = 'run';
    if (!t.o.auto && t.si === t.steps.length - 1 && !t.asked) {
      // 需要用户确认一次
      t.asked = true;
      t.status = 'wait';
      draw();
      setTimeout(() => {
        const b = ov.querySelector('[data-confirm="' + cur + '"]');
        if (b) b.onclick = () => { t.status = 'run'; t.si = t.steps.length; draw(); setTimeout(() => { finishTask(t); cur++; setTimeout(step, 340); }, 700); };
      }, 60);
      return;
    }
    t.si++;
    if (t.si >= t.steps.length) {
      finishTask(t);
      cur++;
      setTimeout(step, 380);
    } else {
      draw();
      setTimeout(step, 620);
    }
  };

  setTimeout(step, 520);

  function endAgent() {
    const b = ov.querySelector('#agAll');
    b.disabled = false;
    b.textContent = `回血完成 · ${money(got)} 已入账`;
    b.onclick = () => { state.scanned = true; closeOverlay(); render(); toast(`Agent 已完成 ${doneN} 项 · 回血 ${money(got)}`); };
    state.scanned = true;
  }
}

function finishScan() {
  state.scanned = true;
  closeOverlay();
  render();
}

/* ---------- 执行 ---------- */
function execAll() {
  state.deck.forEach(o => { state.executed[o.id] = true; });
  finishScan();
  toast(`已执行 ${state.deck.length} 项 · 回血 ${money(total(state.deck))}`);
}
function execOne(id) {
  const o = OPP.find(x => x.id === id);
  if (!o) return;
  if (state.executed[id]) { toast('这项已经执行过了'); return; }
  state.executed[id] = true;
  state.scanned = true;
  closeOverlay();
  render();
  toast(`已回血 ${money(o.v)} · ${o.action}完成`);
}

/* ---------- 详情 / 确认 ---------- */
function openDetail(id) {
  const o = OPP.find(x => x.id === id);
  if (!o) return;
  const done = !!state.executed[id];
  const ov = $('#overlay');
  ov.classList.add('show');
  ov.innerHTML = `
    <div class="scrim" data-close></div>
    <div class="sheet">
      <div class="grab"></div>
      <div class="row" style="gap:8px">
        <span class="pill" style="background:rgba(61,245,176,.12);color:${o.cat === '赚钱' ? '#FFC466' : '#3DF5B0'}">${o.cat} · 风险${o.risk}</span>
        <span class="grow"></span>
        <b style="font-size:22px;font-weight:900">${money(o.v)}</b>
      </div>
      <h2 style="margin-top:12px">${o.name}</h2>
      <div class="sub">${o.desc}</div>
      <div style="margin-top:16px">
        <div class="kv"><span class="muted">来源</span><b>${o.src}</b></div>
        <div class="kv"><span class="muted">执行方式</span><b>${o.auto ? '确认后自动完成' : '需要你二次确认'}</b></div>
        <div class="kv"><span class="muted">预计耗时</span><b>${o.auto ? '约 20 秒' : '约 2 分钟'}</b></div>
        <div class="kv"><span class="muted">可撤回</span><b>${o.auto ? '7 天内可恢复' : '—'}</b></div>
      </div>
      <button class="big-act" data-exec="${o.id}">${done ? '已完成回血' : o.action}</button>
      <button class="cancel" data-close>稍后处理</button>
    </div>`;
  $('#tabbar').style.visibility = 'hidden';
}

function closeOverlay() {
  const ov = $('#overlay');
  ov.classList.remove('show');
  ov.innerHTML = '';
  $('#tabbar').style.visibility = 'visible';
  state.sheet = null;
}

/* ---------- 事件 ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab],[data-exec],[data-detail],[data-close],[data-skip]');
  if (!t) return;

  if (t.dataset.close !== undefined) { closeOverlay(); return; }
  if (t.dataset.tab) { state.tab = t.dataset.tab; closeOverlay(); render(); return; }
  if (t.dataset.detail) { openDetail(t.dataset.detail); return; }
  if (t.dataset.exec) { e.stopPropagation(); execOne(t.dataset.exec); return; }

  const act = t.dataset.act;
  if (act === 'scan') {
    closeOverlay();
    startScan();
  } else if (act === 'execAll') {
    execAll();
  } else if (act === 'closeReveal') {
    finishScan();
  }
});

/* ---------- 变体切换 ---------- */
function setVariant(k) {
  state.variant = k;
  history.replaceState(null, '', '?variant=' + k);
  closeOverlay();
  render();
}
document.querySelectorAll('#protoBar .pb-arrow').forEach(b => {
  b.onclick = () => {
    const keys = Object.keys(VARIANTS);
    const i = keys.indexOf(state.variant);
    setVariant(keys[(i + Number(b.dataset.dir) + keys.length) % keys.length]);
  };
});
$('#pbReset').onclick = () => {
  state.sheet = null; state.tab = 'home'; state.scanned = false; state.executed = {}; state.deck = []; state.scanCount = 0;
  closeOverlay(); render(); toast('演示已重置');
};

document.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
  const keys = Object.keys(VARIANTS);
  const i = keys.indexOf(state.variant);
  if (e.key === 'ArrowLeft') { e.preventDefault(); setVariant(keys[(i - 1 + keys.length) % keys.length]); }
  if (e.key === 'ArrowRight') { e.preventDefault(); setVariant(keys[(i + 1) % keys.length]); }
});

/* ---------- 启动 ---------- */
setVariant(state.variant);

/* 自适应屏幕高度缩放（仅原型外壳） */
function fit() {
  const h = window.innerHeight - 100, w = window.innerWidth - 40;
  const s = Math.min(1, h / 844, w / 390);
  $('#phone').style.transform = `scale(${s.toFixed(3)})`;
  $('#phone').style.margin = s < 1 ? `${-(844 * (1 - s)) / 2}px 0` : '0';
}
window.addEventListener('resize', fit);
fit();
