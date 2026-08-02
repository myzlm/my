// ============================================================
//  极速墨韵后端（权限：owner / admin / member）
//  安全增强：禁止通过 API 创建 owner 账号
//  运行：node server.js
// ============================================================

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;

// ---------- 数据文件路径 ----------
const DATA_DIR = __dirname;
const SITES_FILE = path.join(DATA_DIR, 'data.json');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'article_applications.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DELETE_REQUESTS_FILE = path.join(DATA_DIR, 'delete_requests.json');

const DAILY_APPLY_LIMIT = 3;

// ==================== 全内存数据存储 ====================
let DB = {
  sites: [],
  articles: [],
  applications: [],
  questions: [],
  users: {},
  deleteRequests: []
};

// 异步写入队列
const writeQueue = {};
function scheduleWrite(file, data) {
  if (!writeQueue[file]) writeQueue[file] = Promise.resolve();
  writeQueue[file] = writeQueue[file].then(() => fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf-8'));
  writeQueue[file].catch(e => console.error(`写入 ${file} 失败:`, e));
}

async function loadAllData() {
  async function readIfExists(file, fallback) {
    try { return JSON.parse(await fsp.readFile(file, 'utf-8')); }
    catch { return fallback; }
  }
  const [sites, articles, applications, questions, users, deleteRequests] = await Promise.all([
    readIfExists(SITES_FILE, []),
    readIfExists(ARTICLES_FILE, []),
    readIfExists(APPLICATIONS_FILE, []),
    readIfExists(QUESTIONS_FILE, []),
    readIfExists(USERS_FILE, { zlm: { password: 'zlm20130503', role: 'admin' } }),
    readIfExists(DELETE_REQUESTS_FILE, [])
  ]);
  DB.sites = sites;
  DB.articles = articles;
  DB.applications = applications;
  DB.questions = questions;
  DB.users = users;
  DB.deleteRequests = deleteRequests;
  console.log('📂 数据已全部加载到内存');
}

// 密码升级为 bcrypt
async function upgradePasswords() {
  let modified = false;
  for (const [username, user] of Object.entries(DB.users)) {
    if (!user.password.startsWith('$2b$')) {
      console.log(`🔐 正在将用户 ${username} 的明文密码升级为哈希...`);
      const hash = await bcrypt.hash(user.password, 10);
      DB.users[username].password = hash;
      modified = true;
    }
  }
  if (modified) {
    scheduleWrite(USERS_FILE, DB.users);
    console.log('✅ 所有密码已升级为 bcrypt 哈希');
  }
}

// 角色升级：将原 admin 角色全部转为 owner（一次性）
function upgradeRoles() {
  let modified = false;
  for (const [username, user] of Object.entries(DB.users)) {
    if (user.role === 'admin') {
      console.log(`🔄 将用户 ${username} 的角色从 admin 升级为 owner`);
      user.role = 'owner';
      modified = true;
    }
  }
  if (modified) {
    scheduleWrite(USERS_FILE, DB.users);
    console.log('✅ 所有 admin 已升级为 owner');
  }
}

// 确保至少有一个 owner 账号（zlm）
function ensureOwner() {
  if (!DB.users.zlm) {
    const hash = bcrypt.hashSync('zlm20130503', 10);
    DB.users.zlm = { password: hash, role: 'owner' };
    scheduleWrite(USERS_FILE, DB.users);
    console.log('👤 已创建默认所有者账户 zlm');
  } else if (DB.users.zlm.role !== 'owner') {
    DB.users.zlm.role = 'owner';
    scheduleWrite(USERS_FILE, DB.users);
    console.log('🔧 已将 zlm 角色修正为 owner');
  }
}

// ==================== 中间件 ====================
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-Requested-With']
}));
app.options('*', cors());

// ---------- Session 配置 ----------
const sessionMiddleware = session({
  secret: 'ink-blog-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
});
app.use(sessionMiddleware);

// 全局限速
app.use('/api', rateLimit({ windowMs: 60*1000, max: 150, message: { error:'请求太频繁' } }));

// 登录限流
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: '登录尝试过多，请5分钟后重试' },
  skip: (req) => {
    const localIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (localIPs.includes(req.ip)) return true;
    const username = req.body && req.body.username;
    if (username === 'zlm') return true;
    return false;
  }
});
app.use('/api/login', loginLimiter);

