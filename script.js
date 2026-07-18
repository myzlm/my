(function() {
    'use strict';

    // ===== 1. 新隧道地址（Base64 编码） =====
    // 地址：https://observed-messaging-wind-affiliation.trycloudflare.com
    const ENCODED_API = 'aHR0cHM6Ly9vYnNlcnZlZC1tZXNzYWdpbmctd2luZC1hZmZpbGlhdGlvbi50cnljbG91ZGZsYXJlLmNvbQ==';
    let API_BASE;
    try {
        API_BASE = atob(ENCODED_API);
        if (!API_BASE.startsWith('https://') || !API_BASE.includes('trycloudflare.com')) {
            throw new Error('Invalid API base');
        }
    } catch (e) {
        document.body.innerHTML = '<div style="padding:50px;text-align:center;color:red;font-size:1.2rem;">配置错误，请联系管理员</div>';
        return;
    }

    // ===== 2. 全局状态 =====
    let token = sessionStorage.getItem('gufeng_token') || '';
    let currentUser = null;

    // ===== 3. DOM 引用 =====
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginError = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');
    const guestBtn = document.getElementById('guestBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const roleDisplay = document.getElementById('roleDisplay');
    const cardsContainer = document.getElementById('cardsContainer');
    const adminPanel = document.getElementById('adminPanel');
    const userListEl = document.getElementById('userList');
    const siteManageListEl = document.getElementById('siteManageList');
    const newUserInput = document.getElementById('newUser');
    const newPassInput = document.getElementById('newPass');
    const addUserBtn = document.getElementById('addUserBtn');
    const newSiteName = document.getElementById('newSiteName');
    const newSiteUrl = document.getElementById('newSiteUrl');
    const newSiteDesc = document.getElementById('newSiteDesc');
    const newSiteSeal = document.getElementById('newSiteSeal');
    const addSiteBtn = document.getElementById('addSiteBtn');

    // ===== 4. API 请求封装 =====
    async function apiRequest(endpoint, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers }
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '请求失败');
        }
        return data;
    }

    // ===== 5. 界面切换 =====
    function showLoginScreen() {
        loginScreen.style.display = 'block';
        mainApp.style.display = 'none';
        document.body.style.display = 'flex';
        document.body.style.alignItems = 'center';
    }

    function showMainApp() {
        loginScreen.style.display = 'none';
        mainApp.style.display = 'block';
        document.body.style.display = 'block';
        document.body.style.alignItems = 'unset';
        renderMain();
    }

    // ===== 6. 登录逻辑 =====
    loginBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) {
            loginError.textContent = '请输入账号和密码';
            return;
        }
        try {
            const res = await apiRequest('/api/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            token = res.token;
            sessionStorage.setItem('gufeng_token', token);
            currentUser = { username: res.username, role: res.role };
            loginError.textContent = '';
            showMainApp();
        } catch (err) {
            loginError.textContent = err.message;
        }
    });

    guestBtn.addEventListener('click', () => {
        token = '';
        sessionStorage.removeItem('gufeng_token');
        currentUser = { username: '游客', role: 'guest' };
        showMainApp();
    });

    logoutBtn.addEventListener('click', () => {
        token = '';
        sessionStorage.removeItem('gufeng_token');
        currentUser = null;
        showLoginScreen();
    });

    // ===== 7. 主渲染 =====
    async function renderMain() {
        if (!currentUser) {
            showLoginScreen();
            return;
        }
        roleDisplay.textContent = currentUser.role === 'admin' ? '🔑 管理员' : '👤 游客';
        adminPanel.style.display = currentUser.role === 'admin' ? 'block' : 'none';

        try {
            const sites = await apiRequest('/api/sites');
            renderCards(sites);
        } catch (err) {
            cardsContainer.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = '加载失败，请检查网络';
            p.style.cssText = 'grid-column:1/-1; text-align:center; color:var(--vermillion);';
            cardsContainer.appendChild(p);
        }

        if (currentUser.role === 'admin') {
            try {
                const users = await apiRequest('/api/users');
                renderUserList(users);
            } catch (e) { /* ignore */ }
            try {
                const sites = await apiRequest('/api/sites');
                renderSiteManageList(sites);
            } catch (e) { /* ignore */ }
        }
    }

    // ===== 8. 渲染卡片（安全：纯 DOM 操作） =====
    function renderCards(sites) {
        cardsContainer.innerHTML = '';
        if (!sites || sites.length === 0) {
            const p = document.createElement('p');
            p.textContent = '暂无网站';
            p.style.cssText = 'grid-column:1/-1; text-align:center; color:var(--ink-lighter);';
            cardsContainer.appendChild(p);
            return;
        }
        sites.forEach(site => {
            const a = document.createElement('a');
            a.className = 'card-link';
            a.href = site.url || '#';
            a.target = '_blank';
            a.rel = 'noopener noreferrer';

            const sealSpan = document.createElement('span');
            sealSpan.className = 'card-seal';
            sealSpan.textContent = site.seal || '🔗';

            const contentSpan = document.createElement('span');
            contentSpan.className = 'card-content';

            const h3 = document.createElement('h3');
            h3.textContent = site.name || '未命名';

            const descSpan = document.createElement('span');
            descSpan.className = 'card-desc';
            descSpan.textContent = site.desc || '';

            contentSpan.appendChild(h3);
            contentSpan.appendChild(descSpan);
            a.appendChild(sealSpan);
            a.appendChild(contentSpan);
            cardsContainer.appendChild(a);
        });
    }

    // ===== 9. 渲染用户列表 =====
    function renderUserList(users) {
        userListEl.innerHTML = '';
        if (!users) return;
        users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'list-item';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = user.username + (user.username === 'zlm' ? ' (管理员)' : '');
            div.appendChild(nameSpan);

            if (user.username !== 'zlm') {
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-sm del-user-btn';
                delBtn.textContent = '删除';
                delBtn.addEventListener('click', async () => {
                    if (!confirm(`确定删除账号 ${user.username} 吗？`)) return;
                    try {
                        await apiRequest(`/api/users/${user.username}`, { method: 'DELETE' });
                        alert('删除成功');
                        const updated = await apiRequest('/api/users');
                        renderUserList(updated);
                    } catch (e) {
                        alert(e.message);
                    }
                });
                div.appendChild(delBtn);
            }
            userListEl.appendChild(div);
        });
    }

    // ===== 10. 渲染网站管理列表 =====
    function renderSiteManageList(sites) {
        siteManageListEl.innerHTML = '';
        if (!sites) return;
        sites.forEach((site, idx) => {
            const div = document.createElement('div');
            div.className = 'list-item';

            const infoSpan = document.createElement('span');
            infoSpan.style.flex = '1';
            infoSpan.textContent = `${site.name || '未命名'} (${site.url || ''})`;
            div.appendChild(infoSpan);

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-sm del-site-btn';
            delBtn.textContent = '删除';
            delBtn.addEventListener('click', async () => {
                if (!confirm(`确定删除网站 "${site.name}" 吗？`)) return;
                try {
                    await apiRequest(`/api/sites/${idx}`, { method: 'DELETE' });
                    alert('删除成功');
                    const updated = await apiRequest('/api/sites');
                    renderCards(updated);
                    renderSiteManageList(updated);
                } catch (e) {
                    alert(e.message);
                }
            });
            div.appendChild(delBtn);
            siteManageListEl.appendChild(div);
        });
    }

    // ===== 11. 管理员操作：添加用户 =====
    addUserBtn.addEventListener('click', async () => {
        const username = newUserInput.value.trim();
        const password = newPassInput.value;
        if (!username || !password) {
            alert('账号密码不能为空');
            return;
        }
        try {
            await apiRequest('/api/users', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            alert('添加成功');
            newUserInput.value = '';
            newPassInput.value = '';
            const users = await apiRequest('/api/users');
            renderUserList(users);
        } catch (e) {
            alert(e.message);
        }
    });

    // ===== 12. 管理员操作：添加网站 =====
    addSiteBtn.addEventListener('click', async () => {
        const name = newSiteName.value.trim();
        const url = newSiteUrl.value.trim();
        const desc = newSiteDesc.value.trim();
        const seal = newSiteSeal.value.trim();
        if (!name || !url) {
            alert('网站名称和网址必填');
            return;
        }
        try {
            await apiRequest('/api/sites', {
                method: 'POST',
                body: JSON.stringify({ name, url, desc, seal })
            });
            alert('添加成功');
            newSiteName.value = '';
            newSiteUrl.value = '';
            newSiteDesc.value = '';
            newSiteSeal.value = '';
            const sites = await apiRequest('/api/sites');
            renderCards(sites);
            renderSiteManageList(sites);
        } catch (e) {
            alert(e.message);
        }
    });

    // ===== 13. 启动：页面加载时尝试恢复会话 =====
    window.addEventListener('load', async () => {
        if (token) {
            try {
                await apiRequest('/api/sites');
                try {
                    await apiRequest('/api/users');
                    currentUser = { username: 'zlm', role: 'admin' };
                } catch {
                    currentUser = { username: '用户', role: 'user' };
                }
                showMainApp();
            } catch (e) {
                token = '';
                sessionStorage.removeItem('gufeng_token');
                showLoginScreen();
            }
        } else {
            showLoginScreen();
        }
    });

})();
