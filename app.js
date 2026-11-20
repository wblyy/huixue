/* ===== 回血 · 省钱 =====
   一进来只有一个按钮。按下去：先只读地翻一遍，然后自己动手办。
   办到一半需要本人的（验证码 / 扫脸 / 接电话 / 点头），挂起，推一条到微信服务号，
   主界面同时把它挪到「需要你接手」。你回一句话，它接着办。

   状态机（每件事）：
     queue → run → [wait] → settle → done
                    └ wait：gate 不是 auto 时，跑到第 3 步挂起，等你在微信回
     skip：你在微信里选了「不办」 */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const f2 = n => Number((Math.round(n * 100) / 100).toFixed(2))
  .toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yen = n => '¥' + f2(n);
const pad = n => String(n).padStart(2, '0');
const hhmmss = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const groupName = id => GROUPS.find(g => g.id === id)?.name || '';
const acctName = id => id === 'save' ? '不再扣钱' : (ACCOUNTS.find(a => a.id === id)?.name || '—');

const SWEEP = [
  ['中国移动', '登录 · 积分 2,156', 'cmcc'],
  ['中国联通', '登录 · 积分 840', 'cucc'],
  ['中国电信', '登录 · 积分 520', 'ctcc'],
  ['支付宝', '登录 · 会员积分 410', 'alipay'],
  ['微信支付', '登录 · 金币 1,240', 'wechat'],
  ['京东', '登录 · 金豆 860', 'jd'],
  ['美团', '登录 · 积分 620', 'meituan'],
  ['饿了么', '登录 · 吃货豆 1,860', 'eleme'],
  ['招商银行', '登录 · 积分 2,260', 'cmb'],
  ['国航凤凰知音', '登录 · 里程 2,400', 'airmile']
];
const foundOf = id => OPP.find(o => o.id === id);

const STEP_MS = 4000;
const RUN_MS = STEP_MS * 5;          // 一件 20 秒
const SCAN_MS = 620;                 // 每个平台
const LANES = 3;
const SPEEDS = [1, 2, 4];

/* ---------- 账户 ---------- */
const accts = ACCOUNTS.map(a => ({ ...a, base: a.v, added: 0 }));
const acctOf = id => accts.find(a => a.id === id);
const totalAssets = () => accts.reduce((s, a) => s + a.v, 0);
const totalAdded = () => accts.reduce((s, a) => s + a.added, 0);

const state = {
  tab: 'save',
  phase: 'idle',        // idle | scanning | running | done
  speed: 1,
  found: [],
  tasks: [],
  scanIdx: 0,
  savedSum: 0,
  wxPending: null,
  wxLog: []
};

/* 大数字滚动 */
const roll = { cur: 0, target: 0, tm: 0 };
function rollTo(v, el) {
  roll.target = v;
  const out = el || $('#dNum');
  if (roll.tm) return;
  const step = () => {
    const d = roll.target - roll.cur;
    if (Math.abs(d) < 0.01) { roll.cur = roll.target; roll.tm = 0; }
    else { roll.cur += d * 0.2; roll.tm = setTimeout(step, 16); }
    out.textContent = f2(roll.cur);
  };
  roll.tm = setTimeout(step, 16);
}

/* 环形进度 */
const R = 104, LEN = 2 * Math.PI * R;
function setRing(pct) {
  const el = $('#dFill');
  el.style.strokeDasharray = LEN.toFixed(2);
  el.style.strokeDashoffset = (LEN * (1 - Math.max(0, Math.min(1, pct)))).toFixed(2);
}