// ==================== 权限中间件 ====================
function requireLogin(req,res,next) {
  if (!req.session.user) return res.status(401).json({ error:'请先登录' });
  next();
}

function requireOwner(req,res,next) {
  if (!req.session.user || req.session.user.role !== 'owner')
    return res.status(403).json({ error:'需要所有者权限' });
  next();
}

function requireAdmin(req,res,next) {
  if (!req.session.user || !['owner','admin'].includes(req.session.user.role))
    return res.status(403).json({ error:'需要管理员或所有者权限' });
  next();
}

function requireMember(req,res,next) {
  if (!req.session.user) return res.status(401).json({ error:'请先登录' });
  next();
}

// ==================== 页面托管 ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== 通用接口 ====================
app.get('/api/me', (req, res) => res.json(req.session.user || null));

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username||!password) return res.status(400).json({ error:'用户名和密码不能为空' });
  const user = DB.users[username];
  if (!user) return res.status(401).json({ error:'账号或密码错误' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error:'账号或密码错误' });
  req.session.user = { username, role: user.role };
  res.json({ username, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error:'登出失败' });
    res.clearCookie('connect.sid');
    res.json({ message:'已登出' });
  });
});

// ==================== 导航页 API ====================
app.get('/api/sites', (req, res) => res.json(DB.sites));
app.post('/api/sites', requireAdmin, (req, res) => {
  const { name, url, desc, seal, category } = req.body;
  if (!name||!url) return res.status(400).json({ error:'名称和网址不能为空' });
  const site = {
    name: name.trim(),
    url: url.trim(),
    desc: desc ? desc.trim() : '',
    seal: seal ? seal.trim().substring(0,2) : '🔗',
    category: category ? category.trim() : '其他',
    visits: 0,
    createdAt: new Date().toISOString()
  };
  DB.sites.push(site);
  scheduleWrite(SITES_FILE, DB.sites);
  res.status(201).json(site);
});
app.delete('/api/sites/:index', requireAdmin, (req, res) => {
  const index = parseInt(req.params.index);
  if (isNaN(index) || index < 0 || index >= DB.sites.length)
    return res.status(404).json({ error:'站点不存在' });
  const deleted = DB.sites.splice(index, 1)[0];
  scheduleWrite(SITES_FILE, DB.sites);
  res.json({ message:'已删除', deleted });
});
app.post('/api/sites/:index/visit', (req, res) => {
  const index = parseInt(req.params.index);
  if (isNaN(index) || index < 0 || index >= DB.sites.length)
    return res.status(404).json({ error:'站点不存在' });
  DB.sites[index].visits = (DB.sites[index].visits || 0) + 1;
  scheduleWrite(SITES_FILE, DB.sites);
  res.json({ visits: DB.sites[index].visits });
});

// ==================== 用户管理（安全增强） ====================

// 查看所有用户
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(Object.keys(DB.users).map(u => ({ username: u, role: DB.users[u].role })));
});

// 创建用户 - 禁止创建 owner 角色
app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username||!password) return res.status(400).json({ error:'用户名和密码不能为空' });
  if (DB.users[username]) return res.status(400).json({ error:'用户已存在' });

  const currentUserRole = req.session.user.role;
  let targetRole = 'member';   // 默认成员

  // 安全限制：禁止通过 API 创建 owner 账号
  if (role === 'owner') {
    return res.status(403).json({ error: '禁止通过此接口创建所有者账号' });
  }
  
  if (role === 'admin') {
    // 只有 owner 才能创建 admin
    if (currentUserRole !== 'owner') {
      return res.status(403).json({ error: '只有所有者才能创建管理员账号' });
    }
    targetRole = 'admin';
  } else {
    targetRole = 'member';
  }

  const hash = await bcrypt.hash(password, 10);
  DB.users[username] = { password: hash, role: targetRole };
  scheduleWrite(USERS_FILE, DB.users);
  res.status(201).json({ username, role: targetRole });
});

// 删除用户（仅限 owner，且不能删除其他 owner）
app.delete('/api/users/:username', requireOwner, (req, res) => {
  const { username } = req.params;
  if (username === 'zlm') return res.status(400).json({ error:'不能删除主所有者' });
  if (!DB.users[username]) return res.status(404).json({ error:'用户不存在' });
  if (DB.users[username].role === 'owner') return res.status(400).json({ error:'不能删除其他所有者' });
  delete DB.users[username];
  scheduleWrite(USERS_FILE, DB.users);
  res.json({ message:'用户已删除' });
});

