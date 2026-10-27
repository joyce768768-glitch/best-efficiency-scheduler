/* 面板逻辑：日期归档 + 需求清单渲染 + 倒计时 + 交互 */
const $ = (s) => document.querySelector(s);
let state = null;      // 当前查看的日期计划
let dates = [];        // 日期列表
let viewDate = null;   // null = 今天

// ---------- 工具 ----------
function pad(n) { return String(n).padStart(2, '0'); }
function hm(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
function toMin(hmStr) { const [h, m] = hmStr.split(':').map(Number); return h * 60 + m; }
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function fmtClock(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function dateLabel(ds) {
  if (!ds) return '';
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = todayStr();
  if (ds === today) return `今天 · ${m}/${d}`;
  const yesterday = todayStr(new Date(Date.now() - 86400000));
  if (ds === yesterday) return `昨天 · ${m}/${d}`;
  return `${m}/${d} 周${WEEK[dt.getDay()]}`;
}

function hm2(min) { return min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? (min % 60) + 'm' : ''}` : min + 'm'; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function atTime(hmStr) { const [h, m] = hmStr.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; }

const STATUS_TXT = { todo: '待开始', doing: '进行中', confirm: '待确认', done: '已完成' };

// 轻提示（3.5s 自动消失）
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// ---------- 数据 ----------
async function loadDates() {
  try {
    dates = (await (await fetch('/api/dates')).json()).dates;
    renderDates();
  } catch (e) { console.warn(e); }
}

async function refresh() {
  try {
    state = await (await fetch(viewDate ? `/api/plan/${viewDate}` : '/api/state')).json();
    render();
  } catch (e) { console.warn('fetch failed', e); }
}

function switchDate(ds) {
  viewDate = ds === todayStr() ? null : ds;
  refresh();
}

// ---------- 渲染 ----------
function renderDates() {
  $('#dateRail').innerHTML = dates.map(d => `
    <button class="dateItem ${(d.current && !viewDate) || viewDate === d.date ? 'active' : ''} ${d.current ? 'cur' : ''}" onclick="switchDate('${d.date}')">
      <span class="dLabel">${dateLabel(d.date)}</span>
      <span class="dMeta">${d.done}/${d.total} 完成</span>
    </button>`).join('');
}

function render() {
  const today = todayStr();
  const mode = !viewDate ? 'today' : (viewDate === today ? 'today' : (viewDate > today ? 'future' : 'past'));
  const d = new Date();
  $('#dateLine').textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEK[d.getDay()]}`;
  $('#clock').textContent = fmtClock(d);

  const s = state.stats;
  $('#stats').innerHTML = mode === 'today' && s ? `
    <span class="stat">计划 <b>${s.total}</b> 项</span>
    <span class="stat">已完成 <b>${s.done}</b></span>
    ${s.earlyDone ? `<span class="stat early">提前完成 <b>${s.earlyDone}</b></span>` : ''}
    ${s.confirm ? `<span class="stat" style="border-color:var(--warn);color:var(--warn)">待确认 <b>${s.confirm}</b></span>` : ''}
  ` : '';

  const lanBtn = $('#lanBtn');
  if (state.lan) {
    lanBtn.classList.remove('hidden');
    lanBtn.onclick = async () => {
      const url = `http://${state.lan}`;
      try { await navigator.clipboard.writeText(url); toast(`已复制手机访问地址：${url}（手机需连同一 Wi-Fi）`); }
      catch { toast(`手机访问地址：${url}（手机需连同一 Wi-Fi）`); }
    };
  }

  $('#listTitle').textContent = mode === 'today'
    ? '今日任务'
    : `${dateLabel(viewDate)} 的任务${mode === 'future' ? '（规划中 · 当天自动开始调度）' : '（回顾）'}`;
  const hintMap = {
    today: '大任务挂截止时间 · 目标线 = 截止前 30 分钟',
    future: '可继续增删任务和编辑需求清单，到当天引擎自动接管',
    past: '历史计划只读'
  };
  $('#listHint').textContent = hintMap[mode];

  if (mode === 'today') renderBanner(); else $('#banner').classList.add('hidden');
  renderTasks(mode);
  renderProjNames();
}

function renderProjNames() {
  const names = [...new Set((state.tasks || []).map(t => t.project).filter(Boolean))];
  $('#projNames').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

function renderBanner() {
  const b = $('#banner');
  const acks = state.acks || {};
  if (acks.evening_plan === false) {
    b.classList.remove('hidden');
    b.innerHTML = `<span>🌙 到点了 — 该编写明日计划了（可在手机 Trae 同步确认）</span><button class="btn sm" onclick="ack('evening_plan')">已完成规划</button>`;
  } else if (acks.morning_plan === false) {
    b.classList.remove('hidden');
    b.innerHTML = `<span>🌅 今日还没有任务计划 — 和我讨论规划，或右侧临时补录</span><button class="btn sm" onclick="ack('morning_plan')">知道了</button>`;
  } else {
    b.classList.add('hidden');
  }
}

function renderTasks(mode) {
  const cur = nowMin();
  const isToday = mode === 'today';
  const editable = mode !== 'past'; // 今天 + 未来可编辑
  const tasks = [...(state.tasks || [])].sort((a, b) => toMin(a.deadline || '99:99') - toMin(b.deadline || '99:99'));
  if (!tasks.length) {
    const tip = { today: '今日暂无任务 — 和我讨论规划，规划好我直接填进任务板', future: '该日期还未规划 — 说「规划 X 月 X 日的任务」开始', past: '该日期无任务记录' };
    $('#taskList').innerHTML = `<div class="card"><p class="empty">${tip[mode]}</p></div>`;
    return;
  }
  $('#taskList').innerHTML = tasks.map(t => {
    const tM = toMin(t.target), dM = toMin(t.deadline);
    let cd = '', cdCls = '', cdCap = '';
    if (!isToday) { cd = `截止 ${t.deadline}`; cdCap = ''; }
    else if (t.status === 'done') {
      const early = t.completedAt && new Date(t.completedAt) <= atTime(t.target);
      cd = early ? '提前 ✓' : '完成';
      cdCls = 'ok'; cdCap = early ? '达成提前目标' : '已完成';
    } else if (t.status === 'todo') {
      const left = tM - cur;
      if (cur < tM) { cd = hm2(left); cdCap = '距目标线'; }
      else if (cur < dM) { cd = hm2(dM - cur); cdCls = 'warn'; cdCap = '距截止'; }
      else { cd = `+${hm2(cur - dM)}`; cdCls = 'danger'; cdCap = '已逾期'; }
    } else {
      const left = tM - cur;
      if (cur < tM) { cd = hm2(left); cdCls = 'ok'; cdCap = '距目标线'; }
      else if (cur < dM) { cd = hm2(dM - cur); cdCls = 'warn'; cdCap = '距截止'; }
      else { cd = `+${hm2(cur - dM)}`; cdCls = 'danger'; cdCap = '已逾期'; }
    }
    const stepsDone = (t.steps || []).filter(x => x.done).length;
    const steps = t.steps || [];
    const pct = steps.length ? Math.round(stepsDone / steps.length * 100) : 0;
    const overdue = isToday && t.status !== 'done' && cur >= dM;
    return `
    <article class="task s-${t.status} ${overdue ? 'overdue' : ''}">
      <div class="taskHead">
        ${t.project ? `<span class="projTag big">${esc(t.project)}</span>` : ''}
        <span class="taskTitle">${esc(t.title)}</span>
        <span class="pill ${overdue && t.status !== 'done' ? 'overdue' : t.status}">${STATUS_TXT[t.status]}</span>
        ${isToday && t.status === 'done' && t.completedAt && new Date(t.completedAt) <= atTime(t.target) ? '<span class="pill early">提前30分 ✓</span>' : ''}
        ${t.needsConfirm && t.status !== 'done' ? '<span class="pill confirm" title="完成后需人工确认">需确认</span>' : ''}
      </div>
      ${editable ? `<button class="delBtn" title="删除" onclick="delTask('${t.id}')">×</button>` : ''}
      ${t.goal ? `<div class="goal">${esc(t.goal)}</div>` : ''}
      <div class="meta">
        <span class="tl">截止 <b class="tl">${t.deadline}</b></span>
        <span>目标线 <b class="tl">${t.target}</b></span>
        ${steps.length ? `<span>小任务 ${stepsDone}/${steps.length}</span>` : ''}
      </div>
      <div class="countdown"><div class="num ${cdCls}">${cd}</div><div class="cap">${cdCap}</div></div>
      ${steps.length ? (() => {
        // 块内按「所属大任务」分组（时间线归块，大任务不占时间线）
        const groups = [];
        const idx = {};
        steps.forEach((st, i) => {
          const g = st.task || t.title;
          if (!(g in idx)) { idx[g] = groups.length; groups.push({ name: g, items: [] }); }
          groups[idx[g]].items.push({ st, i });
        });
        return `
      <div class="steps">
        ${groups.map(g => `
        <div class="stepGroup">
          <div class="stepGroupTitle">▸ ${esc(g.name)}</div>
          ${g.items.map(({ st, i }) => `
          <div class="stepItem ${st.done ? 'done' : ''}">
            <div class="stepLine">
              <input type="checkbox" ${st.done ? 'checked' : ''} ${isToday ? `onchange="toggleStep('${t.id}',${i})"` : 'disabled'}>
              ${st.project ? `<span class="projTag">${esc(st.project)}</span>` : ''}
              <span class="stTitle">${esc(st.title)}</span>
              ${st.prompt && editable ? `<button class="miniBtn" onclick="copyPrompt(this,'${t.id}',${i})">复制词</button>` : ''}
              ${editable ? `<button class="miniBtn ghost" onclick="editStep('${t.id}',${i})">编辑</button>` : ''}
            </div>
            <div class="promptBox" id="pb-${t.id}-${i}">${st.prompt ? `<pre>${esc(st.prompt)}</pre>` : ''}</div>
          </div>`).join('')}
        </div>`).join('')}
        <div class="stepBar"><i style="width:${pct}%"></i></div>
      </div>`;
      })() : ''}
      ${isToday ? `<div class="actions">${actionsFor(t)}</div>` : ''}
    </article>`;
  }).join('');
}

function actionsFor(t) {
  if (t.status === 'todo') return `<button class="btn primary" onclick="setStatus('${t.id}','doing')">▶ 开始执行</button>`;
  if (t.status === 'doing') {
    let btns = `<button class="btn ok" onclick="setStatus('${t.id}','done')">✓ 完成任务</button>`;
    if (t.needsConfirm) btns += `<button class="btn" onclick="setStatus('${t.id}','confirm')">提交确认</button>`;
    return btns;
  }
  if (t.status === 'confirm') return `<button class="btn ok pulse" onclick="setStatus('${t.id}','done')">🔔 确认完成（停止响铃）</button>`;
  return '';
}

// ---------- 交互 ----------
async function setStatus(id, status) {
  await fetch(`/api/task/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  refresh(); loadDates();
}
async function toggleStep(id, idx) {
  await fetch(`/api/task/${id}/step/${idx}`, { method: 'POST' });
  refresh();
}
async function copyPrompt(btn, id, idx) {
  const st = state.tasks.find(t => t.id === id).steps[idx];
  try {
    await navigator.clipboard.writeText(st.prompt);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = st.prompt; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = '已复制 ✓';
  setTimeout(() => { btn.textContent = old; }, 900);
}
function editStep(id, idx) {
  const st = state.tasks.find(t => t.id === id).steps[idx];
  const box = document.getElementById(`pb-${id}-${idx}`);
  box.innerHTML = `
    <textarea id="ta-${id}-${idx}" rows="4" placeholder="该小任务的执行提示词…">${esc(st.prompt)}</textarea>
    <div class="promptActions">
      <button class="btn sm primary" onclick="saveStep('${id}',${idx})">保存</button>
      <button class="btn sm ghost" onclick="refresh()">取消</button>
    </div>`;
  document.getElementById(`ta-${id}-${idx}`).focus();
}
async function saveStep(id, idx) {
  const prompt = document.getElementById(`ta-${id}-${idx}`).value;
  await fetch(`/api/task/${id}/step/${idx}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  refresh();
}
async function delTask(id) {
  if (!confirm('删除这个大任务？')) return;
  await fetch(`/api/task/${id}`, { method: 'DELETE' });
  refresh(); loadDates();
}
async function ack(key) {
  await fetch(`/api/ack/${key}`, { method: 'POST' });
  refresh();
}

// ---------- 表单 ----------
function addStepRow(title = '', prompt = '') {
  const row = document.createElement('div');
  row.className = 'stepRow';
  row.innerHTML = `
    <button type="button" class="srDel" title="移除">✕</button>
    <input class="srTitle" placeholder="小任务：这一步做什么" value="${esc(title)}">
    <textarea class="srPrompt" rows="2" placeholder="执行提示词：粘贴给该项目 Agent 的完整指令（可空）">${esc(prompt)}</textarea>`;
  row.querySelector('.srDel').addEventListener('click', () => row.remove());
  $('#stepRows').appendChild(row);
}
$('#addStepRow').addEventListener('click', () => addStepRow());

$('#fAdd').addEventListener('click', async () => {
  const title = $('#fTitle').value.trim();
  const deadline = $('#fDeadline').value || defaultDeadline();
  if (!title) { $('#fTitle').focus(); return; }
  const project = $('#fProject').value.trim();
  const steps = [...document.querySelectorAll('#stepRows .stepRow')].map(r => ({
    title: r.querySelector('.srTitle').value.trim(),
    prompt: r.querySelector('.srPrompt').value.trim()
  })).filter(s => s.title || s.prompt);
  await fetch('/api/task', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, project, deadline, needsConfirm: $('#fConfirm').checked, steps, date: viewDate || todayStr() })
  });
  $('#fTitle').value = ''; $('#fConfirm').checked = false;
  $('#stepRows').innerHTML = '';
  refresh(); loadDates();
});

function defaultDeadline() {
  const cur = nowMin() + 60;
  return hm(Math.min(Math.ceil(cur / 30) * 30, 23 * 60 + 50));
}

// ---------- 启动 ----------
const d0 = new Date();
$('#dateLine').textContent = `${d0.getFullYear()} 年 ${d0.getMonth() + 1} 月 ${d0.getDate()} 日 · 星期${WEEK[d0.getDay()]}`;
$('#fDeadline').value = defaultDeadline();
refresh();
loadDates();
setInterval(refresh, 5000);   // 状态 5s
setInterval(() => { if (state && state.current !== false) render(); }, 1000); // 倒计时 1s（仅今天）
setInterval(loadDates, 60000);
