/**
 * 最佳效率调度中心 - API 服务
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Engine } = require('./engine');

const app = express();
const PORT = process.env.PORT || 3618;
const PROJECTS_FILE = path.join(__dirname, 'data', 'projects.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const engine = new Engine();

// ---------- API ----------
app.get('/api/state', (req, res) => {
  const ip = lanIP();
  res.json({ now: new Date().toISOString(), date: engine.plan.date, tasks: engine.plan.tasks, acks: engine.plan.acks, stats: engine.stats(), lan: ip ? `${ip}:${PORT}` : null });
});

app.post('/api/task', (req, res) => {
  const { title, project, goal, estimateMin, startAt, deadline, needsConfirm, steps, date } = req.body || {};
  if (!title || !deadline) return res.status(400).json({ error: 'title 和 deadline 必填' });
  const t = engine.addTask({ title, project, goal, estimateMin, startAt, deadline, needsConfirm, steps, date });
  res.json(t);
});

app.post('/api/task/:id/status', (req, res) => {
  const t = engine.setStatus(req.params.id, req.body.status);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  res.json(t);
});

app.post('/api/task/:id/step/:idx', (req, res) => {
  const t = engine.toggleStep(req.params.id, parseInt(req.params.idx, 10));
  if (!t) return res.status(404).json({ error: '步骤不存在' });
  res.json(t);
});

// 编辑需求清单条目（步骤标题 / 项目 / 提示词）
app.patch('/api/task/:id/step/:idx', (req, res) => {
  const t = engine.editStep(req.params.id, parseInt(req.params.idx, 10), req.body || {});
  if (!t) return res.status(404).json({ error: '步骤不存在' });
  res.json(t);
});

app.delete('/api/task/:id', (req, res) => {
  res.json({ ok: engine.removeTask(req.params.id) });
});

app.post('/api/ack/:key', (req, res) => {
  engine.ack(req.params.key);
  res.json({ ok: true });
});

// ---------- 日期归档 ----------
app.get('/api/dates', (req, res) => {
  res.json({ dates: engine.dates() });
});

app.get('/api/plan/:date', (req, res) => {
  const p = engine.planByDate(req.params.date);
  if (!p) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  res.json({ now: new Date().toISOString(), ...p, acks: p.current ? engine.plan.acks : {}, stats: p.current ? engine.stats() : null });
});

// ---------- 项目活跃度 ----------
app.get('/api/projects', (req, res) => {
  if (fs.existsSync(PROJECTS_FILE)) {
    res.json(JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')));
  } else {
    res.json({ scannedAt: null, projects: [] });
  }
});

app.post('/api/scan', (req, res) => {
  const child = spawn('node', [path.join(__dirname, 'scripts', 'scan-projects.js')], { stdio: 'ignore', detached: true });
  child.unref();
  res.json({ ok: true, msg: '扫描已启动，约 10-30 秒后刷新' });
});

// 局域网 IPv4（手机访问用）
function lanIP() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[效率调度中心] 面板 → http://localhost:${PORT}`);
  const ip = lanIP();
  if (ip) console.log(`[效率调度中心] 手机访问（同一Wi-Fi） → http://${ip}:${PORT}`);
  engine.start();
});