// 修改他人密码（仅限 owner）
app.put('/api/users/:username/password', requireOwner, async (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error:'新密码长度至少6位' });
  if (!DB.users[username]) return res.status(404).json({ error:'用户不存在' });
  const hash = await bcrypt.hash(newPassword, 10);
  DB.users[username].password = hash;
  scheduleWrite(USERS_FILE, DB.users);
  res.json({ success: true, message: `已修改 ${username} 的密码` });
});

// 成员自助修改密码
app.put('/api/me/password', requireLogin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error:'请输入旧密码和新密码' });
  if (newPassword.length < 6) return res.status(400).json({ error:'新密码长度至少6位' });
  const username = req.session.user.username;
  const user = DB.users[username];
  if (!user) return res.status(500).json({ error:'用户数据异常' });
  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return res.status(401).json({ error:'旧密码错误' });
  const hash = await bcrypt.hash(newPassword, 10);
  DB.users[username].password = hash;
  scheduleWrite(USERS_FILE, DB.users);
  res.json({ success: true, message: '密码修改成功' });
});

// ==================== 管理员申请删除成员 ====================

app.post('/api/delete-requests', requireAdmin, (req, res) => {
  if (req.session.user.role === 'owner') {
    return res.status(400).json({ error:'所有者可直接删除，无需申请' });
  }
  const { username } = req.body;
  if (!username) return res.status(400).json({ error:'请提供要删除的用户名' });
  if (!DB.users[username]) return res.status(404).json({ error:'目标用户不存在' });
  if (username === 'zlm' || DB.users[username].role === 'owner') {
    return res.status(400).json({ error:'不能对所有者执行此操作' });
  }
  const existed = DB.deleteRequests.find(r => r.target === username && r.status === 'pending');
  if (existed) return res.status(400).json({ error:'该用户的删除申请已存在，请等待处理' });

  const request = {
    id: crypto.randomUUID(),
    applicant: req.session.user.username,
    target: username,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  DB.deleteRequests.push(request);
  scheduleWrite(DELETE_REQUESTS_FILE, DB.deleteRequests);
  res.status(201).json({ message: '删除申请已提交', request });
});

app.get('/api/delete-requests', requireOwner, (req, res) => {
  res.json(DB.deleteRequests);
});

app.post('/api/delete-requests/:id/approve', requireOwner, async (req, res) => {
  const reqId = req.params.id;
  const index = DB.deleteRequests.findIndex(r => r.id === reqId);
  if (index === -1) return res.status(404).json({ error:'申请不存在' });
  const request = DB.deleteRequests[index];
  if (request.status !== 'pending') return res.status(400).json({ error:'该申请已处理' });

  const target = request.target;
  if (!DB.users[target]) {
    request.status = 'failed';
    request.result = '目标用户已不存在';
    scheduleWrite(DELETE_REQUESTS_FILE, DB.deleteRequests);
    return res.status(400).json({ error:'目标用户不存在' });
  }
  delete DB.users[target];
  scheduleWrite(USERS_FILE, DB.users);

  request.status = 'approved';
  request.result = '已删除';
  request.processedAt = new Date().toISOString();
  scheduleWrite(DELETE_REQUESTS_FILE, DB.deleteRequests);
  res.json({ message: `已批准并删除用户 ${target}`, request });
});

app.post('/api/delete-requests/:id/reject', requireOwner, (req, res) => {
  const reqId = req.params.id;
  const index = DB.deleteRequests.findIndex(r => r.id === reqId);
  if (index === -1) return res.status(404).json({ error:'申请不存在' });
  const request = DB.deleteRequests[index];
  if (request.status !== 'pending') return res.status(400).json({ error:'该申请已处理' });

  request.status = 'rejected';
  request.result = '已拒绝';
  request.processedAt = new Date().toISOString();
  scheduleWrite(DELETE_REQUESTS_FILE, DB.deleteRequests);
  res.json({ message: '已拒绝该申请', request });
});

// ==================== 博客文章 API ====================
app.get('/api/articles', (req, res) => {
  const sorted = [...DB.articles].sort((a,b) => (b.pinned?1:0) - (a.pinned?1:0) || new Date(b.createdAt) - new Date(a.createdAt));
  res.json(sorted);
});
app.get('/api/articles/:id', (req, res) => {
  const article = DB.articles.find(a => a.id === req.params.id);
  if (!article) return res.status(404).json({ error:'文章不存在' });
  res.json(article);
});
app.post('/api/articles', requireAdmin, (req, res) => {
  const { title, content, summary, tags, seal, pinned } = req.body;
  if (!title||!content) return res.status(400).json({ error:'标题和内容不能为空' });
  const article = {
    id: crypto.randomUUID(),
    title: title.trim(),
    content: content.trim(),
    summary: summary ? summary.trim() : content.trim().substring(0, 150),
    tags: Array.isArray(tags) ? tags : [],
    seal: seal ? seal.trim().substring(0,2) : '墨',
    pinned: !!pinned,
    author: req.session.user.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  DB.articles.push(article);
  scheduleWrite(ARTICLES_FILE, DB.articles);
  res.status(201).json(article);
});
app.put('/api/articles/:id', requireAdmin, (req, res) => {
  const idx = DB.articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'文章不存在' });
  const { title, content, summary, tags, seal, pinned, annotations } = req.body;
  if (!title||!content) return res.status(400).json({ error:'标题和内容不能为空' });
  const existing = DB.articles[idx];
  DB.articles[idx] = {
    ...existing,
    title: title.trim(),
    content: content.trim(),
    summary: summary ? summary.trim() : content.trim().substring(0, 150),
    tags: Array.isArray(tags) ? tags : existing.tags || [],
    seal: seal ? seal.trim().substring(0,2) : existing.seal || '墨',
    pinned: pinned !== undefined ? !!pinned : existing.pinned,
    annotations: annotations || existing.annotations || [],
    updatedAt: new Date().toISOString()
  };
  scheduleWrite(ARTICLES_FILE, DB.articles);
  res.json(DB.articles[idx]);
});
app.delete('/api/articles/:id', requireAdmin, (req, res) => {
  const idx = DB.articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'文章不存在' });
  const deleted = DB.articles.splice(idx, 1)[0];
  scheduleWrite(ARTICLES_FILE, DB.articles);
  res.json({ message:'已删除', deleted });
});