/* ---------- 行动前的平台预览 ---------- */
const PREVIEW = [
  ['中国移动', '2,156 分', '年底清零', 'cmcc', true],
  ['中国联通', '840 分', '不清零', 'cucc', false],
  ['中国电信', '520 分', '要验证码', 'ctcc', true],
  ['支付宝', '410 分', '一年过期', 'alipay', true],
  ['微信支付', '1,240 金币', '每年清零', 'wechat', true],
  ['京东', '860 金豆', '年底清零', 'jd', true],
  ['美团', '620 分', '季度过期', 'meituan', true],
  ['饿了么', '1,860 豆', '月底清零', 'eleme', true],
  ['招商银行', '2,260 分', '会贬值', 'cmb', false],
  ['国航知音', '2,400 里程', '年底过期', 'airmile', true]
];
function renderPreview() {
  $('#pvGrid').innerHTML = PREVIEW.map(([n, amt, tag, id, exp]) => {
    const t = state.tasks.find(x => x.o.id === id);
    let cls = exp ? 'pv exp' : 'pv';
    let numCls = 'pv-num', numTxt = amt;
    if (t) {
      if (t.phase === 'done') { cls += ' done'; numCls += ' ok'; numTxt = `+${f2(t.o.v)}`; }
      else if (t.phase !== 'queue' && t.phase !== 'skip') { numCls += ' on'; numTxt = '在换'; }
      else if (t.phase === 'skip') { numTxt = '跳过'; }
    }
    return `<div class="${cls}">
      <div class="pv-n">${n}</div>
      <div class="pv-t">${tag}</div>
      <div class="${numCls}">${numTxt}</div>
    </div>`;
  }).join('');
}

/* ================= 扫描 ================= */
function startScan() {
  state.phase = 'scanning';
  state.found = []; state.tasks = []; state.scanIdx = 0; state.savedSum = 0;
  state.wxPending = null; state.wxLog = [];
  accts.forEach(a => { a.v = a.base; a.added = 0; });
  roll.cur = 0; roll.target = 0; clearTimeout(roll.tm); roll.tm = 0;

  $('#listsec').hidden = true;
  $('#handoff').hidden = true;
  $('#rows').innerHTML = '';
  $('#hoList').innerHTML = '';
  $('#ticker').hidden = true;
  $('#dUnit').textContent = '正在翻';
  $('#dNum').className = 'd-num sm';
  $('#dNum').textContent = `0 / ${SWEEP.length}`;
  setRing(0);
  $('#dial').className = 'dial busy';
  $('#stPhase').textContent = '正在查';
  $('#stPhase').className = 'sl-st live';
  $('#kicker').textContent = '只读，一个积分都还没动';
  $('#h1').innerHTML = '正在数各家<br>还有多少分。';
  $('#h1sub').textContent = '一家一家登录，看积分余额和过期时间。这一步不改任何东西。';
  setBtn(true, '正在查…', '只看不改');
  $('#ctaNote').textContent = `${state.found.length || 0} 处已翻完`;

  let i = 0;
  const step = () => {
    const [, desc] = SWEEP[i];
    state.scanIdx = i + 1;
    $('#dNum').textContent = `${i + 1} / ${SWEEP.length}`;
    setRing((i + 1) / SWEEP.length);
    $('#h1sub').textContent = `${SWEEP[i][0]}：${desc}`;
    $('#ctaNote').textContent = `${i + 1} / ${SWEEP.length} 处已翻完`;
    if (i + 1 < SWEEP.length) { i++; setTimeout(step, SCAN_MS); }
    else setTimeout(finishScan, 520);
  };
  setTimeout(step, 240);
}

function finishScan() {
  state.found = SWEEP.map(([, , id]) => foundOf(id)).filter(Boolean);
  const total = state.found.reduce((s, o) => s + o.v, 0);
  const need = state.found.filter(o => o.gate !== 'auto').length;
  const keep = state.found.reduce((s, o) => s + (o.dest === 'save' ? 0 : o.v), 0);

  $('#dial').className = 'dial';
  $('#dUnit').textContent = '家可换';
  $('#dNum').className = 'd-num sm';
  $('#dNum').textContent = String(state.found.length);
  setRing(1);
  $('#stPhase').textContent = '查完了';
  $('#stPhase').className = 'sl-st';
  $('#kicker').textContent = '数完了，下面开始换';
  $('#h1').innerHTML = `${state.found.length} 家平台，<br>一共 ${yen(total)}。`;
  $('#h1sub').textContent = `换成话费、提现额度、还款金和券。其中 ${need} 家要验证码或会员密码，我会发到微信，你回一句就行。`;
  $('#ctaNote').textContent = `${yen(keep)} 会落到你的余额，另有 ${yen(total - keep)} 是往后不再扣的。`;

  renderRows();
  $('#listsec').hidden = false;
  syncMini();

  setTimeout(startRun, 900);
}

