(function() {
  const API_BASE = 'https://myzlm.serveousercontent.com';
  const APPLY_STORAGE_KEY = 'ink_nav_site_applications';
  const THEME_STORAGE_KEY = 'ink_nav_theme';
  const PINNED_STORAGE_KEY = 'ink_nav_pinned';
  const STARRED_STORAGE_KEY = 'ink_nav_starred';

  let currentUser = null;
  let sites = [];
  let siteApplications = JSON.parse(localStorage.getItem(APPLY_STORAGE_KEY) || '[]');
  let pinnedSites = JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY) || '[]');
  let starredSites = JSON.parse(localStorage.getItem(STARRED_STORAGE_KEY) || '[]');
  let currentFilter = 'all';
  let searchQuery = '';
  let isLoading = true;
  const isMobile = window.innerWidth < 768;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // 工具函数
  function escapeHtml(text) {
    const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  function showToast(message, type='info') {
    const container = $('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = {success:'✅', error:'❌', info:'💡'};
    toast.innerHTML = `<span>${icons[type]||'💡'}</span> ${escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => { if(toast.parentNode) toast.remove(); }, 2700);
  }

  async function apiCall(url, options={}, silent=false) {
    const config = {credentials:'include', headers:{'Content-Type':'application/json'}, ...options};
    if(config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
    try {
      const res = await fetch(API_BASE + url, config);
      if(!res.ok) {
        if(silent) return null;
        const data = await res.json().catch(()=>({}));
        throw new Error(data.error || `请求失败 (${res.status})`);
      }
      return await res.json();
    } catch(e) { if(silent) return null; throw e; }
  }

  // 主题
  function initTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if(saved === 'dark') {
      document.documentElement.setAttribute('data-theme','dark');
      $('#themeToggle').textContent = '☀️';
    } else {
      document.documentElement.setAttribute('data-theme','light');
      $('#themeToggle').textContent = '🌓';
    }
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    $('#themeToggle').textContent = next === 'dark' ? '☀️' : '🌓';
    showToast(next==='dark'?'已切换至暗色模式 🌙':'已切换至亮色模式 ☀️','info');
  }

  // 数据处理
  function getFilteredSites() {
    let filtered = [...sites];
    if(pinnedSites.length > 0) {
      const pinned=[], unpinned=[];
      filtered.forEach((site, index) => {
        const s = {...site, _originalIndex: index};
        if(pinnedSites.includes(index)) { s._pinned=true; pinned.push(s); }
        else { s._pinned=false; unpinned.push(s); }
      });
      filtered = [...pinned, ...unpinned];
    }
    if(starredSites.length > 0) {
      filtered.sort((a,b) => {
        const aStar = starredSites.includes(a._originalIndex ?? sites.indexOf(a)) ? 1 : 0;
        const bStar = starredSites.includes(b._originalIndex ?? sites.indexOf(b)) ? 1 : 0;
        if(a._pinned && !b._pinned) return -1;
        if(!a._pinned && b._pinned) return 1;
        return bStar - aStar;
      });
    }
    if(currentFilter !== 'all') filtered = filtered.filter(s => (s.category||'其他') === currentFilter);
    if(searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(s => (s.name||'').toLowerCase().includes(q) || (s.desc||'').toLowerCase().includes(q) || (s.url||'').toLowerCase().includes(q));
    }
    return filtered;
  }

  function getAllCategories() {
    const cats = new Set();
    sites.forEach(s => cats.add(s.category||'其他'));
    return ['all', ...Array.from(cats).sort()];
  }

  // 渲染函数
  function renderFilterTags() {
    const container = $('#filterTags');
    const categories = getAllCategories();
    container.innerHTML = categories.map(cat => {
      const label = cat==='all'?'全部':escapeHtml(cat);
      const active = cat===currentFilter?' active':'';
      return `<span class="filter-tag${active}" data-category="${escapeHtml(cat)}">${label}</span>`;
    }).join('');
    const countEl = $('#filterCount');
    const totalFiltered = getFilteredSites().length;
    countEl.textContent = (searchQuery.trim()||currentFilter!=='all')?`找到 ${totalFiltered} 个书签`:`共 ${sites.length} 个书签`;
    container.querySelectorAll('.filter-tag').forEach(tag => {
      tag.addEventListener('click', () => { currentFilter = tag.dataset.category; renderFilterTags(); renderSites(); });
    });
  }

  function updateUIByRole() {
    const greeting = $('#greetingText');
    const loginBtn = $('#loginBtn');
    const logoutBtn = $('#logoutBtn');
    const adminBtn = $('#adminPanelBtn');
    const adminPanel = $('#adminPanel');
    const changeMyPassBtn = $('#changeMyPassBtn');
    const applySiteBtn = $('#applySiteBtn');
    if(currentUser) {
      greeting.textContent = `${currentUser.role==='admin'?'🔰':'📖'} ${currentUser.username}`;
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
      changeMyPassBtn.style.display = 'inline-block';
      applySiteBtn.style.display = 'inline-block';
      if(currentUser.role === 'admin') { adminBtn.style.display='inline-block'; adminPanel.style.display='block'; }
      else { adminBtn.style.display='none'; adminPanel.style.display='none'; }
    } else {
      greeting.textContent = '未登录·游客';
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
      adminBtn.style.display = 'none';
      adminPanel.style.display = 'none';
      changeMyPassBtn.style.display = 'none';
      applySiteBtn.style.display = 'none';
    }
    renderSites(); renderFilterTags();
    if(currentUser?.role==='admin') renderAdminPanels();
  }

  function renderSites() {
    const grid = $('#sitesGrid');
    if(isLoading) {
      grid.innerHTML = Array.from({length:6},()=>`<div class="skeleton-card"><div class="skeleton-seal"></div><div class="skeleton-lines"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>`).join('');
      return;
    }
    const filtered = getFilteredSites();
    if(filtered.length === 0) {
      grid.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><p>${searchQuery.trim()||currentFilter!=='all'?'未找到匹配的书签':'暂无书签，登录后可申请收录'}</p></div>`;
      return;
    }
    grid.innerHTML = filtered.map((site) => {
      const originalIndex = site._originalIndex !== undefined ? site._originalIndex : sites.indexOf(site);
      const isStarred = starredSites.includes(originalIndex);
      return `
        <div class="site-card" data-index="${originalIndex}" data-url="${escapeHtml(site.url)}">
          <div class="seal">${escapeHtml(site.seal||'🔗')}</div>
          <div class="site-info">
            <div class="site-name">${site._pinned?'📌 ':''}${escapeHtml(site.name)}</div>
            <div class="site-desc">${escapeHtml(site.desc||'')}</div>
            <div class="site-meta">
              <span class="site-category">${escapeHtml(site.category||'其他')}</span>
              <span>👁️ ${site.visits||0}</span>
            </div>
          </div>
          <button class="star-btn ${isStarred?'starred':''}" data-star-index="${originalIndex}" title="收藏">${isStarred?'⭐':'☆'}</button>
        </div>`;
    }).join('');
    grid.querySelectorAll('.site-card').forEach(card => {
      card.addEventListener('click', function(e) {
        if(e.target.closest('.star-btn')) return;
        const url = this.dataset.url;
        const idx = parseInt(this.dataset.index);
        apiCall(`/api/sites/${idx}/visit`,{method:'POST'},true).catch(()=>{});
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    });
    grid.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); e.preventDefault();
        const idx = parseInt(this.dataset.starIndex);
        if(starredSites.includes(idx)) {
          starredSites = starredSites.filter(s => s!==idx);
          this.classList.remove('starred'); this.textContent = '☆';
        } else {
          starredSites.push(idx);
          this.classList.add('starred'); this.textContent = '⭐';
          spawnStarBurst(e.clientX, e.clientY);
        }
        localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify(starredSites));
        renderSites();
      });
    });
  }

  function spawnStarBurst(x,y) {
    const colors = ['#f0c840','#e8b830','#ffda60','#ffed90','#fff'];
    for(let i=0;i<14;i++) {
      const particle = document.createElement('div');
      const angle = (Math.PI*2/14)*i;
      const dist = 30+Math.random()*50;
      const size = 3+Math.random()*7;
      particle.style.cssText = `
        position:fixed; left:${x}px; top:${y}px; width:${size}px; height:${size}px;
        background:${colors[Math.floor(Math.random()*colors.length)]}; border-radius:50%;
        pointer-events:none; z-index:9998;
        animation:starBurstParticle 0.8s cubic-bezier(0.25,0.46,0.45,0.94) forwards;
        --dx:${Math.cos(angle)*dist}px; --dy:${Math.sin(angle)*dist}px;
      `;
      document.body.appendChild(particle);
      setTimeout(()=>particle.remove(),850);
    }
    if(!document.getElementById('starBurstStyle')) {
      const style = document.createElement('style');
      style.id = 'starBurstStyle';
      style.textContent = `@keyframes starBurstParticle{0%{opacity:1;transform:translate(0,0) scale(1);}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0);}}`;
      document.head.appendChild(style);
    }
  }

  // 管理面板
  function renderAdminPanels() { renderSiteManage(); renderUserManage(); renderApplyManage(); }
  function renderSiteManage() {
    const container = $('#siteListManage');
    container.innerHTML = sites.map((s,i) => `
      <div class="list-item">
        <span>${escapeHtml(s.name)} - <small>${escapeHtml(s.url)}</small></span>
        <div style="display:flex;gap:0.3rem;">
          <button class="btn icon-btn pin-toggle-btn" data-index="${i}">${pinnedSites.includes(i)?'📌':'📍'}</button>
          <button class="btn" data-del-site="${i}">删除</button>
        </div>
      </div>`).join('');
    container.querySelectorAll('[data-del-site]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if(!confirm('确认删除？')) return;
        try {
          await apiCall(`/api/sites/${e.target.dataset.delSite}`,{method:'DELETE'});
          const idx = parseInt(e.target.dataset.delSite);
          pinnedSites = pinnedSites.filter(p=>p!==idx).map(p=>p>idx?p-1:p);
          starredSites = starredSites.filter(s=>s!==idx).map(s=>s>idx?s-1:s);
          localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedSites));
          localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify(starredSites));
          await refreshSites(); showToast('网站已删除','success');
        } catch(err) { showToast('删除失败: '+err.message,'error'); }
      });
    });
    container.querySelectorAll('.pin-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        if(pinnedSites.includes(idx)) { pinnedSites = pinnedSites.filter(p=>p!==idx); showToast('已取消置顶','info'); }
        else { pinnedSites.push(idx); showToast('已置顶','success'); }
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedSites));
        renderSiteManage(); renderSites();
      });
    });
  }

  async function refreshSites() {
    try { sites = await apiCall('/api/sites'); isLoading=false; renderSites(); renderFilterTags(); if(currentUser?.role==='admin') renderSiteManage(); }
    catch(e) { isLoading=false; renderSites(); renderFilterTags(); }
  }

  async function refreshUsersAndRender() {
    if(!currentUser||currentUser.role!=='admin') return;
    try { const users = await apiCall('/api/users'); renderUserList(users); } catch(e) {}
  }
  function renderUserManage() { refreshUsersAndRender(); }
  function renderUserList(users) {
    const container = $('#userListManage');
    container.innerHTML = users.map(u => `
      <div class="list-item"><span>${escapeHtml(u.username)}</span><div style="display:flex;gap:0.3rem;"><button class="btn change-pass-btn" data-username="${escapeHtml(u.username)}">改密</button>${u.username!=='zlm'?`<button class="btn del-user-btn" data-username="${escapeHtml(u.username)}">删除</button>`:''}</div></div>`).join('');
    container.querySelectorAll('.del-user-btn').forEach(btn => { btn.addEventListener('click', async (e) => { if(!confirm('删除用户？')) return; try { await apiCall(`/api/users/${encodeURIComponent(e.target.dataset.username)}`,{method:'DELETE'}); refreshUsersAndRender(); showToast('用户已删除','success'); } catch(err) { showToast('删除失败: '+err.message,'error'); } }); });
    container.querySelectorAll('.change-pass-btn').forEach(btn => { btn.addEventListener('click', (e) => openChangePassModal(e.target.dataset.username)); });
  }

  function openChangePassModal(username) { $('#changePassUser').value = username; $('#changePassNew').value = ''; $('#changePassModal').classList.add('active'); }
  function renderApplyManage() {
    const container = $('#applyListManage');
    if(!siteApplications.length) { container.innerHTML = '<p style="color:var(--text-muted);">暂无待审核的网站申请。</p>'; return; }
    container.innerHTML = siteApplications.map((app,idx) => `
      <div class="list-item"><span>${escapeHtml(app.name)} (${escapeHtml(app.url)})</span><div><button class="btn approve-site-btn" data-index="${idx}">通过</button><button class="btn reject-site-btn" data-index="${idx}">拒绝</button></div></div>`).join('');
    container.querySelectorAll('.approve-site-btn').forEach(btn => { btn.addEventListener('click', async (e) => { const idx = e.target.dataset.index; const app = siteApplications[idx]; try { await apiCall('/api/sites',{method:'POST',body:{name:app.name,url:app.url,desc:app.desc||'',seal:app.seal||'🔗',category:app.category||'其他'}}); siteApplications.splice(idx,1); localStorage.setItem(APPLY_STORAGE_KEY,JSON.stringify(siteApplications)); await refreshSites(); renderApplyManage(); showToast('网站已添加','success'); } catch(err) { showToast('添加失败: '+err.message,'error'); } }); });
    container.querySelectorAll('.reject-site-btn').forEach(btn => { btn.addEventListener('click', (e) => { const idx = e.target.dataset.index; if(confirm('拒绝该申请？')) { siteApplications.splice(idx,1); localStorage.setItem(APPLY_STORAGE_KEY,JSON.stringify(siteApplications)); renderApplyManage(); showToast('已拒绝','info'); } }); });
  }

  async function checkLoginStatus() {
    const data = await apiCall('/api/me',{},true);
    if(data?.username) currentUser = data;
    else currentUser = null;
    updateUIByRole();
    if(currentUser?.role==='admin') refreshUsersAndRender();
  }

  // 特效初始化 (性能优化版)
  function initStars() {
    const container = $('#starsContainer');
    const count = isMobile ? 15 : 30;
    let html = '';
    for(let i=0;i<count;i++) {
      const size = 1+Math.random()*2.5;
      html += `<div class="star" style="left:${Math.random()*100}%;top:${Math.random()*100}%;width:${size}px;height:${size}px;--dur:${2+Math.random()*5}s;--delay:${Math.random()*6}s;"></div>`;
    }
    container.innerHTML = html;
  }

  function initClouds() {
    const container = $('#cloudsContainer');
    const count = isMobile ? 5 : 9;
    for(let i=0;i<count;i++) {
      const cloud = document.createElement('div');
      cloud.className = 'cloud';
      const size = 110+Math.random()*120;
      cloud.style.width = size+'px';
      cloud.style.height = size*0.6+'px';
      cloud.style.top = (5+Math.random()*60)+'%';
      cloud.style.animationDuration = (20+Math.random()*25)+'s';
      cloud.style.animationDelay = Math.random()*10+'s';
      container.appendChild(cloud);
    }
  }

  function initPetals() {
    const canvas = $('#petalCanvas');
    const ctx = canvas.getContext('2d');
    let width, height;
    const petals = [];
    const count = isMobile ? 6 : 12;
    function resize() { width=window.innerWidth; height=window.innerHeight; canvas.width=width; canvas.height=height; }
    window.addEventListener('resize', resize); resize();
    class Petal {
      constructor() { this.reset(true); }
      reset(initial=false) { this.x=Math.random()*width; this.y=initial?Math.random()*height:-25; this.size=6+Math.random()*10; this.speedY=0.6+Math.random()*1.8; this.speedX=0.1+Math.random()*0.5; this.rotation=Math.random()*Math.PI*2; this.rotSpeed=(Math.random()-0.5)*0.012; this.opacity=0.5+Math.random()*0.4; this.hue=330+Math.random()*25; }
      update() { this.y+=this.speedY; this.x+=Math.sin(this.y*0.015)*this.speedX; this.rotation+=this.rotSpeed; if(this.y>height+30) this.reset(); }
      draw(ctx) { ctx.save(); ctx.translate(this.x,this.y); ctx.rotate(this.rotation); ctx.fillStyle=`hsla(${this.hue},40%,70%,${this.opacity})`; ctx.beginPath(); ctx.ellipse(0,0,this.size*0.5,this.size*0.25,0,0,Math.PI*2); ctx.fill(); ctx.restore(); }
    }
    for(let i=0;i<count;i++) petals.push(new Petal());
    function animate() { ctx.clearRect(0,0,width,height); petals.forEach(p=>{p.update();p.draw(ctx);}); requestAnimationFrame(animate); }
    animate();
  }

  function initPoems() {
    const canvas = $('#poemCanvas');
    const ctx = canvas.getContext('2d');
    let width, height;
    const poems = ['静','思','墨','韵','雅','书','画','禅','云','风','月','山','水','花','竹'];
    const items = [];
    const count = isMobile ? 4 : 10;
    function resize() { width=window.innerWidth; height=window.innerHeight; canvas.width=width; canvas.height=height; }
    window.addEventListener('resize', resize); resize();
    class PoemChar {
      constructor() { this.reset(true); }
      reset(initial=false) { this.x=Math.random()*width; this.y=initial?Math.random()*height:-40; this.char=poems[Math.floor(Math.random()*poems.length)]; this.size=14+Math.random()*18; this.speedY=0.2+Math.random()*0.6; this.speedX=(Math.random()-0.5)*0.25; this.opacity=0.3+Math.random()*0.4; this.wobble=Math.random()*Math.PI*2; this.wobbleSpeed=0.01+Math.random()*0.02; }
      update() { this.y+=this.speedY; this.wobble+=this.wobbleSpeed; this.x+=Math.sin(this.wobble)*this.speedX; if(this.y>height+30) this.reset(); }
      draw(ctx) { ctx.save(); ctx.font=`${this.size}px 'Ma Shan Zheng','KaiTi',serif`; ctx.fillStyle=`rgba(70,45,25,${this.opacity})`; if(document.documentElement.getAttribute('data-theme')==='dark') ctx.fillStyle=`rgba(200,180,150,${this.opacity})`; ctx.fillText(this.char, this.x, this.y); ctx.restore(); }
    }
    for(let i=0;i<count;i++) items.push(new PoemChar());
    function animate() { ctx.clearRect(0,0,width,height); items.forEach(p=>{p.update();p.draw(ctx);}); requestAnimationFrame(animate); }
    animate();
  }

  function initRipples() {
    const canvas = $('#rippleCanvas');
    const ctx = canvas.getContext('2d');
    let width, height;
    const ripples = [];
    const maxRipples = 12;
    function resize() { width=window.innerWidth; height=window.innerHeight; canvas.width=width; canvas.height=height; }
    window.addEventListener('resize', resize); resize();
    function addRipple(x, y) {
      ripples.push({
        x, y,
        radius: 2,
        maxRadius: 30 + Math.random() * 70,
        opacity: 0.65,
        speed: 0.6 + Math.random() * 0.7,
        life: 1.0
      });
      if (ripples.length > maxRipples) ripples.shift();
    }
    window.addEventListener('click', (e) => addRipple(e.clientX, e.clientY));
    window.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) addRipple(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    function drawRipple(ctx, r) {
      const gradient = ctx.createRadialGradient(r.x, r.y, r.radius * 0.1, r.x, r.y, r.radius);
      gradient.addColorStop(0, `rgba(20, 15, 10, ${r.opacity * 0.9})`);
      gradient.addColorStop(0.4, `rgba(40, 30, 20, ${r.opacity * 0.7})`);
      gradient.addColorStop(0.8, `rgba(80, 60, 40, ${r.opacity * 0.3})`);
      gradient.addColorStop(1, `rgba(120, 90, 60, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.fill();
      // 金色光圈
      ctx.strokeStyle = `rgba(180, 150, 100, ${r.opacity * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }
    function animate() {
      ctx.clearRect(0, 0, width, height);
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += r.speed;
        r.opacity -= 0.006;
        r.life -= 0.008;
        if (r.opacity <= 0 || r.radius > r.maxRadius || r.life <= 0) {
          ripples.splice(i, 1);
        } else {
          drawRipple(ctx, r);
        }
      }
      requestAnimationFrame(animate);
    }
    animate();
  }

  function initFireflies() {
    const canvas = $('#fireflyCanvas');
    const ctx = canvas.getContext('2d');
    let width, height;
    const fireflies = [];
    const count = isMobile ? 6 : 18;
    let mouseX = -200, mouseY = -200;
    function resize() { width = window.innerWidth; height = window.innerHeight; canvas.width = width; canvas.height = height; }
    window.addEventListener('resize', resize); resize();
    document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) { mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY; }
    }, { passive: true });
    class Firefly {
      constructor() { this.reset(); }
      reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.targetX = this.x;
        this.targetY = this.y;
        this.size = 2 + Math.random() * 4;
        this.glowSize = this.size * 4 + Math.random() * 10;
        this.opacity = 0.4 + Math.random() * 0.5;
        this.phase = Math.random() * Math.PI * 2;
        this.speed = 0.4 + Math.random() * 0.6;
        this.changeTargetTime = 0;
        this.followMouse = Math.random() < 0.4; // 40%概率跟随鼠标
      }
      update() {
        this.changeTargetTime--;
        if (this.changeTargetTime <= 0) {
          if (this.followMouse && mouseX > 0 && Math.random() < 0.6) {
            // 向鼠标位置靠近
            this.targetX = mouseX + (Math.random() - 0.5) * 80;
            this.targetY = mouseY + (Math.random() - 0.5) * 70;
          } else {
            this.targetX = this.x + (Math.random() - 0.5) * 200;
            this.targetY = this.y + (Math.random() - 0.5) * 160;
          }
          this.targetX = Math.max(10, Math.min(width - 10, this.targetX));
          this.targetY = Math.max(10, Math.min(height - 10, this.targetY));
          this.changeTargetTime = 40 + Math.random() * 80;
        }
        // 平滑向目标移动
        this.x += (this.targetX - this.x) * 0.025 * this.speed;
        this.y += (this.targetY - this.y) * 0.025 * this.speed;
        this.phase += 0.04;
        this.opacity = 0.4 + Math.sin(this.phase) * 0.35;
      }
      draw(ctx) {
        const glow = ctx.createRadialGradient(this.x, this.y, this.size * 0.2, this.x, this.y, this.glowSize);
        glow.addColorStop(0, `rgba(255, 230, 150, ${this.opacity})`);
        glow.addColorStop(0.3, `rgba(240, 200, 100, ${this.opacity * 0.8})`);
        glow.addColorStop(0.7, `rgba(200, 160, 60, ${this.opacity * 0.25})`);
        glow.addColorStop(1, 'rgba(180, 140, 50, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.glowSize, 0, Math.PI * 2);
        ctx.fill();
        // 亮点
        ctx.fillStyle = `rgba(255, 255, 220, ${this.opacity + 0.2})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < count; i++) fireflies.push(new Firefly());
    function animate() {
      ctx.clearRect(0, 0, width, height);
      fireflies.forEach(f => { f.update(); f.draw(ctx); });
      requestAnimationFrame(animate);
    }
    animate();
  }

  function initBackToTop() {
    const btn = $('#backToTop');
    window.addEventListener('scroll', () => {
      if (window.scrollY > 400) btn.classList.add('visible');
      else btn.classList.remove('visible');
    }, { passive: true });
    btn.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  // 事件绑定
  function bindEvents() {
    $('#themeToggle').addEventListener('click', toggleTheme);
    const searchInput = $('#searchInput');
    const searchClear = $('#searchClear');
    let searchDebounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQuery = searchInput.value;
        searchClear.classList.toggle('visible', !!searchQuery.trim());
        renderFilterTags(); renderSites();
      }, 200);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value=''; searchQuery=''; searchClear.classList.remove('visible');
      renderFilterTags(); renderSites(); searchInput.focus();
    });
    document.addEventListener('keydown', (e) => {
      if((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
      if(e.key==='Escape' && document.activeElement===searchInput) {
        searchInput.value=''; searchQuery=''; searchClear.classList.remove('visible');
        renderFilterTags(); renderSites(); searchInput.blur();
      }
      if(e.key==='/' && !e.target.closest('input,textarea')) { e.preventDefault(); searchInput.focus(); }
    });

    // 登录
    $('#loginBtn').addEventListener('click', () => $('#loginModal').classList.add('active'));
    $('#closeLoginModal').addEventListener('click', () => $('#loginModal').classList.remove('active'));
    $('#submitLogin').addEventListener('click', async () => {
      const u = $('#loginUsername').value.trim(), p = $('#loginPassword').value;
      if(!u||!p) return showToast('请输入账号和密码','error');
      try {
        const data = await apiCall('/api/login',{method:'POST',body:{username:u,password:p}});
        currentUser = {username:data.username, role:data.role};
        $('#loginModal').classList.remove('active');
        updateUIByRole();
        if(currentUser.role==='admin') refreshUsersAndRender();
        showToast(`登录成功，欢迎 ${data.username}`,'success');
      } catch(err) { showToast('登录失败: '+err.message,'error'); }
    });
    $('#logoutBtn').addEventListener('click', async () => {
      await apiCall('/api/logout',{method:'POST'}); currentUser=null; updateUIByRole(); showToast('已登出','info');
    });
    $('#adminPanelBtn').addEventListener('click', () => {
      const panel=$('#adminPanel'); panel.style.display = panel.style.display==='none'?'block':'none';
    });
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        $$('.tab-btn').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $$('.tab-content').forEach(c=>c.classList.remove('active'));
        $('#'+this.dataset.tab).classList.add('active');
      });
    });

    // 添加网站
    $('#addSiteBtn').addEventListener('click', async () => {
      const name=$('#newSiteName').value.trim(), url=$('#newSiteUrl').value.trim();
      if(!name||!url) return showToast('名称和网址必填','error');
      try {
        await apiCall('/api/sites',{method:'POST',body:{name,url,desc:$('#newSiteDesc').value.trim(),seal:$('#newSiteSeal').value.trim()||'🔗',category:$('#newSiteCat').value.trim()||'其他'}});
        ['newSiteName','newSiteUrl','newSiteDesc','newSiteSeal','newSiteCat'].forEach(id=>$('#'+id).value='');
        await refreshSites(); showToast('网站已添加','success');
      } catch(err) { showToast(err.message,'error'); }
    });
    // 添加用户
    $('#addUserBtn').addEventListener('click', async () => {
      const u=$('#newUsername').value.trim(), p=$('#newUserPass').value;
      if(!u||!p) return showToast('用户名和密码不能为空','error');
      try {
        await apiCall('/api/users',{method:'POST',body:{username:u,password:p}});
        $('#newUsername').value=''; $('#newUserPass').value='';
        refreshUsersAndRender(); showToast('用户已添加','success');
      } catch(err) { showToast(err.message,'error'); }
    });

    // 管理员改密（安全接口）
    $('#submitChangePass').addEventListener('click', async () => {
      const username = $('#changePassUser').value;
      const newPass = $('#changePassNew').value;
      if (!newPass) return showToast('请输入新密码', 'error');
      if (newPass.length < 6) return showToast('密码长度至少6位', 'error');
      try {
        await apiCall(`/api/users/${encodeURIComponent(username)}/password`, {
          method: 'PUT',
          body: { newPassword: newPass }
        });
        showToast('密码修改成功', 'success');
        $('#changePassModal').classList.remove('active');
        refreshUsersAndRender();
      } catch (err) {
        showToast('密码修改失败: ' + (err.message.includes('404') ? '后端接口未实现' : err.message), 'error');
      }
    });
    $('#closeChangePassModal').addEventListener('click', () => $('#changePassModal').classList.remove('active'));

    // 成员自助改密
    $('#changeMyPassBtn').addEventListener('click', () => {
      $('#selfOldPass').value=''; $('#selfNewPass').value=''; $('#selfChangePassModal').classList.add('active');
    });
    $('#closeSelfChangePassModal').addEventListener('click', () => $('#selfChangePassModal').classList.remove('active'));
    $('#submitSelfChangePass').addEventListener('click', async () => {
      const op=$('#selfOldPass').value, np=$('#selfNewPass').value;
      if(!op||!np) return showToast('请输入旧密码和新密码','error');
      if(np.length<6) return showToast('新密码长度至少6位','error');
      try {
        await apiCall('/api/me/password',{method:'PUT',body:{oldPassword:op,newPassword:np}});
        showToast('密码修改成功','success');
        $('#selfChangePassModal').classList.remove('active');
      } catch(err) { showToast('修改失败: '+err.message,'error'); }
    });

    // 申请网站
    $('#applySiteBtn').addEventListener('click', () => {
      $('#applyName').value=''; $('#applyUrl').value=''; $('#applyDesc').value='';
      $('#applySeal').value=''; $('#applyCat').value=''; $('#applyModal').classList.add('active');
    });
    $('#closeApplyModal').addEventListener('click', () => $('#applyModal').classList.remove('active'));
    $('#submitApply').addEventListener('click', () => {
      const name=$('#applyName').value.trim(), url=$('#applyUrl').value.trim();
      if(!name||!url) return showToast('网站名称和网址为必填项','error');
      siteApplications.push({
        name, url,
        desc:$('#applyDesc').value.trim(),
        seal:$('#applySeal').value.trim()||'🔗',
        category:$('#applyCat').value.trim()||'其他'
      });
      localStorage.setItem(APPLY_STORAGE_KEY,JSON.stringify(siteApplications));
      showToast('申请已提交','success');
      $('#applyModal').classList.remove('active');
    });

    // 关闭模态框
    window.addEventListener('click', (e) => {
      if(e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
    });
  }

  // 启动
  async function init() {
    initTheme();
    initStars();
    initClouds();
    initPetals();
    initPoems();
    initRipples();
    initFireflies();
    initBackToTop();
    bindEvents();
    try { sites = await apiCall('/api/sites'); isLoading=false; } catch(e) { sites=[]; isLoading=false; }
    await checkLoginStatus();
    renderSites();
    renderFilterTags();
  }
  init();
})();