// ==================== 文章申请 API ====================
app.get('/api/apply-quota', requireMember, (req, res) => {
  const username = req.session.user.username;
  const today = new Date().toISOString().substring(0,10);
  const used = DB.applications.filter(a => a.applicant === username && a.createdAt.startsWith(today)).length;
  res.json({ limit: DAILY_APPLY_LIMIT, used, remaining: Math.max(0, DAILY_APPLY_LIMIT - used) });
});
app.get('/api/apply-quota/all', requireAdmin, (req, res) => {
  const today = new Date().toISOString().substring(0,10);
  const result = Object.keys(DB.users).map(username => ({
    username,
    used: DB.applications.filter(a => a.applicant === username && a.createdAt.startsWith(today)).length,
    limit: DAILY_APPLY_LIMIT
  }));
  res.json(result);
});
app.post('/api/apply-quota/reset/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  if (!DB.users[username]) return res.status(404).json({ error:'用户不存在' });
  const today = new Date().toISOString().substring(0,10);
  DB.applications = DB.applications.filter(a => !(a.applicant === username && a.createdAt.startsWith(today)));
  scheduleWrite(APPLICATIONS_FILE, DB.applications);
  res.json({ message: `已重置 ${username} 今日申请次数` });
});
app.post('/api/article-applications', requireMember, (req, res) => {
  const username = req.session.user.username;
  const { title, content, summary, tags, seal } = req.body;
  if (!title||!content) return res.status(400).json({ error:'标题和内容不能为空' });
  const today = new Date().toISOString().substring(0,10);
  const used = DB.applications.filter(a => a.applicant === username && a.createdAt.startsWith(today)).length;
  if (used >= DAILY_APPLY_LIMIT) return res.status(429).json({ error:`今日申请次数已用尽` });
  const app = {
    id: crypto.randomUUID(),
    title: title.trim(),
    content: content.trim(),
    summary: summary ? summary.trim() : content.trim().substring(0,150),
    tags: Array.isArray(tags) ? tags : [],
    seal: seal ? seal.trim().substring(0,2) : '墨',
    applicant: username,
    createdAt: new Date().toISOString()
  };
  DB.applications.push(app);
  scheduleWrite(APPLICATIONS_FILE, DB.applications);
  res.status(201).json(app);
});
app.get('/api/article-applications', requireAdmin, (req, res) => {
  res.json(DB.applications);
});
app.post('/api/article-applications/:id/approve', requireAdmin, (req, res) => {
  const idx = DB.applications.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'申请不存在' });
  const app = DB.applications[idx];
  const article = {
    id: crypto.randomUUID(),
    title: app.title,
    content: app.content,
    summary: app.summary,
    tags: app.tags,
    seal: app.seal,
    pinned: false,
    author: app.applicant,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  DB.articles.push(article);
  DB.applications.splice(idx, 1);
  scheduleWrite(ARTICLES_FILE, DB.articles);
  scheduleWrite(APPLICATIONS_FILE, DB.applications);
  res.json({ message:'已批准并发布', article });
});
app.delete('/api/article-applications/:id', requireAdmin, (req, res) => {
  const idx = DB.applications.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'申请不存在' });
  DB.applications.splice(idx, 1);
  scheduleWrite(APPLICATIONS_FILE, DB.applications);
  res.json({ message:'申请已拒绝' });
});