/* ================= 执行 ================= */
function startRun() {
  state.phase = 'running';
  const t0 = performance.now();
  const dur = () => RUN_MS / state.speed;

  state.tasks = state.found.map(o => ({
    o, phase: 'queue', p: 0, log: '', startAt: 0, resumeAt: 0,
    doneAt: null, settleAt: 0, arrivedAt: null, answered: false,
    said: null, handed: false, skip: false
  }));

  $('#ticker').hidden = false;
  $('#stPhase').textContent = '正在办';
  $('#stPhase').className = 'sl-st live';
  $('#h1').innerHTML = '正在一家一家换，<br>你可以去忙别的。';
  $('#h1sub').textContent = '要验证码的会挂到最上面，也会发一条到微信服务号。';
  setBtn(true, '正在办…', '一件一件来');
  renderRows();

  const tick = () => {
    const now = performance.now();
    let live = 0, waiting = 0, done = 0;

    /* 三条道空出来就补一件：不预先排班，省得改速后算错。
       挂在等人身上的不算占道——它在等你，不该堵住别人。 */
    let busy = state.tasks.filter(t => t.phase === 'run').length;
    if (busy < LANES) {
      for (const t of state.tasks) {
        if (busy >= LANES) break;
        if (t.phase === 'queue') { t.phase = 'run'; t.resumeAt = now; busy++; }
      }
    }

    state.tasks.forEach(t => {
      if (t.phase === 'done' || t.phase === 'skip') { done++; return; }

      if (t.phase === 'run') {
        const el = (now - t.resumeAt) / dur();
        const cap = (t.o.gate !== 'auto' && !t.answered) ? 0.6 : 1;
        t.p = Math.min(1, el);

        if (t.p >= cap) {
          if (cap < 1) {
            // 跑到第 3 步，挂起等人
            t.p = 0.6; t.phase = 'wait';
            openHandoff(t);
          } else if (t.p >= 1) {
            t.phase = 'settle';
            t.doneAt = new Date();
            t.settleAt = now + (t.o.arrive || 0) * 1000 / state.speed;
          }
        }
        updateLog(t);
        if (t.phase === 'run') live++;
        if (t.phase === 'wait') waiting++;
        return;
      }

      if (t.phase === 'wait') { waiting++; return; }

      if (t.phase === 'settle') {
        if (now >= t.settleAt) {
          t.phase = 'done'; t.arrivedAt = new Date();
          settle(t);
        } else { live++; }
      }
    });

    paintRows();
    sortRows();
    renderTicker();
    syncMini();
    renderPreview();
    syncDial(done);

    if (done === state.tasks.length) { finishRun(); return; }
    setTimeout(tick, 150);
  };
  setTimeout(tick, 80);
}

function updateLog(t) {
  const idx = Math.min(4, Math.floor(t.p * 5));
  const [name, subs] = t.o.steps[idx];
  const sub = Math.min(subs.length - 1, Math.floor((t.p * 5 - idx) * subs.length));
  t.log = `${idx + 1}/5 ${name} · ${subs[sub]}`;
}

/* 挂起：发微信 + 主界面列出 */
function openHandoff(t) {
  if (t.handed) return;
  t.handed = true;
  const h = t.o.hand;
  pushWx({
    from: 'agent',
    title: '需要你回一句',
    text: h.msg
  });
  t.wxMsgAt = hhmmss(new Date());
  renderHandoff();
  toast(`有一件要你确认 · ${h.title}`);
  if (!state.wxPending) state.wxPending = t;
}

