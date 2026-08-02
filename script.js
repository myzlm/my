(function() {
    var API_BASE = 'https://myzlm.serveousercontent.com';
    var $ = function(s) { return document.querySelector(s); };
    var $$ = function(s) { return document.querySelectorAll(s); };

    // 标记库初始化（marked、hljs 已在 HTML 引入）
    if (typeof mermaid !== 'undefined') mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    if (typeof marked !== 'undefined') {
        var renderer = new marked.Renderer();
        renderer.code = function(code, lang) {
            if (lang === 'mermaid') return '<pre class="mermaid">' + code + '</pre>';
            try { return '<pre><code class="hljs">' + hljs.highlight(code, { language: lang || 'plaintext' }).value + '</code></pre>'; }
            catch (e) { return '<pre><code>' + code + '</code></pre>'; }
        };
        marked.use({ renderer: renderer });
    }

    function escapeHtml(t) { var m = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}; return String(t).replace(/[&<>"']/g, c => m[c]); }
    function showToast(msg, type) { type = type || 'success'; var c = $('#toastContainer'); var d = document.createElement('div'); d.className = 'toast toast-' + type; d.textContent = msg; c.appendChild(d); setTimeout(function(){ d.remove(); }, 3000); }
    function formatDate(d) { if (!d) return ''; var dt = new Date(d); var ch = ['', '元月','杏月','桃月','槐月','榴月','荷月','兰月','桂月','菊月','露月','葭月','腊月']; var m = dt.getMonth()+1; var g = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸']; var z = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥']; return g[(dt.getFullYear()-4)%10] + z[(dt.getFullYear()-4)%12] + '年·' + (ch[m]||m+'月') + dt.getDate() + '日'; }
    function calcReadTime(t) { var w = (t||'').replace(/[^\u4e00-\u9fa5a-zA-Z]/g,'').length; return Math.max(1, Math.round(w/400)); }

    var currentUser = null, articles = [], pendingApps = [], currentView = 'list', pendingDeleteId = null, activeTag = null;
    var currentTab = 'articles', applyQuotaRemaining = 0, annotationMode = false, currentAnnotationPos = null, currentArticleId = null;
    var currentSkin = 'default';

    // 权限辅助
    function isAdmin() { return currentUser && (currentUser.role === 'admin' || currentUser.role === 'owner'); }
    function isOwner() { return currentUser && currentUser.role === 'owner'; }
    function isLoggedIn() { return !!currentUser; }

    async function apiCall(url, opt, silent) {
        opt = opt || {}; silent = silent || false;
        var config = { credentials: 'include', headers: { 'Content-Type': 'application/json' } };
        if (opt.method) config.method = opt.method;
        if (opt.body && typeof opt.body === 'object') config.body = JSON.stringify(opt.body);
        try {
            var res = await fetch(API_BASE + url, config);
            if (!res.ok) { if (silent) return null; var d = await res.json().catch(function(){ return {}; }); throw new Error(d.error || '请求失败 ('+res.status+')'); }
            var txt = await res.text(); return txt ? JSON.parse(txt) : null;
        } catch (e) { if (silent) return null; throw e; }
    }

    // 皮肤
    function applySkin(skin) {
        document.body.classList.remove('skin-default','skin-bamboo','skin-jade');
        if (skin === 'default') document.body.classList.add('skin-default'); else document.body.classList.add('skin-'+skin);
        currentSkin = skin; localStorage.setItem('blog_skin', skin);
        document.querySelectorAll('.skin-btn').forEach(function(btn){ btn.classList.toggle('active', btn.dataset.skin === skin); });
        clearAnnotations(); toggleAnnotationMode(false); updateAnnotateButtonVisibility();
        if (currentView === 'detail') resetJadeDecorations();
    }
    function clearAnnotations() { document.querySelectorAll('.annotation-tag').forEach(function(tag){ tag.remove(); }); }
    function resetJadeDecorations() {
        var detail = $('#articleDetailContent'); if (!detail) return;
        detail.querySelectorAll('.jade-axis, .jade-seal').forEach(function(el){ el.remove(); });
        if (currentSkin === 'jade') {
            var leftAxis = document.createElement('div'); leftAxis.className = 'jade-axis left';
            var rightAxis = document.createElement('div'); rightAxis.className = 'jade-axis right';
            var seal = document.createElement('div'); seal.className = 'jade-seal'; seal.textContent = '受命于天\n既寿永昌';
            detail.appendChild(leftAxis); detail.appendChild(rightAxis); detail.appendChild(seal);
            setTimeout(function(){ seal.classList.add('show-seal'); }, 2500);
            var content = detail.querySelector('.detail-content'); if (content) { content.style.animation = 'none'; void content.offsetHeight; content.style.animation = ''; }
        }
    }
    function updateAnnotateButtonVisibility() { var btn = $('#annotateToggle'); if (btn) btn.style.display = currentSkin === 'jade' ? 'block' : 'none'; }
    function toggleAnnotationMode(force) {
        annotationMode = force !== undefined ? force : !annotationMode;
        var detail = $('#articleDetailContent'); if (!detail) return;
        if (annotationMode) { detail.classList.add('annotation-mode'); $('#annotateToggle').textContent = '退出批注'; }
        else { detail.classList.remove('annotation-mode'); $('#annotateToggle').textContent = '🖌️ 朱批'; hideAnnotationInput(); }
    }
    function hideAnnotationInput() { var box = $('#annotationInputBox'); if (box) { box.style.display = 'none'; $('#annotationText').value = ''; } }

    async function checkLogin() { var data = await apiCall('/api/me', {}, true); currentUser = (data && data.username) ? data : null; updateUI(); }
    function updateUI() {
        var g = $('#greetingText'), l = $('#loginBtn'), o = $('#logoutBtn'), a = $('#adminPanelBtn'), n = $('#newArticleBtn'), ap = $('#applyArticleBtn');
        if (currentUser) {
            var roleLabel = currentUser.role === 'owner' ? '👑 盟主' : (currentUser.role === 'admin' ? '🔰 执事' : '📖 成员');
            g.textContent = roleLabel + ' ' + currentUser.username;
            l.classList.add('hidden'); o.classList.remove('hidden');
            if (isAdmin()) { a.classList.remove('hidden'); n.classList.remove('hidden'); ap.classList.add('hidden'); }
            else { a.classList.add('hidden'); n.classList.add('hidden'); ap.classList.remove('hidden'); }
        } else { g.textContent = '未登录·过客'; l.classList.remove('hidden'); o.classList.add('hidden'); a.classList.add('hidden'); n.classList.add('hidden'); ap.classList.add('hidden'); }
        if (currentView === 'list') { renderList(); renderTags(); }
        if (currentView === 'admin') renderAdmin();
        updateApplyQuota();
    }
    async function login(u, p) { var data = await apiCall('/api/login', { method: 'POST', body: { username: u, password: p } }); currentUser = { username: data.username, role: data.role }; updateUI(); showToast('欢迎回来，'+data.username); }
    async function logout() { await apiCall('/api/logout', { method: 'POST' }, true); currentUser = null; updateUI(); showToast('已登出'); switchView('list'); }
    function switchView(v) {
        currentView = v;
        $$('.view').forEach(function(view){ view.classList.remove('active'); });
        var target = $('#view' + v.charAt(0).toUpperCase() + v.slice(1)); if (target) target.classList.add('active');
        if (v === 'list') { renderList(); renderTags(); } else if (v === 'admin') { currentTab = 'articles'; renderAdmin(); }
        window.scrollTo({ top: 0 });
    }

    // 数据加载
    async function loadArticles() { try { var data = await apiCall('/api/articles'); articles = Array.isArray(data) ? data : []; } catch (e) { articles = []; } articles.sort(function(a,b){ return (b.pinned?1:0)-(a.pinned?1:0) || new Date(b.createdAt)-new Date(a.createdAt); }); }
    async function loadApplications() { if (!isAdmin()) return; try { pendingApps = await apiCall('/api/article-applications'); } catch (e) { pendingApps = []; } $('#pendingCount').textContent = pendingApps.length; if (currentTab === 'review') renderReview(); }
    async function updateApplyQuota() { if (!isLoggedIn() || isAdmin()) { $('#applyQuota').classList.add('hidden'); return; } try { var data = await apiCall('/api/apply-quota'); applyQuotaRemaining = data.remaining; $('#applyQuota').textContent = '剩余 ' + applyQuotaRemaining + ' 次'; $('#applyQuota').classList.remove('hidden'); } catch(e) { $('#applyQuota').classList.add('hidden'); } }

    function getFiltered() { var s = $('#searchInput') ? $('#searchInput').value.trim().toLowerCase() : ''; return articles.filter(function(a) { var ms = true; if (s) { var t = (a.title||'').toLowerCase(), sm = (a.summary||'').toLowerCase(), tg = (a.tags||[]).join(' ').toLowerCase(); ms = t.includes(s) || sm.includes(s) || tg.includes(s); } return ms && (!activeTag || (a.tags && a.tags.includes(activeTag))); }); }
    function renderList() {
        var grid = $('#articlesGrid'), empty = $('#emptyState'); var filtered = getFiltered();
        if (!filtered.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');
        grid.innerHTML = filtered.map(function(a) {
            return '<div class="article-card'+ (a.pinned?' pinned':'') +'" data-id="'+ escapeHtml(a.id) +'">'+
                '<div class="card-header"><span class="card-title">'+ escapeHtml(a.title) +'</span><span class="card-seal">'+ escapeHtml(a.seal||'墨') +'</span></div>'+
                '<p class="card-summary">'+ escapeHtml(a.summary||'') +'</p>'+
                '<div class="card-meta"><span class="card-date">'+ formatDate(a.createdAt) +'</span><span class="reading-time">'+ calcReadTime(a.content) +' 分钟</span>'+
                (a.tags||[]).map(function(t){ return '<span class="card-tag">'+ escapeHtml(t) +'</span>'; }).join('') +
                '<span class="author-badge">'+ escapeHtml(a.author||'佚名') +'</span></div></div>';
        }).join('');
        grid.onclick = function(e) { var card = e.target.closest('.article-card'); if (card) viewArticle(card.dataset.id); };
        apply3DTilt();
    }
    function renderTags() {
        var all = {}; articles.forEach(function(a){ (a.tags||[]).forEach(function(t){ all[t]=true; }); }); var arr = Object.keys(all);
        $('#tagFilter').innerHTML = '<span class="tag-chip'+ (activeTag?'':' active') +'" data-tag="">全部</span>' +
            arr.map(function(t){ return '<span class="tag-chip'+(activeTag===t?' active':'')+'" data-tag="'+ escapeHtml(t) +'">'+ escapeHtml(t) +'</span>'; }).join('');
        $('#tagFilter').onclick = function(e) { if (e.target.classList.contains('tag-chip')) { activeTag = e.target.dataset.tag || null; renderList(); renderTags(); } };
    }

    async function viewArticle(id) {
        try { var a = await apiCall('/api/articles/'+encodeURIComponent(id)); if (!a) { showToast('文章不存在','error'); return; }
            renderDetail(a); switchView('detail'); currentArticleId = id; } catch(e) { showToast('加载失败: '+e.message,'error'); }
    }
    function renderDetail(a) {
        var container = $('#articleDetailContent');
        var raw = a.content || '';
        try { var contentHtml = typeof marked !== 'undefined' ? marked.parse(raw) : escapeHtml(raw).replace(/\n/g,'<br>'); } catch(e) { contentHtml = escapeHtml(raw).replace(/\n/g,'<br>'); }
        container.innerHTML = '<div class="detail-halo"></div><div class="detail-header"><h1 class="detail-title">'+ escapeHtml(a.title) +'</h1><div class="detail-meta"><span>📅 '+ formatDate(a.createdAt) +'</span>'+
            (a.tags||[]).map(function(t){ return '<span class="detail-tag">'+ escapeHtml(t) +'</span>'; }).join('') +
            '<span class="author-badge" style="margin-left:auto;">'+ escapeHtml(a.author||'佚名') +'</span></div></div>'+
            '<div class="detail-content">'+ contentHtml +'</div><div class="detail-actions"></div><button class="btn btn-sm annotate-btn" id="annotateToggle">🖌️ 朱批</button>';
        container.querySelector('.detail-content').addEventListener('click', function(e) {
            if (!annotationMode || currentSkin !== 'jade') return;
            var rect = container.getBoundingClientRect();
            var x = ((e.clientX - rect.left) / rect.width * 100).toFixed(2);
            var y = ((e.clientY - rect.top) / rect.height * 100).toFixed(2);
            currentAnnotationPos = {x: x, y: y};
            $('#annotationModal').classList.add('active');
            $('#annotationText').focus();
        });
        var annotateBtn = document.getElementById('annotateToggle');
        if (annotateBtn) annotateBtn.addEventListener('click', function(){ toggleAnnotationMode(); });
        if (a.annotations) a.annotations.forEach(function(ann){ addAnnotationTag(ann.x, ann.y, ann.text); });
        resetJadeDecorations();
        updateAnnotateButtonVisibility();
        try { if (typeof renderMathInElement === 'function') renderMathInElement(container, { delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}], throwOnError: false }); } catch(e) {}
        try { var mn = container.querySelectorAll('.mermaid'); if (mn.length > 0) mermaid.run({ nodes: mn }); } catch(e) {}
        if (isAdmin()) {
            var actions = container.querySelector('.detail-actions');
            actions.innerHTML = '<button class="btn btn-sm" onclick="window._blogApp.editArticle(\''+ escapeHtml(a.id) +'\')">✏️ 编辑</button>'+
                '<button class="btn btn-sm btn-danger" onclick="window._blogApp.confirmDeleteArticle(\''+ escapeHtml(a.id) +'\',\''+ escapeHtml(a.title||'') +'\')">🗑️ 删除</button>';
        }
    }
    function addAnnotationTag(x, y, text) {
        var tag = document.createElement('div'); tag.className = 'annotation-tag';
        tag.style.left = x + '%'; tag.style.top = y + '%'; tag.textContent = text;
        $('#articleDetailContent').appendChild(tag);
    }

    // 编辑器
    async function openEditor(id) {
        var modal = $('#articleModal'), titleEl = $('#articleModalTitle'), submitBtn = $('#submitArticle');
        if (id) {
            var a = await apiCall('/api/articles/'+encodeURIComponent(id)); if (!a) { showToast('文章不存在','error'); return; }
            titleEl.textContent = '✏️ 编辑文章'; submitBtn.textContent = '保 存';
            $('#articleTitle').value = a.title||''; $('#articleSummary').value = a.summary||''; $('#articleTags').value = (a.tags||[]).join(', ');
            $('#articleSeal').value = a.seal||'墨'; $('#articleContent').value = a.content||''; $('#articlePinned').checked = !!a.pinned; $('#articleEditId').value = id;
        } else {
            titleEl.textContent = '📝 撰写新篇'; submitBtn.textContent = '发 布';
            $('#articleTitle').value = ''; $('#articleSummary').value = ''; $('#articleTags').value = ''; $('#articleSeal').value = '墨';
            $('#articleContent').value = ''; $('#articlePinned').checked = false; $('#articleEditId').value = '';
        }
        modal.classList.add('active');
    }
    async function submitArticle() {
        var title = $('#articleTitle').value.trim(), content = $('#articleContent').value.trim();
        if (!title || !content) return showToast('标题和内容不能为空','error');
        var data = { title: title, content: content, summary: $('#articleSummary').value.trim(), tags: $('#articleTags').value.split(',').map(function(t){ return t.trim(); }).filter(Boolean), seal: $('#articleSeal').value.trim()||'墨', pinned: $('#articlePinned').checked };
        var editId = $('#articleEditId').value;
        try {
            if (editId) { await apiCall('/api/articles/'+encodeURIComponent(editId), { method:'PUT', body: data }); showToast('文章已更新'); }
            else { await apiCall('/api/articles', { method:'POST', body: data }); showToast('文章已发布'); }
            $('#articleModal').classList.remove('active');
            await loadArticles();
            if (currentView==='list') { renderList(); renderTags(); } else if (currentView==='admin') renderAdmin();
        } catch(e) { showToast('操作失败: '+e.message,'error'); }
    }
    function confirmDel(id, title) {    function confirmDel(id, title) { pendingDeleteId = id; $('#confirmModal').classList.add('active'); $('#confirmModal').querySelector('p').text pendingDeleteId = id; $('#confirmModal').classList.add('active'); $('#confirmModal').Content = '此操作不可恢复，确定querySelector('p').textContent = '此操作不可恢复，确定要删除「'+(title要删除「'+(title||'这篇文章')+'||'这篇文章')+'」吗？'; }
   」吗？'; }
    async function executeDelete() {
        if (!pendingDeleteId) return;
        try { async function executeDelete() {
        if (!pendingDeleteId) return;
        try { await apiCall('/ await apiCall('/api/articles/'+encodeURIComponent(pendingDeleteId), { method:'DELETE'api/articles/'+encodeURIComponent(pendingDeleteId), { method:'DELETE' }); showToast('已删除'); }
 }); showToast('已删除'); }
        catch(e) { showToast('删除失败: '+        catch(e) { showToast('删除失败: '+e.message,'error'); }
e.message,'error'); }
        $('#confirmModal').class        $('#confirmModal').classList.remove('active');List.remove('active'); pendingDeleteId = null;
 pendingDeleteId = null;
        await loadArticles();
        if (currentView==        await loadArticles();
        if (currentView==='list') { render='list') { renderList(); renderTags(); } else if (currentList(); renderTags(); } else if (currentView==='admin') renderView==='admin') renderAdmin();Admin(); else if (currentView==='detail') switchView(' else if (currentView==='detail') switchView('list');
    }

    //list');
    }

    // 管理面板
    function renderAdmin() {
        var container = $('#adminArticlesList'), reviewPanel 管理面板
    function renderAdmin() {
        var container = $('#adminArticlesList'), reviewPanel = $('#reviewPanel'), quotaPanel = $('#quotaPanel');
        container.style.display = review = $('#reviewPanel'), quotaPanel = $('#quotaPanel');
        container.style.display = reviewPanel.style.display = quotaPanel.style.display = 'none';
        if (currentTabPanel.style.display = quotaPanel.style.display = 'none';
        if (currentTab === 'articles') {
            === 'articles') {
            container.style.display = 'block';
            container.innerHTML = articles.map(function(a) container.style.display = 'block';
            container.innerHTML = articles.map(function(a) {
                return '<div class="article-man {
                return '<div class="article-manage-item" style="displayage-item" style="display:flex;justify-content:space-between;padding::flex;justify-content:space-between;padding:0.7rem 0;border-bottom:1px dashed rgba(250,219,950.7rem 0;border-bottom:1px dashed rgba(250,219,95,0.25);">'+
                    '<div><span>'+ escapeHtml(a.title) +'</span><span style="font-size:0.75,0.25);">'+
                    '<div><span>'+ escapeHtml(a.title) +'</span><span style="font-size:0.75rem;color:var(--text-muted);">'+ formatDate(a.createdAt) +' by '+ escapeHtml(a.author||'rem;color:var(--text-muted);">'+ formatDate(a.createdAt) +' by '+ escapeHtml(a.author||'佚名') +'</span></div>'+
佚名') +'</span></div>'+
                    '<div><button class="btn btn-sm                    '<div><button class="btn btn-sm edit-btn" data-id="'+ escapeHtml(a.id) +'"> edit-btn" data-id="'+ escapeHtml(a.id) +'">✏️</button><button class="btn btn-sm✏️</button><button class="btn btn-sm btn-danger delete-btn" data-id="'+ escapeHtml(a.id) +'"> btn-danger delete-btn" data-id="'+ escapeHtml(a.id) +'">🗑️</button></div></div>';
            }).join('');
            container.onclick = function(e) {
                var btn = e.target🗑️</button></div></div>';
            }).join('');
            container.onclick = function(e) {
                var btn = e.target;
;
                if (btn.classList.contains('edit-btn')) open                if (btn.classList.contains('edit-btn')) openEditor(btn.dataset.id);
                else if (btn.classList.contains('delete-btn'))Editor(btn.dataset.id);
                else if (btn.classList.contains('delete-btn')) confirmDel(btn.dataset.id, btn.dat confirmDel(btn.dataset.id, btn.dataset.title);
            };
       aset.title);
            };
        } else if (currentTab === 'review') { } else if (currentTab === 'review') { reviewPanel.style.display = 'block'; renderReview(); }
 reviewPanel.style.display = 'block'; renderReview(); }
        else if (currentTab        else if (currentTab === 'quota') { quotaPanel.style.display = 'block'; renderQuota(); === 'quota') { quotaPanel.style.display = 'block'; renderQuota(); }
    }
    function renderReview() {
        var }
    }
    function renderReview() {
        var container = $('#reviewList');
 container = $('#reviewList');
        if (!pendingApps.length) { container.innerHTML =        if (!pendingApps.length) { container.innerHTML = '<p>暂无待 '<p>暂无待审核文章</p>';审核文章</p>'; return; }
        container.innerHTML = pendingApps.map(function(a return; }
        container.innerHTML = pendingApps.map(function(a) {
            return '<div) {
            return '<div class="article-manage-item" style=" class="article-manage-item" style="display:flex;justifydisplay:flex;justify-content:space-between;padding-content:space-between;padding:0.7rem 0;border-bottom:1px dashed rgba(250:0.7rem 0;border-bottom:1px dashed rgba(250,219,95,0.25);">'+
                '<div><span>'+ escapeHtml(a.title) +'</span><span style="font-size:0.75rem;">'+ format,219,95,0.25);">'+
                '<div><span>'+ escapeHtml(a.title) +'</span><span style="font-size:0.75Date(a.createdAt) +' by '+ escapeHtml(a.applicant) +'</span></divrem;">'+ formatDate(a.createdAt) +' by '+ escapeHtml(a.applicant) +'</span></div>'+
                '<div>'+
                '<div><button class="btn btn-sm approve-btn" data-id><button class="btn btn-sm approve-btn" data-id="'+ escapeHtml(a.id) +'="'+ escapeHtml(a.id) +'">✅ 通过</button><button class="btn btn">✅ 通过</button><button class="btn btn-sm btn-danger reject-btn" data-id="'+ escapeHtml-sm btn-danger reject-btn" data-id="'+ escapeHtml(a.id) +'">❌ 拒绝</button></div></(a.id) +'">❌ 拒绝</button></div></div>';
        }).join('');
        container.onclick = function(e) {
            var iddiv>';
        }).join('');
        container.onclick = function(e) {
            var id = e.target.dataset.id;
            if (e.target.classList.contains('approve-btn = e.target.dataset.id;
            if (e.target.classList.contains('approve-btn')) approveApplication(id);
            else if (e.target.classList')) approveApplication(id);
            else if (e.target.classList.contains('reject-btn')) rejectApplication(id);
        };
    }
    async function render.contains('reject-btn')) rejectApplication(id);
        };
    }
    async function renderQuota() {
        varQuota() {
        var container = $('#qu container = $('#quotaList');
        try {
otaList');
        try {
            var data = await apiCall('/api/            var data = await apiCall('/api/apply-quota/all');
           apply-quota/all');
            if (!data || !data if (!data || !data.length) { container.innerHTML =.length) { container.innerHTML = '<p>暂无用户 '<p>暂无用户数据</p>'; return数据</p>'; return; }
            container.innerHTML = data.map(function(u); }
            container.innerHTML = data.map(function(u) {
                return '<div class {
                return '<div class="article-man="article-manage-item" style="display:flex;justify-contentage-item" style="display:flex;justify-content:space-between;padding::space-between;padding:0.7rem 00.7rem 0;border-bottom:1px;border-bottom:1px dashed rgba(250 dashed rgba(250,219,95,0.25);">,219,95,0.25);">'+
                    '<div'+
                    '<div><span>'+ escapeHtml(u.username) +'</span><span style="><span>'+ escapeHtml(u.username) +'font-size:0.75</span><span style="font-size:0.75rem;">今日已用rem;">今日已用 '+ u '+ u.used +.used +'/'+ u'/'+ u.limit +'.limit +'次</span></div>'次</span></div>'+
                    '<div><button+
                    '<div><button class="btn btn-sm class="btn btn-sm reset-quota-btn" data-username="'+ escape reset-quota-btn" data-username="'+ escapeHtml(u.username) +'">🔄重置Html(u.username) +'">🔄重置</button></div></</button></div></div>';
            }).join('');
div>';
            }).join('');
            container.onclick = function            container.onclick = function(e) {
(e) {
                if (e.target.classList                if (e.target.classList.contains('reset-quota-btn')) {
                    var un.contains('reset-quota-btn')) {
                    var un = e.target.dataset.username = e.target.dataset.username;
                    if (confirm(';
                    if (confirm('重置'重置' + un + '的 + un + '的申请次数？')) resetUserQuota(un);
                }
申请次数？')) resetUserQuota(un);
                }
            };
        } catch (e) { container.innerHTML =            };
        } catch (e) { container.innerHTML = '<p>加载失败</ '<p>加载失败</p>'; }
    }
p>'; }
    }
    async function resetUserQu    async function resetUserQuota(un) {
        try { await apiota(un) {
        try { await apiCall('/api/apply-quota/reset/'+encodeURIComponent(un), {Call('/api/apply-quota/reset/'+encodeURIComponent(un), { method:'POST' }); showToast('已重置'); renderQuota(); if method:'POST' }); showToast('已重置'); renderQuota(); if (currentUser && current (currentUser && currentUser.username === un) updateApplyQuUser.username === un) updateApplyQuota(); }
        catch(e) { showToast('ota(); }
        catch(e) { showToast('重置失败','error'); }
重置失败','error'); }
    }
    async function approve    }
    async function approveApplication(id) {
        tryApplication(id) {
        try { await apiCall('/api/article-applications/'+id+'/approve', { await apiCall('/api/article-applications/'+id+'/approve', { method:'POST' }); showToast('已批准并发布'); }
        catch(e) { showToast(' { method:'POST' }); showToast('已批准并发布'); }
        catch(e) { showToast('操作失败','error'); }
        await loadApplications(); await操作失败','error'); }
        await loadApplications(); await loadArticles();
        if (currentView== loadArticles();
        if (currentView==='list') { renderList(); renderTags(); }
    }
    async function rejectApplication(id) {
        try { await apiCall='list') { renderList(); renderTags(); }
    }
    async function rejectApplication(id) {
        try { await apiCall('/api/article-applications/'+id, { method:'DELETE'('/api/article-applications/'+id, { method:'DELETE' }); showToast('已拒绝'); }
        catch(e) { showToast('操作失败','error'); }
        await loadApplications();
    }

    // 特效系统
    function initTrail() {
        var canvas = document.getElementById('trail }); showToast('已拒绝'); }
        catch(e) { showToast('操作失败','error'); }
        await loadApplications();
    }

    // 特效系统
    function initTrail() {
        var canvas = document.getElementById('trailCanvas'), ctx = canvas.getContext('2d'), w, h, trail = [];
Canvas'), ctx = canvas.getContext('2d'), w, h, trail = [];
        function resize() { w = window.innerWidth; h        function resize() { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; }
        window.addEventListener('resize', resize = window.innerHeight; canvas.width = w; canvas.height = h; }
        window.addEventListener('resize', resize); resize();
        var mouseX = w / 2, mouseY =); resize();
        var mouseX = w / 2, mouseY = h / 2;
        document.addEventListener('mousem h / 2;
        document.addEventListener('mousemove', function(e) {
ove', function(e) {
            mouseX = e.clientX; mouseY = e.clientY;
            trail.push            mouseX = e.clientX; mouseY = e.clientY;
            trail.push({ x: mouseX,({ x: mouseX, y: mouseY, life: 1, size: y: mouseY, life: 1, size: 2 + Math.random() 2 + Math.random() * 4, color: * 4, color: Math.random() > 0 Math.random() > 0.5 ? 'rgba(250,219.5 ? 'rgba(250,219,95,' :,95,' : 'rgba( 'rgba(125125,249,255,249,255,' });
            if (trail.length > 40) trail.shift();
,' });
            if (trail.length > 40) trail.shift();
        });
        function animate()        });
        function animate() {
            ctx.clearRect( {
            ctx.clearRect(0, 0, w0, 0, w, h);
            for (, h);
            for (var i = trail.length - 1; i >= 0; i--) {
               var i = trail.length - 1; i >=  var p = trail[i];0; i--) {
                var p = trail[i]; p.life -= 0 p.life -= 0.025; p.size *= 0.97;
                if (p.life <= 0) { trail.splice(i, 1); continue; }
                ctx.beginPath(); ctx.arc.025; p.size *= 0.97;
                if (p.life <= 0) { trail.splice(i, 1(p.x, p.y, p.size, 0,); continue; }
                ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
 Math.PI * 2);
                ctx.fillStyle = p                ctx.fillStyle = p.color + p.life +.color + p.life + ')'; ctx.fill();
                ctx.shadowBlur = 12; ctx.shadow ')'; ctx.fill();
                ctx.shadowBlur = 12; ctx.shadowColor = p.color + '0.6)';Color = p.color + '0.6)'; ctx.fill(); ctx.fill(); ctx.shadowBlur = 0;
            }
            ctx.shadowBlur = 0;
            }
            requestAnimationFrame(animate);
 requestAnimationFrame(animate);
        }
        animate();
    }
    function initBurst() {
        var canvas =        }
        animate();
    }
    function initBurst() {
        var canvas = document.getElementById('rippleCanvas document.getElementById('rippleCanvas'), ctx = canvas.getContext('2d'), bursts ='), ctx = canvas.getContext('2d'), bursts = [];
        document.addEventListener('click [];
        document.addEventListener('click', function(e) {
           ', function(e) {
            var count =  var count = 15 + Math.floor(Math.random15 + Math.floor(Math.random() * 20);
            for (var i = () * 20);
            for (var i = 0; i < count;0; i < count; i++) {
                var angle i++) {
                var angle = Math.random() * Math = Math.random() * Math.PI * 2, speed = 2.PI * 2, + Math.random() *  speed = 2 + Math.random() * 6;
                bursts.push({6;
                bursts.push({ x: e.clientX, x: e.clientX, y: e.clientY, vx: Math.cos( y: e.clientY, vx: Math.cos(angle) * speed, vyangle) * speed, vy: Math.sin(angle): Math.sin(angle) * speed, life: 1, size: 1 * speed, life: 1, size: 1 + Math.random() *  + Math.random() * 3, color: ['#3, color: ['#fadb5fadb5f','#ff6b6b','#7f','#ff6b6b','#7df9ff','#cdf9ff','#c08eff'][Math.floor(Math08eff'][Math.floor(Math.random()*4)] });
            }
            if (burst.random()*4)] });
            }
            if (bursts.length > 200s.length > 200) bursts.splice(0, bursts.length) bursts.splice(0, bursts.length - 200);
        });
        function drawBursts - 200);
        });
        function drawBursts() {
            for (var() {
            for (var i = bursts.length - 1; i >= 0 i = bursts.length - 1; i >= 0; i--) {
                var; i--) {
                var b = bursts[i]; b.x += b.vx b = bursts[i]; b.x += b.vx; b.y += b.; b.y += b.vy; b.vy += 0.05;vy; b.vy += 0.05; b b.life -= 0..life -= 0.02;
                if (b.life <= 0) { bursts.splice(i,02;
                if (b.life <= 0) { bursts.splice(i, 1); continue; }
                ctx.beginPath(); ctx 1); continue; }
                ctx.beginPath(); ctx.arc(b.x, b.arc(b.x, b.y, b.size, 0, Math.PI * 2);
                ctx.fill.y, b.size, 0, Math.PI * 2);
                ctx.fillStyle = b.color.replace(')', ','Style = b.color.replace(')', ',' + b.life + + b.life + ')').replace('rgb', 'rgba');
                if ')').replace('rgb', 'rgba');
                if (b.color.startsWith(' (b.color.startsWith('#')) { ctx.fillStyle = b.color + Math.floor(b.life * 255#')) { ctx.fillStyle = b.color + Math.floor(b.life * 255).toString(16).padStart(2, '0'); }
                ctx.fill();
            }
        }
        setInterval(drawBursts, 33);
).toString(16).padStart(2, '0'); }
                ctx.fill();
            }
        }
        setInterval(drawB    }
    function initConstellations() {
        var canvas = document.getElementById('particleCanvas'), ctx = canvas.getContext('2d'),ursts, 33);
    }
    function initConstellations() {
        var canvas = document.getElementById('particleCanvas'), ctx = canvas.getContext('2d'), stars = [], w, stars = [], w, h;
        function resize() { w = window.innerWidth h;
        function resize() { w = window.innerWidth; h = window.innerHeight; canvas.width =; h = window.innerHeight; canvas.width = w; w; canvas.height = h; }
        window.addEventListener('resize', resize); resize();
        canvas.height = h; }
        window.addEventListener('resize', resize); resize();
        for (var i = 0; i < 40; i++) stars for (var i = 0; i < 40; i++) stars.push({ x: Math.random.push({ x: Math.random() * w, y:() * w, y: Math.random() * h, size: 0.5 Math.random() * h, size: 0.5 + Math.random() *  + Math.random() * 1.5, twinkle: Math.random() * Math1.5, twinkle: Math.random() * Math.PI * 2 });
        function drawStars() {
.PI * 2 });
        function drawStars() {
            for (var i =            for (var i = 0; i < stars 0; i < stars.length; i++) {
                var s = stars[i];.length; i++) {
                var s = stars[i]; s.twinkle += 0.02; var s.twinkle += 0.02; var alpha = 0.3 alpha = 0.3 + Math.sin(s.twinkle + Math.sin(s.twinkle) * 0.3) * 0.3;
                ctx.beginPath();;
                ctx.beginPath(); ctx.arc(s.x, ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
 s.y, s.size, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255                ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')'; ctx.fill();
               ,255,' + alpha + ')'; ctx.fill();
                for (var j = i + 1; j < stars.length; j++) {
                    var s2 = stars for (var j = i + 1; j < stars.length; j++) {
                    var s2 = stars[j]; var dx = s.x - s[j]; var dx = s.x - s2.x, dy = s.y - s2.y;2.x, dy = s.y - s2.y; var dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < 150) {
                        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s2.x, s2.y);
                        ctx.strokeStyle = 'rgba(250 var dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < 150) {
                        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s2.x, s2.y);
                        ctx.strokeStyle = 'rgba(250,219,95,' + (0.15,219,95,' + (0.15 * (1 - dist / * (1 - dist / 150)) + ')'; 150)) + ')'; ctx.lineWidth = 0 ctx.lineWidth = 0.5; ctx.stroke.5; ctx.stroke();
                    }
                }
           ();
                    }
                }
            }
        }
        set }
        }
        setInterval(drawStars, 100);
    }
    functionInterval(drawStars, 100);
    }
    function apply3DTilt apply3DTilt() {
        var cards =() {
        var cards = document.querySelectorAll('.article document.querySelectorAll('.article-card');
        cards.forEach(function(card) {
            card.addEventListener('mousemove', function(e) {
               -card');
        cards.forEach(function(card) {
            card.addEventListener('mousemove var rect = card.getBoundingClientRect(), x = e.clientX - rect.left, y = e', function(e) {
                var rect = card.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
.clientY - rect.top;
                var cx = rect.width / 2, cy =                var cx = rect.width / 2, cy = rect.height / 2;
                var rotateX = (y - cy) / cy rect.height / 2;
                var rotateX = ( * -8, rotateY = (x - cx)y - cy) / cy * -8, rotateY = (x - cx) / cx * 8;
 / cx * 8;
                card.style.transform = 'perspective(800                card.style.transform = 'perspective(800px) rotateX('+px) rotateX('+ rotate rotateX +X +'deg) rotateY(''deg) rotateY('+ rotateY +'deg) scale(1.02)';
            });
            card+ rotateY +'deg) scale(1.02)';
            });
            card.addEventListener('mouseleave', function.addEventListener('mouseleave', function() {() { card.style.transform = 'pers card.style.transform = 'perspective(800px) rotatepective(800px) rotateX(0deg) rotateX(0deg) rotateY(0deg) scaleY(0deg) scale(1)'; });
        });
    }
    function init(1)'; });
        });
    }
    function initRipples() {
       Ripples() {
        var canvas = document.getElementById('rippleCanvas'), ctx var canvas = document.getElementById(' = canvas.getContext('2rippleCanvas'), ctx = canvas.getContext('2d'), w, h,d'), w, h, ripples = [];
        function ripples = [];
        function resize() { w = window resize() { w = window.innerWidth; h = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h.innerHeight; canvas.width = w; canvas.height = h; }
        window.addEventListener('resize; }
        window.addEventListener('resize', resize); resize();
       ', resize); resize();
        document.addEventListener('click', function(e) {
            var colors = ['rgba(250 document.addEventListener('click', function(e) {
            var colors = ['rgba(250,219,95,0.8),219,95,0.8)','rgba(255,107,107,0.','rgba(255,107,107,0.7)','rgba(125,249,2557)','rgba(125,249,255,0.6)',',0.6)','rgba(200,180rgba(200,180,140,0.7,140,0.7)'];
            ripples.push({ x: e.clientX)'];
            ripples.push({ x: e.clientX, y: e.clientY, y: e.clientY, radius: 5, radius: 5, maxRadius: 60, maxRadius: 60 + Math.random() * + Math.random() * 60, opacity:  60, opacity: 0.8, color:0.8, color: colors[Math.floor(Math.random()*colors colors[Math.floor(Math.random()*colors.length)], speed: 1.2 + Math.random() * 0.8.length)], speed: 1.2 + Math.random });
            if (ripples() * 0.8 });
            if (ripples.length > 20) ri.length > 20) ripples.shift();
        });
        function animatepples.shift();
        });
        function animate() {
            ctx.clearRect(0, 0, w, h() {
            ctx.clearRect(0,);
            for (var i = ripples.length -  0, w, h);
            for (var i = ripples.length - 1; i >= 01; i >= 0; i--) {
                var; i--) {
                var r = ripples[i]; r.radius += r.s r = ripples[i];peed; r.opacity -= 0.015;
                r.radius += r.speed; r.opacity -= 0.015;
                if (r.opacity <= if (r.opacity <= 0 || r.radius > r.maxRadius) { 0 || r.radius > r.maxRadius) { ripples.splice(i, 1); }
 ripples.splice(i, 1); }
                else {
                else {
                    ctx.beginPath(); ctx.arc(r.x, r                    ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI.y, r.radius, 0, Math.PI * 2);
                    var * 2);
                    var g = ctx.createRadial g = ctx.createRadialGradient(r.x, rGradient(r.x, r.y, r.radius *.y, r.radius * 0.2, r.x, r.y, r 0.2, r.radius);
                    g.add.x, r.y, r.radius);
                    g.addColorStop(0, r.color); g.addColorStopColorStop(0, r.color); g.addColorStop(1, 'transparent');
                    ctx.fillStyle = g; ctx.globalAlpha(1, 'transparent');
                    ctx.fillStyle = g; ctx.globalAlpha = r.opacity; ctx.fill(); ctx.globalAlpha = r.opacity; ctx.fill(); ctx.globalAlpha = 1;
                }
            }
            requestAnimationFrame = 1;
                }
            }
            requestAnimationFrame(animate);
        }
        animate();
    }
    function(animate);
        }
        animate();
    }
    function initParticles() {
        initParticles() {
        var canvas = document.getElementById('particleCanvas'), ctx var canvas = document.getElementById('particleCanvas'), ctx = canvas.getContext('2 = canvas.getContext('2d'), w, h,d'), w, h, particles = [];
        function resize particles = [];
        function resize() { w = window.innerWidth; h = window() { w = window.innerWidth; h = window.innerHeight; canvas.width =.innerHeight; canvas.width = w; canvas.height = h w; canvas.height = h; }
        window.addEventListener('resize', resize); resize; }
        window.addEventListener('resize', resize); resize();
        function Particle() { this.reset(true); }
       ();
        function Particle() { this.reset(true); }
        Particle.prototype.reset = function(init) {
 Particle.prototype.reset = function(init) {
            this.x = Math            this.x = Math.random() * w; this.random() * w; this.y = init ? Math.random() * h : -.y = init ? Math20;
            this.size =.random() * h : -20;
            this.size = 1 + Math.random() 1 + Math.random() * 3; this.s * 3; this.speedY = 0.peedY = 0.3 + Math.random() *3 + Math.random() * 1.5; 1.5; this.speedX = (Math.random() - 0 this.speedX = (Math.random() - 0.5) * 0.5) * 0.8;
            this.op.8;
            this.opacity = 0.4 + Math.random() * acity = 0.4 + Math.random() * 0.6; this.type = Math.random() >0.6; this.type = Math.random() > 0.6 ? ' 0.6 ? 'petal' : (Mathpetal' : (Math.random() > 0.5 ? 'gold'.random() > 0.5 ? 'gold' : 'cyan');
            if : 'cyan');
            if (this.type === 'petal') { this.color = (this.type === 'petal') { this.color = 'rgba(255, 'rgba(255,200,210,' + this200,210,' + this.opacity + ')'; this.rotation = Math.random().opacity + ')'; this.rotation = Math.random() * Math.PI *  * Math.PI * 2; this.rotSpeed2; this.rotSpeed = (Math.random() - = (Math.random() - 0.5) * 0.5) * 0.02; }
            else if (this.type 0.02; }
            else if (this.type === 'gold') this.color = 'rgba(250 === 'gold') this.color = 'rgba(250,219,95,219,95,' + this.opacity + ')';
            else this.color = 'rgba(125,' + this.opacity + ')';
            else this.color = 'rgba(125,249,255,249,255,' + this.opacity +,' + this.opacity + ')';
        };
        Particle.prototype.update = function() ')';
        };
        Particle.prototype.update = function() {
            this.y += {
            this.y += this.speedY this.speedY; this.x += Math.sin(this.y * 0.; this.x += Math.sin(this.y * 0.02) * this.speed02) * this.speedX;
            if (this.type === 'petal')X;
            if (this.type === this.rotation += this.rotSpeed;
            if (this.y > h 'petal') this.rotation += this.rotSpeed;
            if (this.y > h + 30 || this.x < -30 || this.x > w + 30) + 30 || this.x < -30 || this.x > w + 30) this.reset(false);
        };
 this.reset(false);
        };
        Particle.prototype.draw = function        Particle.prototype.draw = function(ctx) {
            ctx.globalAlpha = this.opacity;
            if (this.type(ctx) {
            ctx.globalAlpha = this.opacity;
            if (this.type === 'petal') {
 === 'petal') {
                ctx.save(); ctx.trans                ctx.save(); ctx.translate(this.x, this.ylate(this.x, this.y); ctx.rotate(this.); ctx.rotate(this.rotation);
                ctx.fillStyle = this.color;rotation);
                ctx.fillStyle = this.color; ctx.beginPath(); ctx. ctx.beginPath(); ctx.ellipse(0, ellipse(0, 0, this.size * 0, this.size * 0.6, this.size * 0.2, 0, 0, Math.PI * 20.6, this.size * 0.2, 0, 0, Math.PI * 2); ctx.fill();
); ctx.fill();
                ctx.beginPath(); ctx                ctx.beginPath(); ctx.ellipse(0, 0, this.size *.ellipse(0, 0, this.size * 0.2, this.size * 0.6, 0, 0 0.2, this.size * 0.6, 0, 0, Math.PI * 2); ctx.fill();, Math.PI * 2); ctx.fill(); ctx.restore();
            } else { ctx.restore();
            } else { ctx.fillStyle = this.color ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, ; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI *0, Math.PI * 2); ctx.fill(); 2); ctx.fill(); }
            ctx.globalAlpha }
            ctx.globalAlpha = 1;
        };
        for (var i = 0; i <  = 1;
        };
        for (var i =80; i++) particles.push(new Particle());
        function animate 0; i < 80; i++) particles.push(new Particle());
        function animate() { ctx.clearRect() { ctx.clearRect(0, 0, w, h); for ((0, 0, w, h); for (var i = 0;var i = 0; i < particles.length; i i < particles.length; i++) { particles[i].update++) { particles[i].update(); particles[i].draw(ctx(); particles[i].draw(ctx); } requestAnimationFrame(animate); }
        animate();
    }

    //); } requestAnimationFrame(animate); }
        animate();
    }

    // 诗词 诗词轮播
    var poems =轮播
    var poems = ['☯ 且将 ['☯ 且将新火试新茶，新火试新茶，诗酒趁年华诗酒趁年华 ☯','☯ 醉 ☯','☯ 醉后不知天在水，满船清梦压星河后不知天在水，满船清梦压星河 ☯','☯  ☯','☯ 云想衣裳花想容云想衣裳花想容，春风拂槛露华，春风拂槛露华浓 ☯','☯ 银烛秋光冷画屏，轻浓 ☯','☯ 银烛秋光冷画屏，轻罗小扇扑流萤罗小扇扑流萤 ☯','☯  ☯','☯ 沧海月明珠有泪沧海月明珠有泪，蓝田日暖玉，蓝田日暖玉生烟 ☯'];
    var poemIdx = 0;
    set生烟 ☯'];
    var poemIdxInterval(function() { = 0;
    setInterval(function() { poemIdx = (poemIdx + poemIdx = (poemIdx + 1) % poems.length 1) % poems.length; var el = document.getElementById; var el = document.getElementById('poemFloat'); if('poemFloat'); if (el) el.textContent = poems[poemIdx (el) el.textContent = poems[poemIdx]; }, 10000);

    // ]; }, 10000);

    // 导入 Mark导入 Markdown down 文件
    function initMdImport() {
        var ib文件
    function initMdImport() {
        var ib = document.getElementById('import = document.getElementById('importMdBtn'), fi = document.getElementById('mdFileMdBtn'), fi = document.getElementById('mdFileInput');
        if (!ib || !fi) return;
Input');
        if (!ib || !fi) return;
        ib.addEventListener('click',        ib.addEventListener('click', function() { fi.click(); });
        fi.addEventListener('change', function function() { fi.click(); });
        fi.addEventListener('change', function(e) {
            var f = e.target.files[0]; if (!f) return;
            var r = new FileReader();
           (e) {
            var f = e.target.files[0]; if (!f) return;
            var r = new FileReader();
            r.onload = function(ev) {
                var ti = document.getElementById('articleTitle'); var ci r.onload = function(ev) {
                var ti = document.getElementById('articleTitle'); var ci = document.getElementById('articleContent');
                if (ti) = document.getElementById('articleContent');
                if (ti) ti.value = f.name.replace(/\.md$/i, ''); if ( ti.value = f.name.replace(/\.md$/i, ''); if (ci) ci.value = evci) ci.value = ev.target.result;
                showToast('已导入 ' + f.target.result;
                showToast('已导入 ' + f.name);
            };
            r.name);
            };
            r.readAsText(f, 'UTF-8');.readAsText(f, 'UTF-8'); fi.value = '';
        });
    }

    // 事件 fi.value = '';
        });
    }

    // 事件绑定
    function bindEvents() {
        $('#loginBtn').addEventListener('click', function() { $('#loginModal').classList.add('绑定
    function bindEvents() {
        $('#loginBtn').addEventListener('click', function() { $('#loginactive'); });
        $('#closeLoginModal').addEventListener('click', function() { $('#loginModal').classList.remove('active'); });
        $('#submitLogin').addEventListener('click', async function()Modal').classList.add('active'); });
        $('#closeLoginModal').addEventListener('click', function() { $('#loginModal').classList.remove('active'); });
        $('#submitLogin').addEventListener('click', async function() {
 {
            var u = $('#login            var u = $('#loginUsername').value.trim(), pUsername').value.trim(), p = $('#loginPassword').value = $('#loginPassword').value;
            if (!u || !p) return showToast('请输入账号密码;
            if (!u || !p) return showToast('请输入账号密码','error');
            try { await login(u','error');
            try { await login(u, p); $('#loginModal').classList.remove('active, p); $('#loginModal'); $('#loginUsername').value').classList.remove('active'); $('#loginUsername').value = ''; $('#loginPassword = ''; $('#loginPassword').value = ''; await').value = ''; await loadArticles(); renderList loadArticles(); renderList(); renderTags(); }
           (); renderTags(); }
            catch(e) { showToast('登录失败: '+e catch(e) { showToast.message,'error'); }
        });
        $('#logoutBtn').('登录失败: '+e.message,'error'); }
        });
        $('#logoutBtn').addEventListener('click', logoutaddEventListener('click', logout);
        $('#admin);
        $('#adminPanelBtn').addEventListener('PanelBtn').addEventListener('click', function() { switchView('admin'); });
        $('#backFromAdminclick', function() { switchView('admin'); });
        $('#backFromAdminBtn').addEventListener('click', function() { switchViewBtn').addEventListener('click', function() { switchView('list'); });
        $('#('list'); });
        $('#newArticleBtn').addEventListenernewArticleBtn').addEventListener('click', function() { openEditor(null); });
       ('click', function() { openEditor(null); });
        $('# $('#adminNewArticleBtn').adminNewArticleBtn').addEventListener('click', functionaddEventListener('click', function() { openEditor(null); });
        $('#closeArticleModal() { openEditor(null); });
        $('#closeArticleModal').addEventListener('click', function() { $('#articleModal').addEventListener('click', function() { $('#articleModal').classList.remove('active').classList.remove('active'); });
        $('#cancelArticle').addEventListener('click', function() { $('#articleModal'); });
        $('#cancelArticle').addEventListener('click', function() { $('#articleModal').classList.remove('active').classList.remove('active'); });
        $('#submitArticle'); });
        $('#submitArticle').addEventListener('click', submitArticle);
        $('#back').addEventListener('click', submitArticle);
        $('#backToListBtn').addEventListener('click', function() { switchToListBtn').addEventListener('click', function() { switchView('list'); });
        $('#confirmDeleteBtn').addEventListener('click', executeDeleteView('list'); });
        $('#confirmDeleteBtn').add);
        $('#cancelDeleteEventListener('click', executeDelete);
        $('#cancelDeleteBtn').addEventListener('clickBtn').addEventListener('click', function() { $('#confirm', function() { $('#confirmModal').classList.remove('Modal').classList.remove('active'); });
        $('#searchactive'); });
        $('#searchInput').addEventListener('inputInput').addEventListener('input', function() { renderList(); });
        var top', function() { renderList(); });
        var topBtn = $('#backToTop');
        window.addEventListener('Btn = $('#backToTop');
        window.addEventListener('scroll', function() { topscroll', function() { topBtn.style.display = window.scBtn.style.display = window.scrollY > rollY > 500 ? 'flex' : 'none500 ? 'flex' : 'none'; });
'; });
        topBtn.addEventListener('click        topBtn.addEventListener('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });
', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });
        $('#applyArticleBtn').addEventListener('click', function() {
            if (applyQuotaRemaining <= 0) { showToast('今日申请次数已用        $('#applyArticleBtn').addEventListener('click', function() {
            if (applyQuotaRemaining <= 0) { showToast('今日申请次数已用尽','error'); return;尽','error'); return; }
            $('#applyLimitInfo').textContent = '今日还可提交 ' + apply }
            $('#applyLimitInfo').textContent = '今日还可提交 ' + applyQuotaRemaining + ' 次';QuotaRemaining + ' 次'; $('#applyModal').classList.add('active');
        });
        $('#closeApplyModal $('#applyModal').classList.add('active');
        });
        $('#closeApplyModal').addEventListener('click', function() { $('#applyModal').addEventListener('click', function() { $('#applyModal').classList.remove('active').classList.remove('active'); });
        $('#cancelApply').addEventListener('click','); });
        $('#cancelApply').addEventListener('click', function() { $('#applyModal').classList.remove('active'); });
        $('#submitApply function() { $('#applyModal').classList.remove('active'); });
        $('#submitApply').addEventListener('click', async function() {
            if').addEventListener('click', async function() {
            if (applyQuotaRemaining <= 0) { showToast('今日申请次数已用尽','error'); return; }
            var (applyQuotaRemaining <= 0) { showToast('今日申请次数已用尽','error'); return; }
            var t = $('#applyTitle').value.trim(), c = $('# t = $('#applyTitle').value.trim(), c = $('#applyContent').value.trim();
            if (!t || !c) return showToastapplyContent').value.trim();
            if (!t || !c) return showToast('标题和内容不能为空','error');
            var d = { title: t, content('标题和内容不能为空','error');
            var d =: c, summary: $('#applySummary').value.trim(), tags: $('#applyTags { title: t, content: c, summary: $('#applySummary').value.trim(), tags: $('#applyTags').value.split(').value.split(',').map(function(x){ return x.trim(); }).filter(Boolean), seal: $('#apply',').map(function(x){ returnSeal').value.trim() x.trim(); }).filter(Boolean), seal: $('#applySeal').value.trim() || '墨' };
            || '墨' };
            try { await apiCall('/api/article-app try { await apiCalllications', { method:'POST', body:('/api/article-applications', { method:'POST', body: d }); showToast(' d }); showToast('申请已提交');申请已提交'); $('#applyModal').classList.remove('active');
                $('#applyModal').classList.remove('active');
                $('#applyTitle').value = ''; $('#applyContent'). $('#applyTitle').value =value = ''; $('#applySummary').value = ''; $('#applyTags').value = ''; $('#applyContent').value = ''; $('#applySummary').value = ''; ''; $('#applySeal').value = '墨'; updateApplyQuota(); }
            catch(e $('#applyTags').value = ''; $('#applySeal').value = '墨'; updateApplyQuota(); }
            catch(e) { showToast('提交失败: '+e.message,') { showToast('提交失败: '+e.message,'error'); }
        });
        $('#articlesTabBtnerror'); }
        });
       ').addEventListener('click', function() { currentTab = 'articles'; renderAdmin $('#articlesTabBtn').addEventListener('click', function() { currentTab = 'articles'; renderAdmin(); });
        $('#reviewTabBtn').addEventListener('click', function() { currentTab = 'review'; loadApplications(); });
        $('#reviewTabBtn').addEventListener('click', function() { currentTab = 'review'; load(); renderAdmin(); });
        $('#quotaTabBtn').addEventListener('click',Applications(); renderAdmin(); });
        $('#quotaTabBtn').addEventListener('click', function() { currentTab = 'quota'; renderAdmin(); });
        $$('. function() { currentTab = 'quota'; renderAdmin(); });
        $$('.modal-overlay').forEach(function(ov) { ov.addEventListener('click', functionmodal-overlay').forEach(function(ov) { ov.addEventListener('click', function(e) { if (e.target === ov) ov.classList.remove('active'); }(e) { if (e.target === ov) ov.classList.remove('active'); }); });
        //); });
        // 批注提交 批注提交
        var submitAnn =
        var submitAnn = document.getElementById('submitAnnotation');
        if (submitAnn) submitAnn.addEventListener('click', async function() {
            var text = $('# document.getElementById('submitAnnotation');
        if (submitAnn) submitAnn.addEventListener('click', async function() {
            var text = $('#annotationText').value.trim(); if (!text || !currentArticleId) return;
            var article = articles.find(functionannotationText').value.trim(); if (!text || !currentArticleId) return;
            var article = articles.find(function(a){ return a.id === currentArticleId; }(a){ return a.id ===); if (!article) return;
            if (!article.annotations) article.annotations = [];
            article.annotations.push({ x: currentAnnotationPos.x, y: currentAnnotation currentArticleId; }); if (!article) return;
            if (!article.annotations) article.annotations = [];
            article.annotations.push({ x: currentAnnotationPos.x, y: currentAnnotationPos.y, text: text });
            try { awaitPos.y, text: text });
            try { await apiCall('/api/articles apiCall('/api/articles/'+/'+currentArticleId, { method:'PUT', body: {currentArticleId, { method:'PUT', body: { annotations: article.annotations } }); showToast('朱批已保存'); annotations: article.annotations } }); showToast('朱批已保存'); addAnnotationTag addAnnotationTag(currentAnnotationPos.x, currentAnnotationPos.y, text);(currentAnnotationPos.x, currentAnnotationPos.y, text); }
            catch(e) { }
            catch(e) { showToast('保存失败','error'); }
            showToast('保存失败','error'); }
            $('#annotationModal').classList.remove('active'); $('#annotationText').value = '';
 $('#annotationModal').classList.remove('active'); $('#annotationText').value = '';
        });
        var closeAnn = document.getElementById('closeAnnotationModal');
        if (closeAnn) closeAnn.addEventListener        });
        var closeAnn = document.getElementById('closeAnnotationModal');
        if (closeAnn) closeAnn.addEventListener('click', function() { $('#annotationModal').classList('click', function() { $('#annotationModal').classList.remove('active'); });
    }

    function initStylePanel() {
        document.remove('active'); });
    }

    function initStylePanel() {
        document.getElementById('stylePanel').addEventListener('click', function(e) {
.getElementById('stylePanel').addEventListener('click', function(e            if (e.target.classList) {
            if (e.target.classList.contains('skin-btn')) applySkin(e.target.dataset.s.contains('skin-btn')) applySkin(e.target.dataset.skin);
        });
        var savedSkin = localStorage.getItem('kin);
        });
        var savedSkin = localStorage.getItem('blog_skin') || 'blog_skin') || 'default'; applySkin(saveddefault'; applySkin(savedSkin);
    }

    windowSkin);
    }

    window._blogApp = { viewArticle:._blogApp = { viewArticle: viewArticle, editArticle: openEditor, confirmDelete viewArticle, editArticle: openEditor, confirmDeleteArticle: confirmDel };

    async function init()Article: confirmDel };

    async function init() {
        initRipples(); initParticles {
        initRipples(); initParticles(); initTrail(); init(); initTrail(); initBurst(); initConstellations();
        initMdImport(); initStylePanel(); bindBurst(); initConstellations();
        initMdImport(); initStylePanel(); bindEvents();
        await loadArticles(); await checkLogin(); renderList(); renderEvents();
        await loadArticles(); await checkLogin(); renderList(); renderTags();
    }
Tags();
    }
    init();
})();
    init();
})();
