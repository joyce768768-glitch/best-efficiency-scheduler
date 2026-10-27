/**
 * 调度引擎：30 秒轮询任务状态
 * 规则：
 *  - todo 到达开始时间 → 提醒开始
 *  - doing 到达目标线（截止-30min）未完成 → 预警
 *  - doing 超过截止 → 逾期强提醒
 *  - confirm（待人工确认）→ 每 30s 响铃，直到确认
 *  - 每日 09:00 无计划 / 21:00 明日计划 → 响铃提醒直到确认
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PLANS_DIR = path.join(DATA_DIR, 'plans'); // 每日一文件：plans/2026-10-18.json
const LEGACY_PLAN_FILE = path.join(DATA_DIR, 'plan.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const SOUND = '/System/Library/Sounds/Glass.aiff';
const TICK_MS = 30 * 1000;

// ---------- 时间工具 ----------
function pad(n) { return String(n).padStart(2, '0'); }
function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function nowMinutes(d = new Date()) { return d.getHours() * 60 + d.getMinutes(); }
function parseHM(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function fmtHM(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }

// ---------- 系统提醒 ----------
let ringing = false;
function ring() {
  if (ringing) return;
  ringing = true;
  const p = spawn('afplay', [SOUND], { stdio: 'ignore' });
  p.on('exit', () => { ringing = false; });
  p.on('error', () => { ringing = false; });
}
function notify(msg, title = '效率调度中心', sound = 'Glass') {
  const script = `display notification "${msg.replace(/"/g, "'")}" with title "${title}" sound name "${sound}"`;
  spawn('osascript', ['-e', script], { stdio: 'ignore' }).on('error', () => {});
}

// ---------- 任务模型 ----------
// 步骤 = 需求清单条目：在哪个项目、做什么、用什么提示词执行
function normStep(s) {
  if (typeof s === 'string') return { title: s, project: '', task: '', prompt: '', done: false };
  return { title: s.title || '', project: s.project || '', task: s.task || '', prompt: s.prompt || '', done: !!s.done };
}

function createTask(input) {
  const now = new Date();
  const startMin = input.startAt ? parseHM(input.startAt) : nowMinutes(now);
  const est = Math.max(5, parseInt(input.estimateMin, 10) || 60);
  // 截止时间只挂大任务，由讨论时确定；未指定则 = 开始 + 工时
  const dlMin = parseHM(input.deadline || fmtHM(startMin + est));
  return {
    id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 100),
    title: input.title,
    project: input.project || '', // 大任务所属项目
    steps: (input.steps || []).filter(Boolean).map(normStep),
    goal: input.goal || '', // 任务目标备注（讨论结论）
    estimateMin: est,
    startAt: fmtHM(startMin),
    deadline: fmtHM(dlMin),
    target: fmtHM(Math.max(dlMin - 30, startMin)), // 提前30分钟目标线
    status: 'todo', // todo | doing | confirm | done
    needsConfirm: !!input.needsConfirm,
    confirmedAt: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    alerts: { start: false, target: false, deadline: false, confirmCount: 0 }
  };
}

// ---------- 计划存储 ----------
class Engine {
  constructor() {
    fs.mkdirSync(PLANS_DIR, { recursive: true });
    this._migrate();
    this.date = todayStr();
    this.plan = this._loadDay(this.date);
    this.timer = null;
    this._dailyFired = {};
  }

  // 旧存储（plan.json / history/）一次性迁移到 plans/
  _migrate() {
    const move = (src, date) => {
      const dst = path.join(PLANS_DIR, `${date}.json`);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    };
    try {
      for (const f of fs.readdirSync(HISTORY_DIR)) {
        if (!f.startsWith('plan-') || !f.endsWith('.json')) continue;
        const p = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
        if (p.date) move(path.join(HISTORY_DIR, f), p.date);
      }
    } catch {}
    try {
      if (fs.existsSync(LEGACY_PLAN_FILE)) {
        const p = JSON.parse(fs.readFileSync(LEGACY_PLAN_FILE, 'utf8'));
        if (p.date) move(LEGACY_PLAN_FILE, p.date);
      }
    } catch {}
  }

  _dayFile(date) { return path.join(PLANS_DIR, `${date}.json`); }
  _loadDay(date) {
    try {
      return JSON.parse(fs.readFileSync(this._dayFile(date), 'utf8'));
    } catch { return { date, tasks: [], acks: {} }; }
  }

  save() { fs.writeFileSync(this._dayFile(this.date), JSON.stringify(this.plan, null, 2)); }
  saveDay(date, plan) { fs.writeFileSync(this._dayFile(date), JSON.stringify(plan, null, 2)); }

  // ---------- 任务操作 ----------
  // input.date 可指定任意日期（规划会话绑定日期）；默认今天
  addTask(input) {
    const t = createTask(input);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : this.date;
    if (date === this.date) {
      this.plan.tasks.push(t);
      if (this.plan.tasks.length === 1) delete this.plan.acks.morning_plan; // 消除"今日未规划"提醒
      this.save();
    } else {
      const dayPlan = this._loadDay(date);
      dayPlan.tasks.push(t);
      this.saveDay(date, dayPlan);
    }
    return t;
  }
  // 定位任务：先查今天内存，再扫描其他日期文件（支持为未来日期规划）
  _locate(id) {
    let t = this.plan.tasks.find(x => x.id === id);
    if (t) return { t, plan: this.plan, date: this.date };
    try {
      for (const f of fs.readdirSync(PLANS_DIR)) {
        if (!f.endsWith('.json')) continue;
        const date = f.replace('.json', '');
        if (date === this.date) continue;
        const plan = this._loadDay(date);
        const tt = plan.tasks.find(x => x.id === id);
        if (tt) return { t: tt, plan, date };
      }
    } catch {}
    return null;
  }
  _persist(loc) { if (loc.date === this.date) { this.save(); } else { this.saveDay(loc.date, loc.plan); } }

  setStatus(id, status) {
    const loc = this._locate(id);
    if (!loc) return null;
    const t = loc.t;
    if (status === 'done' && t.status === 'confirm') t.confirmedAt = new Date().toISOString();
    if (status === 'done') {
      t.completedAt = new Date().toISOString();
      t.status = 'done';
    } else if (['todo', 'doing', 'confirm'].includes(status)) {
      t.status = status;
      if (status !== 'done') { t.completedAt = null; }
    }
    this._persist(loc);
    return t;
  }
  toggleStep(id, idx) {
    const loc = this._locate(id);
    if (!loc || !loc.t.steps[idx]) return null;
    loc.t.steps[idx].done = !loc.t.steps[idx].done;
    this._persist(loc);
    return loc.t;
  }
  editStep(id, idx, patch) {
    const loc = this._locate(id);
    if (!loc || !loc.t.steps[idx]) return null;
    const st = loc.t.steps[idx];
    for (const k of ['title', 'project', 'prompt']) {
      if (typeof patch[k] === 'string') st[k] = patch[k];
    }
    this._persist(loc);
    return loc.t;
  }
  removeTask(id) {
    const loc = this._locate(id);
    if (!loc) return false;
    loc.plan.tasks = loc.plan.tasks.filter(x => x.id !== id);
    this._persist(loc);
    return true;
  }
  ack(key) { this.plan.acks[key] = true; this.save(); }

  // ---------- 轮询 ----------
  start() {
    this.tick(); // 启动立即检查一次
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }
  tick() {
    // 跨天自动切换：昨日文件已归档在 plans/，今天 0 点后自动被调度
    const td = todayStr();
    if (td !== this.date) {
      this.date = td;
      this.plan = this._loadDay(td);
      this._dailyFired = {};
    }
    const now = new Date();
    const cur = nowMinutes(now);
    for (const t of this.plan.tasks) {
      const startM = parseHM(t.startAt), targetM = parseHM(t.target), dlM = parseHM(t.deadline);
      if (t.status === 'todo' && cur >= startM && !t.alerts.start) {
        t.alerts.start = true; this.save();
        notify(`「${t.title}」已到计划开始时间 ${t.startAt}`, '🟦 任务该开始了');
      }
      if (t.status === 'doing') {
        if (cur >= targetM && cur < dlM && !t.alerts.target) {
          t.alerts.target = true; this.save();
          notify(`「${t.title}」距目标线 ${t.target} 只剩30分钟，加速！`, '🟨 提前30分钟目标预警');
        }
        if (cur >= dlM && !t.alerts.deadline) {
          t.alerts.deadline = true; this.save();
          notify(`「${t.title}」已过截止时间 ${t.deadline}`, '🟥 任务逾期');
          ring();
        }
      }
      if (t.status === 'confirm') {
        // 需人工确认：持续响铃直到确认
        ring();
        t.alerts.confirmCount++;
        if (t.alerts.confirmCount % 4 === 1) { // 每 2 分钟一条通知，铃声每 30s 一次
          this.save();
          notify(`「${t.title}」等待你确认完成，去面板点「确认完成」停止响铃`, '🔔 待确认');
        }
      }
    }
    this._dailyCheck(cur);
  }
  _dailyCheck(cur) {
    // 09:00 若今日无任务 → 提醒规划（直到添加任务或点确认）
    if (cur >= 9 * 60 && cur < 10 * 60 && this.plan.tasks.length === 0 && !this.plan.acks.morning_plan && !this._dailyFired.morning) {
      this._dailyFired.morning = true;
      this.plan.acks.morning_plan = false; this.save();
      notify('今日还没有任务计划，去面板添加或告诉 AI 助手规划', '🌅 每日规划');
      ring();
    }
    // 21:00 提醒编写明日计划（响铃直到确认）
    if (cur >= 21 * 60 && !this.plan.acks.evening_plan && !this._dailyFired.evening) {
      this._dailyFired.evening = true;
      this.plan.acks.evening_plan = false; this.save();
      notify('该编写明日计划了（手机 Trae 定时任务同步提醒）', '🌙 明日计划');
      ring();
    }
    // 已进入提醒时段后，持续响铃直到 ack
    if (this.plan.acks.morning_plan === false && cur >= 9 * 60 && cur < 10 * 60 && this.plan.tasks.length === 0) ring();
    if (this.plan.acks.evening_plan === false && cur >= 21 * 60) ring();
  }

  stats() {
    const ts = this.plan.tasks;
    const done = ts.filter(t => t.status === 'done');
    const early = done.filter(t => t.completedAt && parseHM(t.target) >= 0 &&
      new Date(t.completedAt) <= this._todayAt(t.target));
    return {
      total: ts.length, done: done.length,
      doing: ts.filter(t => t.status === 'doing').length,
      confirm: ts.filter(t => t.status === 'confirm').length,
      earlyDone: early.length,
      plannedMin: ts.reduce((s, t) => s + t.estimateMin, 0)
    };
  }

  // ---------- 日期归档（左侧日期列表） ----------
  dates() {
    const list = [];
    try {
      for (const f of fs.readdirSync(PLANS_DIR)) {
        if (!f.endsWith('.json')) continue;
        try {
          const p = JSON.parse(fs.readFileSync(path.join(PLANS_DIR, f), 'utf8'));
          if (!p.date) continue;
          const ts = p.tasks || [];
          list.push({ date: p.date, total: ts.length, done: ts.filter(t => t.status === 'done').length });
        } catch {}
      }
    } catch {}
    if (!list.some(x => x.date === this.date)) {
      const ts = this.plan.tasks;
      list.push({ date: this.date, total: ts.length, done: ts.filter(t => t.status === 'done').length });
    }
    return list
      .filter(x => x.date === this.date || x.total > 0) // 空计划不进日期栏，避免误点进空白页
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(x => ({ ...x, current: x.date === this.date }));
  }
  planByDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    if (date === this.date) return { date, tasks: this.plan.tasks, current: true };
    return { date, tasks: this._loadDay(date).tasks, current: false };
  }
  _todayAt(hm) {
    const [h, m] = hm.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0); return d;
  }
}

module.exports = { Engine, todayStr, nowMinutes, fmtHM, parseHM, notify, ring };
