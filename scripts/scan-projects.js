/**
 * 扫描 /Users/moon/Trae 下所有项目：
 * 最近活跃时间（文件 mtime，深度≤2）、git 未提交数 → data/projects.json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = '/Users/moon/Trae';
const OUT = path.join(__dirname, '..', 'data', 'projects.json');
const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'output', '.DS_Store']);

function lastActive(dir, depth) {
  let latest = 0;
  const walk = (d, dep) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs > latest) latest = st.mtimeMs;
        if (e.isDirectory() && dep < depth) walk(p, dep + 1);
      } catch {}
    }
  };
  walk(dir, 0);
  return latest;
}

function scan() {
  const now = Date.now();
  const projects = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => {
      const dir = path.join(ROOT, e.name);
      const mt = lastActive(dir, 2);
      let dirty = false, branch = '';
      if (fs.existsSync(path.join(dir, '.git'))) {
        try {
          branch = execSync('git branch --show-current', { cwd: dir, encoding: 'utf8' }).trim();
          dirty = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim().length > 0;
        } catch {}
      }
      const daysAgo = Math.floor((now - mt) / 86400000);
      return {
        name: e.name,
        lastActive: mt ? new Date(mt).toISOString() : null,
        lastActiveText: mt ? relText(daysAgo) : '—',
        daysAgo, git: !!branch, branch, dirty
      };
    })
    .sort((a, b) => b.lastActive - a.lastActive);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ scannedAt: new Date().toISOString(), total: projects.length, projects }, null, 2));
  console.log(`[扫描完成] ${projects.length} 个项目 → ${OUT}`);
}

function relText(days) {
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

scan();