// ==================== 题库 API ====================
app.get('/api/questions', requireMember, (req, res) => {
  const categories = [...new Set(DB.questions.map(q => q.category).filter(Boolean))].sort();
  res.json({ questions: DB.questions, categories });
});
app.post('/api/questions', requireAdmin, (req, res) => {
  const { number, name, category, content, images, code } = req.body;
  if (!number||!name) return res.status(400).json({ error:'题号与题名必填' });
  const q = {
    id: crypto.randomUUID(),
    number: number.trim(),
    name: name.trim(),
    category: category ? category.trim() : '',
    content: content ? content.trim() : '',
    images: Array.isArray(images) ? images : [],
    code: code ? code.trim() : '',
    createdAt: new Date().toISOString()
  };
  DB.questions.push(q);
  scheduleWrite(QUESTIONS_FILE, DB.questions);
  res.status(201).json({ success: true, question: q });
});
app.put('/api/questions/:id', requireAdmin, (req, res) => {
  const idx = DB.questions.findIndex(q => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'题目不存在' });
  const { number, name, category, content, images, code } = req.body;
  if (!number||!name) return res.status(400).json({ error:'编号和名称不能为空' });
  DB.questions[idx] = {
    ...DB.questions[idx],
    number: number.trim(),
    name: name.trim(),
    category: category ? category.trim() : '',
    content: content ? content.trim() : '',
    images: Array.isArray(images) ? images : DB.questions[idx].images || [],
    code: code ? code.trim() : '',
    updatedAt: new Date().toISOString()
  };
  scheduleWrite(QUESTIONS_FILE, DB.questions);
  res.json({ success: true, question: DB.questions[idx] });
});
app.delete('/api/questions/:id', requireAdmin, (req, res) => {
  const idx = DB.questions.findIndex(q => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'题目不存在' });
  const deleted = DB.questions.splice(idx, 1)[0];
  scheduleWrite(QUESTIONS_FILE, DB.questions);
  res.json({ success: true, deleted });
});

// ==================== 启动服务器 ====================
const useCluster = process.env.CLUSTER === 'true';

if (useCluster) {
  const cluster = require('cluster');
  const numCPUs = require('os').cpus().length;

  if (cluster.isMaster) {
    console.log(`🚀 启动 Cluster 模式，使用 ${numCPUs} 个进程`);
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }
    cluster.on('exit', (worker, code, signal) => {
      console.log(`💀 Worker ${worker.process.pid} 退出，重新启动...`);
      cluster.fork();
    });
  } else {
    startServer();
  }
} else {
  startServer();
}

function startServer() {
  (async () => {
    await loadAllData();
    await upgradePasswords();
    upgradeRoles();         // 将 admin 角色升级为 owner
    ensureOwner();          // 确保 zlm 为 owner

    app.listen(PORT, () => {
      console.log(`🚀 极速墨韵后端已启动，端口 ${PORT}`);
      console.log(`📡 REST API 服务就绪（权限：owner / admin / member）`);
      console.log(`🔑 所有者: zlm / zlm20130503`);
      console.log(`⛔ 禁止通过 API 创建 owner 账号`);
      if (useCluster) {
        console.log(`🧵 当前进程 PID: ${process.pid}`);
      }
    });
  })();
}

// 异常处理
process.on('uncaughtException', (err) => {
  console.error('❌ 未捕获异常:', err);
});