/* 你在微信里回复 */
function answer(t, opt) {
  t.answered = true;
  t.said = opt.label;
  pushWx({ from: 'me', text: opt.label });
  const out = opt.value;

  if (out === 'skip') {
    t.skip = true;
    pushWx({ from: 'agent', text: opt.reply || '好，这件我不动了。' });
    paintRows(); renderHandoff(); syncMini(); renderTicker();
    // 不占用调度：直接记跳过
    t.phase = 'skip';
    const rest = state.tasks.filter(x => x.phase !== 'done' && x.phase !== 'skip').length;
    if (!rest) finishRun();
    return;
  }

  pushWx({ from: 'agent', text: opt.reply || '收到，接着办。' });
  t.phase = 'run';
  // 从 60% 处继续
  t.resumeAt = performance.now() - (RUN_MS / state.speed) * 0.6;
  if (t.p < 0.6) { t.p = 0.6; }
  paintRows(); renderHandoff(); syncMini(); renderTicker();

  const next = state.tasks.find(x => x.phase === 'wait');
  state.wxPending = next || null;
  if (next) setTimeout(() => renderWxInput(), 420);
  else setTimeout(closeWx, 700);
}

/* 到账 */
function settle(t) {
  const o = t.o;
  if (o.dest === 'save') {
    state.savedSum += o.v;
  } else {
    const a = acctOf(o.dest);
    if (a) { a.v = Math.round((a.v + o.v) * 100) / 100; a.added = Math.round((a.added + o.v) * 100) / 100; }
  }
  rollTo(arrivedSum());
  $('#stTotal').textContent = yen(totalAssets());
  const row = document.querySelector(`[data-row="${o.id}"]`);
  if (row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
  if (state.wxPending === t) state.wxPending = null;
}

const arrivedSum = () => state.tasks
  .filter(t => t.arrivedAt && t.o.dest !== 'save')
  .reduce((s, t) => s + t.o.v, 0);

function finishRun() {
  if (state.phase === 'done') return;
  state.phase = 'done';
  const sum = arrivedSum();
  const skipped = state.tasks.filter(t => t.skip);
  const coupon = state.tasks.filter(t => t.arrivedAt && t.o.dest === 'wallet')
    .reduce((s, t) => s + t.o.v, 0);
  const doneN = state.tasks.filter(t => t.phase === 'done').length;

  paintRows();
  $('#ticker').hidden = true;
  $('#dial').className = 'dial done';
  setRing(1);
  $('#dNum').className = 'd-num';
  clearTimeout(roll.tm); roll.tm = 0;
  roll.cur = sum; roll.target = sum;
  $('#dNum').textContent = f2(sum);
  $('#dUnit').textContent = '已经换到';

  $('#stPhase').textContent = '这一轮办完了';
  $('#stPhase').className = 'sl-st';
  $('#kicker').textContent = `第 ${new Date().getMonth() + 1} 月 ${new Date().getDate()} 日 · 已办妥`;
  $('#h1').innerHTML = `${yen(sum)} 换出来了，<br>已经到账。`;
  const parts = [`${doneN} 家换完，话费、余额、还款金都到位了`];
  if (coupon > 0) parts.push(`另有 ${yen(coupon)} 是券，下单的时候才抵`);
  if (skipped.length) parts.push(`${skipped.length} 家你跳过了，下次再问`);
  $('#h1sub').textContent = parts.join('。') + '。';

  setBtn(false, '再换一轮', '明天九点自己再看一遍');
  $('#ctaNote').textContent = `这一轮共 ${state.tasks.length} 家，${state.tasks.filter(t => !t.skip).length} 家换完。明天早上九点我会再看一眼谁又快清零。`;
  syncMini();
  renderHandoff();
  toast(`办完了 · 到账 ${yen(sum)}`);
}

/* ================= 渲染 ================= */
function renderRows() {
  $('#rows').innerHTML = state.found.map((o, i) => `
    <div class="row queue" data-row="${o.id}" style="animation-delay:${i * 55}ms">
      <span class="row-stick"></span>
      <div class="row-main">
        <div class="row-top">
          <span class="row-name">${o.name}</span>
          <span class="row-cat">${groupName(o.group)}</span>
        </div>
        <div class="row-why">${o.why}</div>
        <div class="row-log" data-log></div>
      </div>
      <div class="row-right">
        <span class="row-amt">+${f2(o.v)}</span>
        <span class="row-dest">${o.dest === 'save' ? '不再扣钱' : acctName(o.dest)}</span>
        <span class="row-st" data-st>排队</span>
      </div>
    </div>`).join('');
  $('#lhTitle').innerHTML = `查到 <b>${state.found.length}</b> 家，一共 <b>${f2(state.found.reduce((s, o) => s + o.v, 0))}</b> 元`;
  $('#lhMeta').textContent = `合计 ${yen(state.found.reduce((s, o) => s + o.v, 0))}`;
  paintRows();
}

function paintRows() {
  state.tasks.forEach(t => {
    const el = document.querySelector(`[data-row="${t.o.id}"]`);
    if (!el) return;
    let cls = 'queue', st = '排队';

    switch (t.phase) {
      case 'run': cls = 'run'; st = `办到 ${Math.min(5, Math.floor(t.p * 5) + 1)}/5`; break;
      case 'wait': cls = 'waits'; st = '等你回一句'; break;
      case 'settle': cls = 'settle'; st = `入账中 · ${Math.max(0, Math.ceil((t.settleAt - performance.now()) / 1000))} 秒`; break;
      case 'done': cls = 'done'; st = t.o.dest === 'save' ? `已退订 · ${hhmm(t.arrivedAt)}` : `已到账 · ${hhmm(t.arrivedAt)}`; break;
      case 'skip': cls = 'skip'; st = '这次不办'; break;
    }
    el.className = 'row ' + cls + (t.phase === 'wait' ? ' pinned' : '');
    const stEl = el.querySelector('[data-st]');
    if (stEl) stEl.textContent = st;
    const lg = el.querySelector('[data-log]');
    if (lg) lg.textContent = t.phase === 'run' ? t.log
      : t.phase === 'wait' ? `已停在第 3 步 · 微信里回一句就继续`
        : t.phase === 'settle' ? `已办完，等平台把钱退回来`
          : '';
  });
}

/* 待回 → 在办 → 入账中 → 排队 → 已办/跳过：卡住的永远在最上面 */
const RANK = { wait: 0, run: 1, settle: 2, queue: 3, done: 4, skip: 5 };
function sortRows() {
  const box = $('#rows');
  const want = state.tasks.slice().sort((a, b) => (RANK[a.phase] - RANK[b.phase]) || 0);
  const cur = [...box.children];
  let same = true;
  for (let i = 0; i < want.length; i++) {
    if (cur[i] !== box.querySelector(`[data-row="${want[i].o.id}"]`)) { same = false; break; }
  }
  if (same) return;
  want.forEach(t => {
    const el = box.querySelector(`[data-row="${t.o.id}"]`);
    if (el) box.appendChild(el);
  });
}

function renderHandoff() {
  const list = state.tasks.filter(t => t.handed && !t.arrivedAt);
  const el = $('#handoff');
  if (!list.length) { el.hidden = true; return; }
  el.hidden = false;
  $('#hoCount').textContent = String(list.filter(t => t.phase === 'wait').length);
  $('#hoList').innerHTML = list.map(t => {
    const answered = t.answered && !t.skip;
    const skipped = t.skip;
    const state1 = skipped ? '已跳过' : answered ? '已回复' : '等你';
    return `<div class="ho ${answered ? 'answered' : ''}" data-ho="${t.o.id}">
      <div>
        <div class="ho-t">${t.o.hand.title}</div>
        <div class="ho-n">${t.o.hand.need}${t.said ? ` · <b>你回了「${t.said}」</b>` : ''}</div>
      </div>
      <button class="ho-act" data-ho-btn="${t.o.id}" type="button" ${answered || skipped ? 'disabled' : ''}>
        ${skipped ? '已跳过' : answered ? '已收到' : '在微信里回'}
      </button>
    </div>`;
  }).join('');
}

function renderTicker() {
  const bits = [];
  state.tasks.forEach(t => {
    if (t.phase === 'run') bits.push(`<em>${t.o.name}</em> <b>${t.p < 1 ? Math.min(5, Math.floor(t.p * 5) + 1) + '/5' : '完成'}</b>`);
    else if (t.phase === 'wait') bits.push(`<em>${t.o.name}</em> <b class="warn">等你回</b>`);
    else if (t.phase === 'settle') bits.push(`<em>${t.o.name}</em> <b>入账中</b>`);
    else if (t.phase === 'done') bits.push(`<em>${t.o.name}</em> <b class="ok">+${f2(t.o.v)}</b>`);
  });
  const line = bits.length ? bits.join(' · ') : '正在准备';
  $('#tkTrack').innerHTML = `<span>${line}</span><span>${line}</span>`;
}

function syncMini() {
  const done = state.tasks.filter(t => t.phase === 'done').length;
  const need = state.tasks.filter(t => t.phase === 'wait').length;
  const money = yen(arrivedSum());
  $('#smFound').textContent = state.found.length || '—';
  $('#smDone').textContent = done;
  $('#smNeed').textContent = need;
  $('#smMoney').textContent = money;
  $('#ssFound').textContent = state.found.length ? `${state.found.length} 处` : '—';
  $('#ssDone').textContent = done;
  $('#ssNeed').textContent = need;
  $('#ssMoney').textContent = money;
  const skipped = state.tasks.filter(t => t.phase === 'skip').length;
  $('#ssFoot').textContent =
    state.phase === 'idle' ? '还没开始查'
      : state.phase === 'running' ? (need ? '有的事只能你本人做' : `${state.tasks.length} 件在办`)
        : `办完 ${done} 件${skipped ? `，跳过 ${skipped} 件` : ''}`;
}

function syncDial(doneN) {
  if (state.phase !== 'running') return;
  const n = state.tasks.length || 1;
  setRing(doneN / n);
  $('#dUnit').textContent = '已经换到';
  const el = $('#dNum');
  el.className = 'd-num';
  rollTo(arrivedSum(), el);
  const need = state.tasks.filter(t => t.phase === 'wait').length;
  if (need) {
    $('#stPhase').textContent = '在办，等你确认';
    $('#stTip').textContent = `${need} 家卡在验证码上，看上面的「需要你接手」`;
  } else {
    $('#stPhase').textContent = '正在办';
    $('#stPhase').className = 'sl-st live';
    $('#stTip').textContent = `${state.tasks.filter(t => t.phase === 'run').length} 家在换`;
  }
}

/* ================= 微信服务号 ================= */
/* 每家要你配合的话术，按 id 写，因为验证码和核身信息各不一样 */
const HAND_OPTS = {
  ctcc: [
    { label: '7394', value: 'go', reply: '验证码已填，电信受理了。5.2 元话费 1 分钟内到账。' },
    { label: '不换', value: 'skip', reply: '好，电信这 520 分先留着。' }
  ],
  cmb: [
    { label: '5082', value: 'go', reply: '验证码已填，11.3 元还款金已入账，下个账单日自动冲抵。' },
    { label: '不换', value: 'skip', reply: '好，招行积分先不动。' }
  ],
  airmile: [
    { label: '我的会员密码', value: 'go', reply: '收到，核身通过了。2,400 里程已扣，20 元话费 24 小时内到账。' },
    { label: '算了', value: 'skip', reply: '好，国航里程留着。12 月 31 日之前还能再换。' }
  ]
};
const optsFor = t => HAND_OPTS[t.o.id] || [
  { label: '可以', value: 'go', reply: '收到，接着办。' },
  { label: '不用了', value: 'skip', reply: '好，这家跳过。' }
];

function pushWx(m) {
  state.wxLog.push(m);
  const box = $('#wxChat');
  const t = m.time || hhmmss(new Date());
  if (m.from === 'agent') {
    box.insertAdjacentHTML('beforeend', `<div class="wx-msg">
      <div class="wx-avatar">回</div>
      <div class="wx-bub"><span class="wx-t">回血 · ${t}</span>${m.text}</div></div>`);
  } else {
    box.insertAdjacentHTML('beforeend', `<div class="wx-msg me">
      <div class="wx-avatar">我</div>
      <div class="wx-bub">${m.text}</div></div>`);
  }
  box.scrollTop = box.scrollHeight;
}

function renderWxInput() {
  const t = state.tasks.find(x => x.phase === 'wait' && !x.answered);
  const wrap = $('#wxOpts');
  if (!t) {
    $('#wxPh').textContent = '暂时没有要你回的了';
    wrap.innerHTML = '';
    return;
  }
  $('#wxPh').textContent = `关于：${t.o.hand.title}（演示：点一下即视为你在微信里回复）`;
  wrap.innerHTML = optsFor(t).map(o =>
    `<button class="wx-opt" data-wxopt="${o.label}" data-wxid="${t.o.id}" type="button">${o.label}</button>`
  ).join('');
}

function openWx(id) {
  $('#wx').hidden = false;
  const box = $('#wxChat');
  if (!box.children.length) {
    pushWx({
      from: 'agent', time: hhmmss(new Date()),
      text: '你好，我是回血。要你本人做的事很少，一般回一句话就行。办完了我会在这儿告诉你。'
    });
  }
  const t = id ? state.tasks.find(x => x.o.id === id) : null;
  if (t && t.phase === 'wait' && !t.answered) {
    // 已有消息就不再重复推送
  } else if (!state.tasks.some(x => x.phase === 'wait')) {
    $('#wxPh').textContent = '暂时没有要你回的了';
    $('#wxOpts').innerHTML = '';
    return;
  }
  renderWxInput();
}

function closeWx() { $('#wx').hidden = true; }

$('#wxChat').addEventListener('click', () => {});
$('#wxOpts').addEventListener('click', e => {
  const b = e.target.closest('[data-wxopt]');
  if (!b) return;
  const t = state.tasks.find(x => x.o.id === b.dataset.wxid && x.phase === 'wait');
  if (!t) return;
  const opt = optsFor(t).find(o => o.label === b.dataset.wxopt);
  if (!opt) return;
  answer(t, opt);
});
$$('[data-wx-close]').forEach(el => el.addEventListener('click', closeWx));

/* 主界面的「在微信里回」 */
$('#hoList').addEventListener('click', e => {
  const b = e.target.closest('[data-ho-btn]');
  if (!b || b.disabled) return;
  openWx(b.dataset.hoBtn);
});

/* ================= 按钮 / 视图 ================= */
function setBtn(disabled, main, sub) {
  const b = $('#bigBtn');
  b.disabled = disabled;
  b.classList.toggle('busy', disabled);
  $('#bgMain').textContent = main;
  $('#bgSub').textContent = sub;
}

const TABS = ['job', 'save', 'earn'];
function setTab(t) {
  state.tab = t;
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  TABS.forEach(k => { $('#pane' + k[0].toUpperCase() + k.slice(1)).hidden = k !== t; });
  $('#pane').scrollTop = 0;
  $('#tbLive').hidden = !(t !== 'save' && state.phase === 'running');
  if (state.phase === 'running') $('#tbLive').textContent = '省钱 · 正在办';
}

$('#bigBtn').addEventListener('click', () => {
  if (state.phase === 'idle' || state.phase === 'done') startScan();
});

$$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

$('#speed').addEventListener('click', () => {
  const prev = state.speed;
  const next = SPEEDS[(SPEEDS.indexOf(prev) + 1) % SPEEDS.length];
  state.speed = next;
  $('#speedVal').textContent = next + '×';
  if (state.phase === 'running') {
    const now = performance.now();
    const ratio = prev / next;
    state.tasks.forEach(t => {
      if (t.phase === 'queue') t.startAt = now + (t.startAt - now) * ratio;
      if (t.phase === 'settle') t.settleAt = now + (t.settleAt - now) * ratio;
    });
  }
  toast(next === 1 ? '演示 1× · 真实节奏一件约 20 秒' : `演示 ${next}× · 只影响演示`);
});

/* ================= 启动 ================= */
$('#stTotal').textContent = yen(totalAssets());
setRing(0);
renderPreview();

/* ================= toast ================= */
let toastTm;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => el.classList.remove('show'), 2600);
}
