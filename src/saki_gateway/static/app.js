/**
 * Saki Phone App — Gateway Dashboard
 * Connects to saki-gateway backend API for chat, memory, reminders, and settings.
 */

// ============================================
// SVG Icon Helper
// ============================================
function svgIcon(id, extraClass = '') {
  return `<svg class="icon${extraClass ? ' ' + extraClass : ''}"><use href="#i-${id}"/></svg>`;
}

// ============================================
// Main Application Class
// ============================================
class SakiPhoneApp {
  constructor() {
    this.currentPage = 'home';
    this.previousPage = null;
    this.chatHistory = [];
    this.isTyping = false;
    this.gatewayConfig = null;
    this.healthData = null;
    this.currentMemoryView = 'long_term';
    this.currentMemoryCategory = '';
    this.expandedLogIds = new Set();
    this.editingMemoryId = null;
    this.pendingAttachments = [];
    this.deferredInstallPrompt = null;
    this.isAuthenticated = false;
    this.init();
  }

  async apiFetch(url, options = {}) {
    const opts = {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    };
    const res = await fetch(url, opts);
    if (res.status === 401) {
      this.showAuthOverlay();
      const error = new Error('AUTH_REQUIRED');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    return res;
  }

  // ------------------------------------------
  // Initialization
  // ------------------------------------------
  async init() {
    this.loadLocalData();
    this.applyTheme(localStorage.getItem('saki_theme') || 'pink');
    this.setupEventListeners();
    this.setupPWA();
    this.setupTouchEvents();
    this.startClock();
    await this.checkAuthStatus();
    this.showHome();
  }

  loadLocalData() {
    try {
      this.chatHistory = JSON.parse(localStorage.getItem('saki_chat_history') || '[]');
    } catch {
      this.chatHistory = [];
    }
  }

  saveChatHistory() {
    try {
      // keep last 500 messages
      if (this.chatHistory.length > 500) {
        this.chatHistory = this.chatHistory.slice(-500);
      }
      localStorage.setItem('saki_chat_history', JSON.stringify(this.chatHistory));
    } catch (e) {
      console.warn('Failed to save chat history:', e);
    }
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideModal();
    });

    // Memory search debounce
    const searchInput = document.getElementById('memory-search');
    if (searchInput) {
      let timer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const q = searchInput.value.trim();
          if (q) {
            this.searchMemories(q);
          } else {
            this.renderMemories();
          }
        }, 400);
      });
    }

    // Auto-resize chat input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
      });
    }

    const fileInput = document.getElementById('chat-attachment-input');
    if (fileInput) {
      fileInput.addEventListener('change', (event) => this.handleAttachmentSelect(event));
    }
  }

  async checkAuthStatus() {
    try {
      const res = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' });
      const data = await res.json();
      this.isAuthenticated = !!data.authenticated || !data.required;
      if (this.isAuthenticated) {
        this.hideAuthOverlay();
      } else {
        this.showAuthOverlay();
      }
    } catch (_) {
      this.showAuthOverlay();
    }
  }

  showAuthOverlay(message = '') {
    const overlay = document.getElementById('auth-overlay');
    const error = document.getElementById('auth-error');
    if (overlay) overlay.style.display = 'flex';
    if (error) error.textContent = message;
  }

  hideAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    const error = document.getElementById('auth-error');
    const input = document.getElementById('auth-password');
    if (overlay) overlay.style.display = 'none';
    if (error) error.textContent = '';
    if (input) input.value = '';
  }

  async submitDashboardLogin() {
    const input = document.getElementById('auth-password');
    const password = input?.value?.trim() || '';
    if (!password) {
      this.showAuthOverlay('先把密码填上。');
      return;
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '登录失败');
      this.isAuthenticated = true;
      this.hideAuthOverlay();
      this.showToast('已进入面板', 'success');
      if (this.currentPage === 'settings') this.renderSettings();
    } catch (err) {
      this.showAuthOverlay(err.message || '登录失败');
    }
  }

  setupPWA() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredInstallPrompt = event;
      const btn = document.getElementById('install-app-btn');
      if (btn) btn.style.display = 'inline-flex';
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      const btn = document.getElementById('install-app-btn');
      if (btn) btn.style.display = 'none';
      this.showToast('已添加到桌面', 'success');
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
          console.warn('Service worker register failed:', err);
        });
      });
    }
  }

  async installPWA() {
    if (!this.deferredInstallPrompt) {
      this.showToast('浏览器暂时没有提供安装入口', 'info');
      return;
    }
    this.deferredInstallPrompt.prompt();
    await this.deferredInstallPrompt.userChoice.catch(() => null);
  }

  setupTouchEvents() {
    let startX = 0;
    document.addEventListener('touchstart', (e) => {
      startX = e.changedTouches[0].screenX;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      const endX = e.changedTouches[0].screenX;
      if (endX - startX > 100 && this.currentPage !== 'home') {
        this.goBack();
      }
    }, { passive: true });
  }

  startClock() {}

  // ------------------------------------------
  // Navigation
  // ------------------------------------------
  switchPage(name) {
    this.previousPage = this.currentPage;
    this.currentPage = name;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${name}`);
    if (target) {
      target.classList.add('active');
      target.style.animation = 'slideIn 0.3s ease-out';
    }

    this.updateBottomNav(name);

    switch (name) {
      case 'home': this.renderHome(); break;
      case 'chat': this.renderChat(); this.ensureChatInput(); break;
      case 'memory': this.renderMemories(); break;
      case 'reminders': this.renderReminders(); break;
      case 'settings': this.renderSettings(); break;
    }
  }

  updateBottomNav(page) {
    document.querySelectorAll('.tab-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
  }

  goBack() {
    if (this.previousPage && this.previousPage !== this.currentPage) {
      this.switchPage(this.previousPage);
    } else {
      this.showHome();
    }
  }

  showHome() { this.switchPage('home'); }
  showChat() { this.switchPage('chat'); }
  showMemory() { this.switchPage('memory'); }
  showReminders() { this.switchPage('reminders'); }
  showSettings() { this.switchPage('settings'); }

  // ------------------------------------------
  // Home Page
  // ------------------------------------------
  async renderHome() {
    let partnerName = 'TA';
    let online = false;
    let memoryCount = 0;
    let tools = [];

    try {
      const res = await this.apiFetch('/health');
      if (res.ok) {
        const data = await res.json();
        this.healthData = data;
        const state = data.state || {};
        partnerName = state.persona || 'TA';
        online = true;
        memoryCount = state.memory_count || 0;
        tools = state.enabled_tools || [];
      }
    } catch (err) {
      online = false;
      if (err?.code === 'AUTH_REQUIRED') {
        const statusText = document.getElementById('home-status-text');
        if (statusText) statusText.textContent = '需要重新登录';
      }
    }

    // Partner name
    const nameEl = document.getElementById('home-partner-name');
    if (nameEl) nameEl.textContent = partnerName;
    const chatName = document.getElementById('chat-partner-name');
    if (chatName) chatName.textContent = partnerName;
    const previewName = document.getElementById('preview-name');
    if (previewName) previewName.textContent = partnerName;

    // Status
    const dot = document.getElementById('home-status-dot');
    if (dot) {
      dot.className = 'status-dot ' + (online ? 'online' : 'offline');
    }
    const statusText = document.getElementById('home-status-text');
    if (statusText) statusText.textContent = online ? '在线' : '离线';

    // Memory count
    const memEl = document.getElementById('home-memory-count');
    if (memEl) memEl.textContent = `${memoryCount} 条记忆`;

    // Reminder count
    let reminderCount = 0;
    try {
      const rRes = await this.apiFetch('/api/reminders');
      
      if (rRes.ok) {
        const rData = await rRes.json();
        reminderCount = (rData.items || []).length;
      }
    } catch { /* ignore */ }
    const remEl = document.getElementById('home-reminder-count');
    if (remEl) remEl.textContent = reminderCount > 0 ? `${reminderCount} 个提醒` : '无提醒';

    // Tools list
    const toolsList = document.getElementById('home-tools-list');
    if (toolsList) {
      if (tools.length === 0) {
        toolsList.innerHTML = '<div class="empty-text">暂无启用的工具</div>';
      } else {
        toolsList.innerHTML = tools.map(t => `
          <div class="list-item">
            <div class="list-icon">${svgIcon('tool')}</div>
            <div class="list-content">
              <div class="list-title">${this.escapeHtml(t.id || t.name || 'tool')}</div>
              <div class="list-desc">${this.escapeHtml(t.description || '')}</div>
            </div>
          </div>
        `).join('');
      }
    }

    // Chat preview
    const lastAssistant = [...this.chatHistory].reverse().find(m => m.role === 'assistant');
    const previewText = document.getElementById('preview-text');
    if (previewText) {
      previewText.textContent = lastAssistant ? lastAssistant.content.slice(0, 80) : '点击开始聊天...';
    }
  }

  // ------------------------------------------
  // Chat Page
  // ------------------------------------------
  renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    if (this.chatHistory.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${svgIcon('chat', 'icon-xl')}</div>
          <p>开始你们的甜蜜聊天吧</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.chatHistory.map(msg => {
      if (msg.role === 'system') {
        return `<div class="chat-message system"><div class="system-content">${this.escapeHtml(msg.content)}</div></div>`;
      }
      const isUser = msg.role === 'user';
      const avatar = isUser ? svgIcon('user') : svgIcon('heart');
      const time = msg.timestamp ? this.formatTime(new Date(msg.timestamp)) : '';
      const visibleToolContexts = this.filterVisibleToolContexts(msg.toolContexts || []);
      const toolHtml = visibleToolContexts.length > 0
        ? visibleToolContexts.map(tc => `<div class="tool-context-indicator">${svgIcon('tool', 'icon-sm')} ${this.escapeHtml(tc.type || tc.name || 'tool')}</div>`).join('')
        : '';
      const segments = !isUser ? this.getMessageSegments(msg.content) : [msg.content || ''];
      const revealCount = !isUser && Number.isFinite(msg.segmentRevealCount)
        ? Math.max(1, Math.min(msg.segmentRevealCount, segments.length))
        : segments.length;
      const bubbleHtml = segments.slice(0, revealCount).map(segment => `
        <div class="message-bubble-inner${!isUser && segments.length > 1 ? ' segmented' : ''}">${this.renderMarkdown(segment)}</div>
      `).join('');

      return `
        <div class="chat-message ${isUser ? 'user' : 'assistant'}">
          <div class="message-avatar">${avatar}</div>
          <div class="message-body">
            <div class="message-header">
              <span>${isUser ? '我' : (this.healthData?.state?.persona || 'TA')}</span>
              <span>${time}</span>
            </div>
            ${toolHtml}
            <div class="message-bubbles">${bubbleHtml}</div>
          </div>
        </div>
      `;
    }).join('');

    this.scrollToBottom(container);
  }

  renderMarkdown(text) {
    let html = this.escapeHtml(text || '');
    return html.replace(/\n/g, '<br>');
  }

  getMessageSegments(text) {
    const source = String(text || '');
    const lineParts = source.split(/\n+/).map(part => part.trim()).filter(Boolean);
    if (lineParts.length > 1) return lineParts;

    const sentenceParts = source
      .split(/(?<=[。！？!?])/)
      .map(part => part.trim())
      .filter(Boolean);
    if (sentenceParts.length > 1) return sentenceParts;

    return lineParts.length > 0 ? lineParts : [source];
  }

  filterVisibleToolContexts(toolContexts = []) {
    return toolContexts.filter(tc => !this.isHiddenToolContext(tc));
  }

  isHiddenToolContext(toolContext = {}) {
    const raw = [toolContext.type, toolContext.name, toolContext.id, toolContext.tool, toolContext.tool_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return raw.includes('memory search')
      || raw.includes('memory_search')
      || raw.includes('memory-search')
      || (raw.includes('memory') && raw.includes('search'));
  }

  async sendMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    const attachments = [...this.pendingAttachments];
    if (!text && attachments.length === 0) return;

    const localContent = text || attachments.map(item => `[附件] ${item.name}`).join('\n');

    this.addMessage('user', localContent, { attachments });
    input.value = '';
    input.style.height = 'auto';
    this.pendingAttachments = [];
    this.renderAttachmentPreview();
    this.saveChatHistory();
    this.renderChat();

    this.showTypingIndicator();
    try {
      const res = await this.apiFetch('/api/chat/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: text ? [{ role: 'user', content: text }] : [],
          attachments
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`${res.status} ${errText.slice(0, 150)}`);
      }

      const data = await res.json();
      const content = data.content || '...';
      const toolContexts = data.tool_contexts || [];

      this.hideTypingIndicator();
      const assistantMessage = this.addMessage('assistant', content, {
        toolContexts,
        segmentRevealCount: 1
      });
      this.saveChatHistory();
      this.renderChat();
      await this.animateAssistantSegments(assistantMessage.id);
    } catch (err) {
      this.hideTypingIndicator();
      this.showToast(`请求失败: ${err.message}`, 'error');
    }
  }

  handleChatKeydown(e) {
    if (e.key === 'Enter') {
      return;
    }
  }

  addMessage(role, content, extra = {}) {
    const message = {
      id: this.generateId(),
      role,
      content,
      timestamp: new Date().toISOString(),
      ...extra
    };
    this.chatHistory.push(message);
    return message;
  }

  async animateAssistantSegments(messageId) {
    const msg = this.chatHistory.find(item => item.id === messageId && item.role === 'assistant');
    if (!msg) return;

    const segments = this.getMessageSegments(msg.content);
    if (segments.length <= 1) {
      delete msg.segmentRevealCount;
      this.saveChatHistory();
      return;
    }

    for (let i = 2; i <= segments.length; i++) {
      await this.delay(220);
      msg.segmentRevealCount = i;
      this.renderChat();
    }

    delete msg.segmentRevealCount;
    this.saveChatHistory();
    this.renderChat();
  }

  triggerAttachmentPicker() {
    const input = document.getElementById('chat-attachment-input');
    if (input) input.click();
  }

  async handleAttachmentSelect(event) {
    const files = Array.from(event?.target?.files || []);
    if (files.length === 0) return;
    const mapped = await Promise.all(files.map(file => this.serializeAttachment(file)));
    this.pendingAttachments = [...this.pendingAttachments, ...mapped.filter(Boolean)];
    this.renderAttachmentPreview();
    event.target.value = '';
  }

  async serializeAttachment(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(file);
    }).catch(() => '');
    if (!dataUrl) return null;

    const mime = file.type || 'application/octet-stream';
    const isImage = mime.startsWith('image/');
    const textLike = mime.startsWith('text/')
      || /json|javascript|xml|csv|markdown|pdf|word|sheet|excel|presentation|officedocument|msword/i.test(mime)
      || /\.(txt|md|json|csv|js|ts|html|css|xml|log|py|java|go|rs|pdf|doc|docx|xls|xlsx|ppt|pptx)$/i.test(file.name);

    return {
      type: isImage ? 'image' : 'file',
      url: dataUrl,
      name: file.name,
      mime_type: mime,
      note: file.name,
      text_content: !isImage && textLike ? await file.text().catch(() => '') : ''
    };
  }

  renderAttachmentPreview() {
    const container = document.getElementById('chat-attachment-preview');
    if (!container) return;
    if (this.pendingAttachments.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML = this.pendingAttachments.map((item, index) => `
      <div class="attachment-chip">
        <span>${this.escapeHtml(item.name || '附件')}</span>
        <button type="button" onclick="app.removePendingAttachment(${index})">×</button>
      </div>
    `).join('');
  }

  removePendingAttachment(index) {
    this.pendingAttachments.splice(index, 1);
    this.renderAttachmentPreview();
  }

  showTypingIndicator() {
    this.isTyping = true;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const existing = container.querySelector('.typing-indicator');
    if (existing) return;
    const div = document.createElement('div');
    div.className = 'chat-message assistant typing-indicator';
    div.innerHTML = `
      <div class="message-avatar">${svgIcon('heart')}</div>
      <div class="message-body">
        <div class="message-bubble-inner">
          <div class="typing-dots"><span></span><span></span><span></span></div>
        </div>
      </div>
    `;
    container.appendChild(div);
    this.scrollToBottom(container);
  }

  hideTypingIndicator() {
    this.isTyping = false;
    const el = document.querySelector('.typing-indicator');
    if (el) el.remove();
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  ensureChatInput() {
    const area = document.getElementById('chat-input-area');
    if (area) {
      area.style.display = 'flex';
      area.style.visibility = 'visible';
    }
  }

  showChatMenu() {
    this.showModal('聊天', `
      <div style="padding:8px 0;">
        <p style="font-size:13px;color:var(--secondary-text);margin-bottom:16px;">
          聊天记录保存在本地浏览器中。网关服务端维护独立会话历史。
        </p>
      </div>
    `, `
      <button class="btn btn-danger" onclick="app.clearChatHistory()">清除本地聊天</button>
      <button class="btn btn-secondary" onclick="app.hideModal()">关闭</button>
    `);
  }

  clearChatHistory() {
    this.chatHistory = [];
    this.saveChatHistory();
    this.renderChat();
    this.hideModal();
    this.showToast('聊天记录已清除', 'success');
  }

  scrollToBottom(container) {
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  // ------------------------------------------
  // Memory Page
  // ------------------------------------------
  async renderMemories() {
    const tabsEl = document.getElementById('memory-tabs');
    const contentEl = document.getElementById('memory-content');
    if (!tabsEl || !contentEl) return;

    contentEl.innerHTML = '<div class="empty-text">加载中...</div>';

    try {
      if (this.currentMemoryView === 'logs') {
        const res = await this.apiFetch('/api/logs');
        if (!res.ok) throw new Error('Failed to load logs');
        const data = await res.json();
        const items = data.items || [];

        tabsEl.innerHTML = `
          <div class="memory-tab ${this.currentMemoryView === 'long_term' ? 'active' : ''}" onclick="app.switchMemoryView('long_term')">
            长期记忆
          </div>
          <div class="memory-tab ${this.currentMemoryView === 'logs' ? 'active' : ''}" onclick="app.switchMemoryView('logs')">
            今日日志 <span class="tab-count">${items.length}</span>
          </div>
        `;

        if (items.length === 0) {
          contentEl.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">${svgIcon('clock', 'icon-xl')}</div>
              <p>今天还没有生成日志</p>
              <div class="empty-text">聊天消息达到 20 条后，会更新同一天的那一条日志。</div>
            </div>
          `;
          return;
        }

        contentEl.innerHTML = `<div class="memory-log-list">${items.map(m => `
          <div class="memory-card memory-log-card ${this.expandedLogIds.has(String(m.id || '')) ? 'expanded' : ''}">
            <div class="memory-card-header memory-log-header" onclick="app.toggleLogCard('${this.escAttr(String(m.id || ''))}')">
              <div class="memory-log-main">
                <span class="memory-date">${m.date || ''}</span>
                <div class="memory-title">${this.escapeHtml(m.title || m.key || '未命名日志')}</div>
              </div>
              <div class="memory-log-side">
                <span class="memory-log-badge">只读日志</span>
                <span class="memory-log-toggle-label">${this.expandedLogIds.has(String(m.id || '')) ? '收起' : '展开'}</span>
              </div>
            </div>
            <div class="memory-card-body memory-log-body ${this.expandedLogIds.has(String(m.id || '')) ? 'expanded' : ''}">
              <div class="memory-log-content">${this.escapeHtml(m.content || '')}</div>
            </div>
          </div>
        `).join('')}</div>`;
        return;
      }

      const res = await this.apiFetch('/api/memories');
      if (!res.ok) throw new Error('Failed to load memories');
      const data = await res.json();

      const items = data.items || [];
      this.memoryCache = items;
      const stats = data.stats || {};

      const categories = [
        { key: '', label: '全部', count: items.length },
        { key: 'anniversary', label: '纪念日', count: stats.anniversary || 0 },
        { key: 'preference', label: '喜好', count: stats.preference || 0 },
        { key: 'promise', label: '约定', count: stats.promise || 0 },
        { key: 'event', label: '事件', count: stats.event || 0 },
        { key: 'emotion', label: '情绪', count: stats.emotion || 0 },
        { key: 'habit', label: '习惯', count: stats.habit || 0 },
        { key: 'boundary', label: '边界', count: stats.boundary || 0 },
        { key: 'other', label: '其他', count: stats.other || 0 },
      ];

      tabsEl.innerHTML = `
        <div class="memory-tab ${this.currentMemoryView === 'long_term' ? 'active' : ''}" onclick="app.switchMemoryView('long_term')">
          长期记忆 <span class="tab-count">${items.length}</span>
        </div>
        <div class="memory-tab ${this.currentMemoryView === 'logs' ? 'active' : ''}" onclick="app.switchMemoryView('logs')">
          今日日志
        </div>
        ${categories.map(c => `
          <div class="memory-tab ${this.currentMemoryCategory === c.key ? 'active' : ''}"
               onclick="app.filterMemoryCategory('${c.key}')">
            ${c.label} <span class="tab-count">${c.count}</span>
          </div>
        `).join('')}
      `;

      const filtered = this.currentMemoryCategory
        ? items.filter(m => m.category === this.currentMemoryCategory)
        : items;

      if (filtered.length === 0) {
        contentEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">${svgIcon('memory', 'icon-xl')}</div>
            <p>暂无长期记忆</p>
            <button class="btn btn-primary btn-sm" onclick="app.showAddMemoryModal()">添加记忆</button>
          </div>
        `;
        return;
      }

      contentEl.innerHTML = `<div class="memory-log-list">${filtered.map(m => `
        <div class="memory-card memory-log-card ${this.expandedLogIds.has(String(m.id || '')) ? 'expanded' : ''}">
          <div class="memory-card-header memory-log-header" onclick="app.toggleLogCard('${this.escAttr(String(m.id || ''))}')">
            <div class="memory-log-main">
              <span class="memory-date">${this.escapeHtml(m.date || '')}</span>
              <div class="memory-title">${this.escapeHtml(m.title || m.key || '')}</div>
            </div>
            <div class="memory-log-side">
              <span class="memory-log-badge">${this.escapeHtml(m.category || '记忆')}</span>
              <span class="memory-log-toggle-label">${this.expandedLogIds.has(String(m.id || '')) ? '收起' : '展开'}</span>
            </div>
          </div>
          <div class="memory-card-body memory-log-body ${this.expandedLogIds.has(String(m.id || '')) ? 'expanded' : ''}">
            <div class="memory-log-content">${this.escapeHtml(m.content || '')}</div>
            <div class="memory-card-footer memory-unified-footer">
              <button class="action-btn" onclick="event.stopPropagation(); app.showEditMemoryModal('${this.escAttr(String(m.id || ''))}')" title="编辑">
                ${svgIcon('edit', 'icon-sm')}
              </button>
              <button class="action-btn delete" onclick="event.stopPropagation(); app.deleteMemory('${this.escAttr(String(m.id || ''))}')" title="删除">
                ${svgIcon('trash', 'icon-sm')}
              </button>
            </div>
          </div>
        </div>
      `).join('')}</div>`;

    } catch (err) {
      contentEl.innerHTML = `<div class="empty-text">加载失败: ${this.escapeHtml(err.message)}</div>`;
    }
  }

  switchMemoryView(view) {
    this.currentMemoryView = view;
    if (view === 'logs') {
      this.currentMemoryCategory = '';
    }
    const addBtn = document.getElementById('memory-add-btn');
    if (addBtn) {
      addBtn.style.display = view === 'logs' ? 'none' : 'inline-flex';
    }
    this.renderMemories();
  }

  filterMemoryCategory(key) {
    this.currentMemoryView = 'long_term';
    this.currentMemoryCategory = key;
    this.renderMemories();
  }

  toggleLogCard(id) {
    const key = String(id || '').trim();
    if (!key) return;
    if (this.expandedLogIds.has(key)) {
      this.expandedLogIds.delete(key);
    } else {
      this.expandedLogIds.add(key);
    }
    this.renderMemories();
  }

  async searchMemories(query) {
    const contentEl = document.getElementById('memory-content');
    if (!contentEl) return;

    if (this.currentMemoryView === 'logs') {
      this.renderMemories();
      return;
    }

    try {
      const res = await this.apiFetch(`/api/memories/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      const items = data.items || data.results || [];

      if (items.length === 0) {
        contentEl.innerHTML = '<div class="empty-text">未找到匹配的记忆</div>';
        return;
      }

      contentEl.innerHTML = `<div class="memory-log-list">${items.map(m => `
        <div class="memory-card memory-log-card ${this.expandedLogIds.has(String(m.id || '')) ? 'expanded' : ''}">
          <div class="memory-card-header memory-log-header" onclick="app.toggleLogCard('${this.escAttr(String(m.id || ''))}')">
            <div class="memory-log-main">
              <span class="memory-date">${this.escapeHtml(m.date || '')}</span>
              <div class="memory-title">${this.escapeHtml(m.title || m.key || '')}</div>
            </div>
            <div class="memory-log-side">
              <span class="memory-log-badge">${this.escapeHtml(m.category || '记忆')}</span>
              <span class="memory-log-toggle-label">${this.expandedLogIds.has(String(m.id || '')) ? '收起' : '展开'}</span>
            </div>
          </div>
          <div class="memory-card-body memory-log-body ${this.expandedLogIds.has(String(m.id || '')) ? 'expanded' : ''}">
            <div class="memory-log-content">${this.escapeHtml(m.content || '')}</div>
            <div class="memory-card-footer memory-unified-footer">
              <button class="action-btn" onclick="event.stopPropagation(); app.showEditMemoryModal('${this.escAttr(String(m.id || ''))}')" title="编辑">
                ${svgIcon('edit', 'icon-sm')}
              </button>
              <button class="action-btn delete" onclick="event.stopPropagation(); app.deleteMemory('${this.escAttr(String(m.id || ''))}')" title="删除">
                ${svgIcon('trash', 'icon-sm')}
              </button>
            </div>
          </div>
        </div>
      `).join('')}</div>`;
    } catch (err) {
      contentEl.innerHTML = `<div class="empty-text">搜索失败: ${this.escapeHtml(err.message)}</div>`;
    }
  }

  showAddMemoryModal() {
    this.showModal('添加记忆', `
      <div class="form-group">
        <label>标题</label>
        <input type="text" id="mem-title" placeholder="记忆标题">
      </div>
      <div class="form-group">
        <label>内容</label>
        <textarea id="mem-content" rows="4" placeholder="记忆内容"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>分类</label>
          <select id="mem-category">
            <option value="preference">喜好</option>
            <option value="anniversary">纪念日</option>
            <option value="promise">约定</option>
            <option value="story">故事</option>
            <option value="password">密码</option>
            <option value="travel">旅行</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div class="form-group">
          <label>重要度 (0-1)</label>
          <input type="number" id="mem-importance" min="0" max="1" step="0.1" value="0.5">
        </div>
      </div>
    `, `
      <button class="btn btn-secondary" onclick="app.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="app.saveNewMemory()">保存</button>
    `);
  }

  showEditMemoryModal(id) {
    const item = (this.memoryCache || []).find(m => String(m.id || '') === String(id || ''));
    if (!item) {
      this.showToast('没找到这条记忆', 'warning');
      return;
    }
    this.editingMemoryId = String(item.id || '');
    this.showModal('编辑记忆', `
      <div class="form-group">
        <label>标题</label>
        <input type="text" id="mem-title" value="${this.escAttr(item.title || item.key || '')}">
      </div>
      <div class="form-group">
        <label>内容</label>
        <textarea id="mem-content" rows="4">${this.escapeHtml(item.content || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>分类</label>
          <select id="mem-category">
            <option value="preference" ${(item.category || '') === 'preference' ? 'selected' : ''}>喜好</option>
            <option value="anniversary" ${(item.category || '') === 'anniversary' ? 'selected' : ''}>纪念日</option>
            <option value="promise" ${(item.category || '') === 'promise' ? 'selected' : ''}>约定</option>
            <option value="story" ${(item.category || '') === 'story' ? 'selected' : ''}>故事</option>
            <option value="password" ${(item.category || '') === 'password' ? 'selected' : ''}>密码</option>
            <option value="travel" ${(item.category || '') === 'travel' ? 'selected' : ''}>旅行</option>
            <option value="other" ${!item.category || item.category === 'other' ? 'selected' : ''}>其他</option>
          </select>
        </div>
        <div class="form-group">
          <label>重要度 (0-1)</label>
          <input type="number" id="mem-importance" min="0" max="1" step="0.1" value="${this.escAttr(String(item.importance ?? 0.5))}">
        </div>
      </div>
    `, `
      <button class="btn btn-secondary" onclick="app.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="app.updateMemory()">保存修改</button>
    `);
  }

  async saveNewMemory() {
    const title = document.getElementById('mem-title')?.value?.trim();
    const content = document.getElementById('mem-content')?.value?.trim();
    const category = document.getElementById('mem-category')?.value || 'other';
    const importance = parseFloat(document.getElementById('mem-importance')?.value) || 0.5;

    if (!title || !content) {
      this.showToast('请填写标题和内容', 'warning');
      return;
    }

    try {
      const res = await this.apiFetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, key: title, content, category, importance })
      });
      if (!res.ok) throw new Error('Failed to save');
      this.hideModal();
      this.showToast('记忆已保存', 'success');
      this.renderMemories();
    } catch (err) {
      this.showToast(`保存失败: ${err.message}`, 'error');
    }
  }

  async updateMemory() {
    const id = this.editingMemoryId;
    const title = document.getElementById('mem-title')?.value?.trim();
    const content = document.getElementById('mem-content')?.value?.trim();
    const category = document.getElementById('mem-category')?.value || 'other';
    const importance = parseFloat(document.getElementById('mem-importance')?.value) || 0.5;

    if (!id || !title || !content) {
      this.showToast('请填写标题和内容', 'warning');
      return;
    }

    try {
      const res = await this.apiFetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, key: title, content, category, importance })
      });
      if (!res.ok) throw new Error('Failed to update');
      this.hideModal();
      this.showToast('记忆已更新', 'success');
      this.renderMemories();
    } catch (err) {
      this.showToast(`更新失败: ${err.message}`, 'error');
    }
  }

  async deleteMemory(id) {
    if (!confirm('确定删除这条记忆？')) return;
    try {
      const res = await this.apiFetch(`/api/memories/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      this.showToast('已删除', 'success');
      this.renderMemories();
    } catch (err) {
      this.showToast(`删除失败: ${err.message}`, 'error');
    }
  }

  async clearAllMemories() {
    if (!confirm('确定一键清空所有长期记忆和日志吗？此操作不可恢复。')) return;
    try {
      const res = await this.apiFetch('/api/memories', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear memories');
      this.expandedLogIds.clear();
      this.showToast('记忆和日志已清空', 'success');
      this.renderMemories();
    } catch (err) {
      this.showToast(`清空失败: ${err.message}`, 'error');
    }
  }

  async clearLongTermMemories() {
    if (!confirm('确定清除所有长期记忆？日志会保留。此操作不可恢复。')) return;
    try {
      const res = await this.apiFetch('/api/memories/long-term', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear long-term memories');
      this.showToast('长期记忆已清除', 'success');
      this.renderMemories();
    } catch (err) {
      this.showToast(`清除失败: ${err.message}`, 'error');
    }
  }

  async clearLogs() {
    if (!confirm('确定清除所有日志？长期记忆会保留。此操作不可恢复。')) return;
    try {
      const res = await this.apiFetch('/api/logs', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear logs');
      this.expandedLogIds.clear();
      this.showToast('日志已清除', 'success');
      this.renderMemories();
    } catch (err) {
      this.showToast(`清除失败: ${err.message}`, 'error');
    }
  }

  async digestMemories() {
    if (!confirm('根据今日日志整理长期记忆？日志本身不会被修改。')) return;
    try {
      const res = await this.apiFetch('/api/memories/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to digest memories');
      if (data.success === false) {
        this.showToast(data.message || '没有可整理的日志', 'warning');
        return;
      }
      const changed = Number(data.changed || 0);
      const summary = changed > 0
        ? `整理完成：新增 ${Number(data.created || 0)}，更新 ${Number(data.updated || 0)}`
        : (data.message || '整理完成，没有发现需要写入的长期记忆');
      this.showToast(summary, 'success');
      this.renderMemories();
    } catch (err) {
      this.showToast(`整理失败: ${err.message}`, 'error');
    }
  }

  // ------------------------------------------
  // Reminders Page
  // ------------------------------------------
  async renderReminders() {
    const container = document.getElementById('reminders-content');
    if (!container) return;

    container.innerHTML = '<div class="empty-text">加载中...</div>';

    try {
      const res = await this.apiFetch('/api/reminders');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const items = data.items || [];

      if (items.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">${svgIcon('bell', 'icon-xl')}</div>
            <p>暂无提醒</p>
            <button class="btn btn-primary btn-sm" onclick="app.showAddReminderModal()">创建提醒</button>
          </div>
        `;
        return;
      }

      container.innerHTML = items.map(r => {
        const statusClass = r.status === 'delivered' ? 'delivered' : 'pending';
        const statusLabel = r.status === 'delivered' ? '已送达' : '等待中';
        const triggerTime = r.trigger_at ? this.formatDateTime(new Date(r.trigger_at)) : '';

        return `
          <div class="reminder-item">
            <div class="list-icon">${svgIcon('bell')}</div>
            <div class="reminder-info">
              <div class="reminder-content">${this.escapeHtml(r.content)}</div>
              <div class="reminder-meta">${triggerTime}</div>
            </div>
            <span class="reminder-status ${statusClass}">${statusLabel}</span>
            <button class="action-btn delete" onclick="app.deleteReminder('${r.id}')" title="删除">
              ${svgIcon('trash', 'icon-sm')}
            </button>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<div class="empty-text">加载失败: ${this.escapeHtml(err.message)}</div>`;
    }
  }

  showAddReminderModal() {
    this.showModal('创建提醒', `
      <div class="form-group">
        <label>提醒内容</label>
        <input type="text" id="rem-content" placeholder="提醒我做什么...">
      </div>
      <div class="form-group">
        <label>多少分钟后提醒</label>
        <input type="number" id="rem-minutes" min="1" value="30" placeholder="分钟">
      </div>
    `, `
      <button class="btn btn-secondary" onclick="app.hideModal()">取消</button>
      <button class="btn btn-primary" onclick="app.createNewReminder()">创建</button>
    `);
  }

  async createNewReminder() {
    const content = document.getElementById('rem-content')?.value?.trim();
    const minutes = parseInt(document.getElementById('rem-minutes')?.value) || 0;

    if (!content) {
      this.showToast('请填写提醒内容', 'warning');
      return;
    }
    if (minutes <= 0) {
      this.showToast('请输入有效的分钟数', 'warning');
      return;
    }

    try {
      const res = await this.apiFetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, minutes })
      });
      if (!res.ok) throw new Error('Failed to create');
      this.hideModal();
      this.showToast('提醒已创建', 'success');
      this.renderReminders();
    } catch (err) {
      this.showToast(`创建失败: ${err.message}`, 'error');
    }
  }

  async deleteReminder(id) {
    try {
      const res = await this.apiFetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      this.showToast('已删除', 'success');
      this.renderReminders();
    } catch (err) {
      this.showToast(`删除失败: ${err.message}`, 'error');
    }
  }

  // ------------------------------------------
  // Settings Page
  // ------------------------------------------
  async renderSettings() {
    const statusEl = document.getElementById('settings-gateway-status');
    const contentEl = document.getElementById('settings-content');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="empty-text">加载中...</div>';

    let health = null;
    let config = null;
    let authExpired = false;

    try {
      const [hRes, cRes] = await Promise.all([
        this.apiFetch('/health'),
        this.apiFetch('/api/config')
      ]);
      if (hRes.ok) health = await hRes.json();
      if (cRes.ok) config = await cRes.json();
    } catch (err) {
      authExpired = err?.code === 'AUTH_REQUIRED';
    }

    if (!config) {
      contentEl.innerHTML = authExpired
        ? '<div class="empty-text">面板登录已失效，请刷新页面后重新输入密码。</div>'
        : '<div class="empty-text">无法连接到网关接口。更像是静态页面打开了，但 API 没通；请检查网关服务、反向代理和浏览器缓存。</div>';
      if (statusEl) statusEl.innerHTML = '';
      return;
    }

    this.gatewayConfig = config;

    // Gateway status
    if (statusEl) {
      const state = health?.state || {};
      const memCount = state.memory_count || 0;
      const sessions = state.runtime?.sessions || 0;
      const events = state.runtime?.events || 0;
      const toolCount = (state.enabled_tools || []).length;

      statusEl.innerHTML = `
        <div class="gateway-info-grid">
          <div class="gateway-info-item">
            <span class="gateway-info-label">状态</span>
            <span class="gateway-info-value" style="color: var(--success-dark);">在线</span>
          </div>
          <div class="gateway-info-item">
            <span class="gateway-info-label">记忆</span>
            <span class="gateway-info-value">${memCount}</span>
          </div>
          <div class="gateway-info-item">
            <span class="gateway-info-label">会话</span>
            <span class="gateway-info-value">${sessions}</span>
          </div>
          <div class="gateway-info-item">
            <span class="gateway-info-label">工具</span>
            <span class="gateway-info-value">${toolCount}</span>
          </div>
        </div>
      `;
    }

    // Settings sections
    contentEl.innerHTML = this.buildSettingsSections(config);
  }

  async refreshGatewayConfig() {
    this.showToast('刷新中...', 'info');
    await this.renderSettings();
    this.showToast('已刷新', 'success');
  }

  buildSettingsSections(c) {
    const persona = c.persona || {};
    const chatApi = c.chat_api || {};
    const actionApi = c.action_api || {};
    const searchApi = c.search_api || {};
    const ttsApi = c.tts_api || {};
    const imageApi = c.image_api || {};
    const memory = c.memory || {};
    const session = c.session || {};
    const scheduler = c.scheduler || {};
    const channels = c.channels || {};
    const dashboardSecurity = c.dashboard_security || {};

    return `
      <!-- Persona -->
      <div class="settings-section" id="sec-persona">
        <h4>${svgIcon('heart', 'icon-sm')} 人设</h4>
        <div class="setting-item">
          <label>伴侣名字</label>
          <input type="text" id="cfg-persona-partner_name" value="${this.escAttr(persona.partner_name || '')}">
        </div>
        <div class="setting-item">
          <label>伴侣角色</label>
          <input type="text" id="cfg-persona-partner_role" value="${this.escAttr(persona.partner_role || '')}">
        </div>
        <div class="setting-item">
          <label>对你的称呼</label>
          <input type="text" id="cfg-persona-call_user" value="${this.escAttr(persona.call_user || '')}">
        </div>
        <div class="setting-item">
          <label>核心气质</label>
          <textarea id="cfg-persona-core_identity" rows="3">${this.escapeHtml(persona.core_identity || '')}</textarea>
        </div>
        <div class="setting-item">
          <label>互动边界</label>
          <textarea id="cfg-persona-boundaries" rows="2">${this.escapeHtml(persona.boundaries || '')}</textarea>
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('persona')">保存人设</button>
      </div>

      <!-- Chat API -->
      ${this.buildApiSection('chat_api', '聊天 API', 'chat', chatApi)}

      <!-- Action API -->
      ${this.buildActionApiSection(actionApi)}

      <!-- Search API -->
      ${this.buildApiSection('search_api', '搜索 API', 'search', searchApi)}

      <!-- TTS API -->
      ${this.buildTtsApiSection(ttsApi)}

      <!-- Image API -->
      ${this.buildApiSection('image_api', '图像 API', 'star', imageApi)}

      <!-- Memory -->
      <div class="settings-section" id="sec-memory">
        <h4>${svgIcon('memory', 'icon-sm')} 记忆系统</h4>
        <div class="setting-item toggle">
          <label>启用记忆</label>
          <label class="switch">
            <input type="checkbox" id="cfg-memory-enabled" ${memory.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('memory')">保存</button>
      </div>

      <!-- Session -->
      <div class="settings-section" id="sec-session">
        <h4>${svgIcon('clock', 'icon-sm')} 会话</h4>
        <div class="setting-item toggle">
          <label>启用会话管理</label>
          <label class="switch">
            <input type="checkbox" id="cfg-session-enabled" ${session.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <label>空闲轮转 (分钟)</label>
          <input type="number" id="cfg-session-idle_rotation_minutes" value="${session.idle_rotation_minutes || 360}">
        </div>
        <div class="setting-item">
          <label>上下文消息数</label>
          <input type="number" id="cfg-session-recent_message_limit" value="${session.recent_message_limit || 12}">
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('session')">保存</button>
      </div>

      <!-- Scheduler -->
      <div class="settings-section" id="sec-scheduler">
        <h4>${svgIcon('clock', 'icon-sm')} 调度器</h4>
        <div class="setting-item toggle">
          <label>启用调度器</label>
          <label class="switch">
            <input type="checkbox" id="cfg-scheduler-enabled" ${scheduler.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item toggle">
          <label>主动消息</label>
          <label class="switch">
            <input type="checkbox" id="cfg-scheduler-proactive_enabled" ${scheduler.proactive_enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <label>主动消息空闲阈值 (小时)</label>
          <input type="number" id="cfg-scheduler-proactive_idle_hours" value="${scheduler.proactive_idle_hours || 72}">
        </div>
        <div class="setting-item">
          <label>额外空闲阈值 (分钟)</label>
          <input type="number" id="cfg-scheduler-proactive_idle_minutes" value="${scheduler.proactive_idle_minutes || 0}">
        </div>
        <div class="setting-item">
          <label>白天开始小时</label>
          <input type="number" id="cfg-scheduler-proactive_day_start_hour" value="${scheduler.proactive_day_start_hour ?? 8}" min="0" max="23">
        </div>
        <div class="setting-item">
          <label>白天结束小时</label>
          <input type="number" id="cfg-scheduler-proactive_day_end_hour" value="${scheduler.proactive_day_end_hour ?? 22}" min="0" max="23">
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('scheduler')">保存</button>
      </div>

      <!-- Channels -->
      <div class="settings-section" id="sec-channels">
        <h4>${svgIcon('chat', 'icon-sm')} 渠道</h4>
        <div class="setting-item toggle">
          <label>飞书</label>
          <label class="switch">
            <input type="checkbox" id="cfg-channels-feishu_enabled" ${channels.feishu_enabled ? 'checked' : ''}
                   onchange="app.toggleFeishuFields()">
            <span class="slider"></span>
          </label>
        </div>
        <div id="feishu-fields" style="display:${channels.feishu_enabled ? 'block' : 'none'};">
          <div class="setting-item">
            <label>App ID</label>
            <input type="text" id="cfg-channels-feishu_app_id" value="${this.escAttr(channels.feishu_app_id || '')}">
          </div>
          <div class="setting-item">
            <label>App Secret</label>
            <input type="password" id="cfg-channels-feishu_app_secret" value="${this.escAttr(channels.feishu_app_secret || '')}">
          </div>
        </div>

        <div class="setting-item toggle" style="margin-top:16px;">
          <label>QQ Bot</label>
          <label class="switch">
            <input type="checkbox" id="cfg-channels-qqbot_enabled" ${channels.qqbot_enabled ? 'checked' : ''}
                   onchange="app.toggleQQBotFields()">
            <span class="slider"></span>
          </label>
        </div>
        <div id="qqbot-fields" style="display:${channels.qqbot_enabled ? 'block' : 'none'};">
          <div class="setting-item">
            <label>App ID</label>
            <input type="text" id="cfg-channels-qqbot_app_id" value="${this.escAttr(channels.qqbot_app_id || '')}" placeholder="QQ Bot AppID">
          </div>
          <div class="setting-item">
            <label>Token / Secret</label>
            <input type="password" id="cfg-channels-qqbot_token" value="${this.escAttr(channels.qqbot_token || '')}" placeholder="QQ Bot Token / Secret">
          </div>
          <div class="about-info" style="margin-bottom:12px;">使用 QQ 开放平台官方机器人接入。保存后即可由网关直接连接官方 QQBot 通道，不再依赖 NapCat。</div>
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('channels')">保存</button>
      </div>

      <!-- Dashboard Security -->
      <div class="settings-section" id="sec-dashboard-security">
        <h4>${svgIcon('lock', 'icon-sm')} 面板密码</h4>
        <div class="setting-item toggle">
          <label>启用密码保护</label>
          <label class="switch">
            <input type="checkbox" id="cfg-dashboard-security-enabled" ${dashboardSecurity.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <label>新密码</label>
          <input type="password" id="cfg-dashboard-security-password" value="" placeholder="留空则不修改当前密码">
        </div>
        <div class="setting-item">
          <label>确认新密码</label>
          <input type="password" id="cfg-dashboard-security-password_confirm" value="" placeholder="再次输入新密码">
        </div>
        <div class="about-info" style="margin-bottom:12px;">默认密码是 admin123。修改密码后面板会自动刷新并要求重新登录。</div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('dashboard_security')">保存密码设置</button>
      </div>

      <div class="settings-section" id="sec-data-transfer">
        <h4>${svgIcon('download', 'icon-sm')} 数据导入 / 导出</h4>
        <div class="about-info" style="margin-bottom:12px;">导出内容包含人设、长期记忆和今日日志。导入采用合并更新，不会先清空现有数据。</div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.exportDataBackup()">导出 JSON</button>
        <button class="btn btn-secondary btn-block" style="margin-top:10px;" onclick="app.openImportDataPicker()">导入 JSON</button>
        <input type="file" id="data-import-input" accept="application/json,.json" style="display:none;" onchange="app.importDataBackup(event)">
      </div>

      <!-- Theme -->
      <div class="settings-section">
        <h4>${svgIcon('star', 'icon-sm')} 主题</h4>
        <div class="theme-selector">
          ${['pink', 'blue', 'purple', 'green', 'orange'].map(t => `
            <div class="theme-option ${(localStorage.getItem('saki_theme') || 'pink') === t ? 'active' : ''}"
                 style="background: ${this.themePreviewColor(t)};"
                 onclick="app.setTheme('${t}')">
            </div>
          `).join('')}
        </div>
      </div>

      <!-- About -->
      <div class="settings-section">
        <h4>${svgIcon('info', 'icon-sm')} 关于</h4>
        <div class="about-info">
          <strong>咲手机 Gateway</strong><br>
          版本: 2.0.0<br>
          网关驱动的 AI 伴侣面板
        </div>
        <div class="setting-actions" style="margin-top:12px;">
          <button class="btn btn-danger btn-block" onclick="app.clearChatHistory(); app.showToast('聊天已清除','success');">清除本地聊天</button>
        </div>
      </div>
    `;
  }

  buildApiSection(key, label, icon, api) {
    return `
      <div class="settings-section" id="sec-${key}">
        <h4>${svgIcon(icon, 'icon-sm')} ${label}</h4>
        <div class="setting-item toggle">
          <label>启用</label>
          <label class="switch">
            <input type="checkbox" id="cfg-${key}-enabled" ${api.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <label>Base URL</label>
          <input type="text" id="cfg-${key}-base_url" value="${this.escAttr(api.base_url || '')}" placeholder="https://api.openai.com/v1">
        </div>
        <div class="setting-item">
          <label>API Key</label>
          <input type="password" id="cfg-${key}-api_key" value="${this.escAttr(api.api_key || '')}" placeholder="sk-...">
        </div>
        <div class="setting-item">
          <label>Model</label>
          <input type="text" id="cfg-${key}-model" value="${this.escAttr(api.model || '')}" placeholder="gpt-4o">
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('${key}')">保存</button>
      </div>
    `;
  }

  buildActionApiSection(api) {
    return `
      <div class="settings-section" id="sec-action_api">
        <h4>${svgIcon('tool', 'icon-sm')} 工具执行 API</h4>
        <div class="setting-item toggle">
          <label>启用</label>
          <label class="switch">
            <input type="checkbox" id="cfg-action_api-enabled" ${api.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <label>Base URL</label>
          <input type="text" id="cfg-action_api-base_url" value="${this.escAttr(api.base_url || '')}" placeholder="https://api.openai.com/v1">
        </div>
        <div class="setting-item">
          <label>API Key</label>
          <input type="password" id="cfg-action_api-api_key" value="${this.escAttr(api.api_key || '')}" placeholder="sk-...">
        </div>
        <div class="setting-item">
          <label>Model</label>
          <input type="text" id="cfg-action_api-model" value="${this.escAttr(api.model || '')}" placeholder="gpt-4o-mini">
        </div>
        <div class="setting-item toggle">
          <label>启用 MCP</label>
          <label class="switch">
            <input type="checkbox" id="cfg-action_api-enable_mcp" ${api.enable_mcp ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('action_api')">保存</button>
      </div>
    `;
  }

  buildTtsApiSection(api) {
    return `
      <div class="settings-section" id="sec-tts_api">
        <h4>${svgIcon('mic', 'icon-sm')} TTS API</h4>
        <div class="setting-item toggle">
          <label>启用</label>
          <label class="switch">
            <input type="checkbox" id="cfg-tts_api-enabled" ${api.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <label>Group ID</label>
          <input type="text" id="cfg-tts_api-group_id" value="${this.escAttr(api.group_id || '')}" placeholder="MiniMax Group ID">
        </div>
        <div class="setting-item">
          <label>API Key</label>
          <input type="password" id="cfg-tts_api-api_key" value="${this.escAttr(api.api_key || '')}" placeholder="MiniMax API Key">
        </div>
        <div class="setting-item">
          <label>音色 ID</label>
          <input type="text" id="cfg-tts_api-voice_id" value="${this.escAttr(api.voice_id || 'Chinese (Mandarin)_Unrestrained_Young_Man')}" placeholder="Chinese (Mandarin)_Unrestrained_Young_Man">
        </div>
        <div class="setting-item">
          <label>模型</label>
          <input type="text" id="cfg-tts_api-model" value="${this.escAttr(api.model || 'speech-2.8-hd')}" placeholder="speech-2.8-hd">
        </div>
        <button class="btn btn-primary btn-block btn-save" onclick="app.saveSection('tts_api')">保存</button>
      </div>
    `;
  }

  toggleFeishuFields() {
    const enabled = document.getElementById('cfg-channels-feishu_enabled')?.checked;
    const fields = document.getElementById('feishu-fields');
    if (fields) fields.style.display = enabled ? 'block' : 'none';
  }

  toggleQQBotFields() {
    const enabled = document.getElementById('cfg-channels-qqbot_enabled')?.checked;
    const fields = document.getElementById('qqbot-fields');
    if (fields) fields.style.display = enabled ? 'block' : 'none';
  }

  async saveSection(section) {
    let payload = {};

    switch (section) {
      case 'persona':
        payload = {
          persona: {
            partner_name: this.getVal('cfg-persona-partner_name'),
            partner_role: this.getVal('cfg-persona-partner_role'),
            call_user: this.getVal('cfg-persona-call_user'),
            core_identity: this.getVal('cfg-persona-core_identity'),
            boundaries: this.getVal('cfg-persona-boundaries'),
          }
        };
        break;

      case 'chat_api':
      case 'action_api':
      case 'search_api':
      case 'image_api':
        if (section === 'action_api') {
          payload[section] = {
            enabled: this.getChecked('cfg-action_api-enabled'),
            base_url: this.getVal('cfg-action_api-base_url'),
            api_key: this.getVal('cfg-action_api-api_key'),
            model: this.getVal('cfg-action_api-model'),
            enable_mcp: this.getChecked('cfg-action_api-enable_mcp'),
          };
        } else {
          payload[section] = {
            enabled: this.getChecked(`cfg-${section}-enabled`),
            base_url: this.getVal(`cfg-${section}-base_url`),
            api_key: this.getVal(`cfg-${section}-api_key`),
            model: this.getVal(`cfg-${section}-model`),
          };
        }
        break;

      case 'tts_api':
        payload[section] = {
          enabled: this.getChecked('cfg-tts_api-enabled'),
          group_id: this.getVal('cfg-tts_api-group_id'),
          api_key: this.getVal('cfg-tts_api-api_key'),
          voice_id: this.getVal('cfg-tts_api-voice_id'),
          model: this.getVal('cfg-tts_api-model'),
        };
        break;

      case 'memory':
        payload = {
          memory: {
            enabled: this.getChecked('cfg-memory-enabled'),
          }
        };
        break;

      case 'session':
        payload = {
          session: {
            enabled: this.getChecked('cfg-session-enabled'),
            idle_rotation_minutes: parseInt(this.getVal('cfg-session-idle_rotation_minutes')) || 360,
            recent_message_limit: parseInt(this.getVal('cfg-session-recent_message_limit')) || 12,
          }
        };
        break;

      case 'scheduler':
        {
          const idleHours = Number.parseInt(this.getVal('cfg-scheduler-proactive_idle_hours'), 10);
          const idleMinutes = Number.parseInt(this.getVal('cfg-scheduler-proactive_idle_minutes'), 10);
          const dayStart = Number.parseInt(this.getVal('cfg-scheduler-proactive_day_start_hour'), 10);
          const dayEnd = Number.parseInt(this.getVal('cfg-scheduler-proactive_day_end_hour'), 10);
        payload = {
          scheduler: {
            enabled: this.getChecked('cfg-scheduler-enabled'),
            proactive_enabled: this.getChecked('cfg-scheduler-proactive_enabled'),
            proactive_idle_hours: Number.isFinite(idleHours) ? idleHours : 72,
            proactive_idle_minutes: Number.isFinite(idleMinutes) ? idleMinutes : 0,
            proactive_day_start_hour: Number.isFinite(dayStart) ? dayStart : 8,
            proactive_day_end_hour: Number.isFinite(dayEnd) ? dayEnd : 22,
          }
        };
        break;
        }

      case 'channels':
        payload = {
          channels: {
            feishu_enabled: this.getChecked('cfg-channels-feishu_enabled'),
            feishu_app_id: this.getVal('cfg-channels-feishu_app_id'),
            feishu_app_secret: this.getVal('cfg-channels-feishu_app_secret'),
            qqbot_enabled: this.getChecked('cfg-channels-qqbot_enabled'),
            qqbot_app_id: this.getVal('cfg-channels-qqbot_app_id'),
            qqbot_token: this.getVal('cfg-channels-qqbot_token'),
          }
        };
        break;

      case 'dashboard_security': {
        const password = this.getVal('cfg-dashboard-security-password');
        const confirm = this.getVal('cfg-dashboard-security-password_confirm');
        if (password || confirm) {
          if (password.length < 4) {
            this.showToast('密码至少需要 4 位', 'warning');
            return;
          }
          if (password !== confirm) {
            this.showToast('两次输入的密码不一致', 'warning');
            return;
          }
        }
        payload = {
          dashboard_security: {
            enabled: this.getChecked('cfg-dashboard-security-enabled'),
          }
        };
        if (password) {
          payload.dashboard_security.password = password;
        }
        break;
      }

      default:
        return;
    }

    try {
      const res = await this.apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let result = null;
      try {
        result = await res.json();
      } catch (_) {
        result = null;
      }
      if (!res.ok) {
        const detail = result?.error || result?.message || `HTTP ${res.status}`;
        throw new Error(detail);
      }
      if (section === 'dashboard_security') {
        this.showToast('密码设置已保存，正在刷新...', 'success');
        setTimeout(() => window.location.reload(), 800);
        return;
      }
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      if (warnings.length > 0) {
        const warningText = warnings.map(item => `${item.channel || 'channel'}: ${item.error || 'unknown error'}`).join('；');
        this.showToast(`已保存，但部分通道启动失败：${warningText}`, 'warning');
      } else {
        this.showToast('已保存', 'success');
      }
    } catch (err) {
      this.showToast(`保存失败: ${err.message}`, 'error');
    }
  }

  async exportDataBackup() {
    try {
      const res = await this.apiFetch('/api/data/export');
      if (!res.ok) throw new Error('Export failed');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `aelios-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      this.showToast('导出成功', 'success');
    } catch (err) {
      this.showToast(`导出失败: ${err.message}`, 'error');
    }
  }

  openImportDataPicker() {
    const input = document.getElementById('data-import-input');
    if (!input) return;
    input.value = '';
    input.click();
  }

  async importDataBackup(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);
      const res = await this.apiFetch('/api/data/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Import failed');
      const result = await res.json();
      const imported = result.imported || {};
      this.showToast(`导入成功：人设 ${imported.persona ? '已更新' : '未变更'}，记忆 ${imported.memories || 0} 条，日志 ${imported.logs || 0} 条`, 'success');
      await Promise.all([this.renderSettings(), this.renderMemories()]);
    } catch (err) {
      this.showToast(`导入失败: ${err.message}`, 'error');
    } finally {
      if (event?.target) event.target.value = '';
    }
  }

  // ------------------------------------------
  // Theme
  // ------------------------------------------
  setTheme(theme) {
    if (theme === 'pink') {
      document.body.removeAttribute('data-theme');
    } else {
      document.body.setAttribute('data-theme', theme);
    }
    localStorage.setItem('saki_theme', theme);

    // Update theme selector active state
    document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
    // Re-render is simplest
    if (this.currentPage === 'settings') {
      this.renderSettings();
    }
  }

  applyTheme(theme) {
    if (theme && theme !== 'pink') {
      document.body.setAttribute('data-theme', theme);
    }
  }

  themePreviewColor(theme) {
    const map = {
      pink: '#F3E5E9',
      blue: '#E3EFF9',
      purple: '#EDE5F3',
      green: '#E5F3E9',
      orange: '#F3ECE5',
    };
    return map[theme] || '#F3E5E9';
  }

  // ------------------------------------------
  // Toast
  // ------------------------------------------
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ------------------------------------------
  // Modal
  // ------------------------------------------
  showModal(title, bodyHtml, footerHtml = '') {
    const overlay = document.getElementById('modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const footerEl = document.getElementById('modal-footer');

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.innerHTML = bodyHtml;
    if (footerEl) footerEl.innerHTML = footerHtml;

    if (overlay) {
      overlay.style.display = 'flex';
      requestAnimationFrame(() => overlay.classList.add('show'));
    }
  }

  hideModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  }

  // ------------------------------------------
  // Utilities
  // ------------------------------------------
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  formatTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  formatDateTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return '';
    return `${this.formatDate(date)} ${this.formatTime(date)}`;
  }

  generateId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  getVal(id) {
    const el = document.getElementById(id);
    return el ? (el.value || '') : '';
  }

  getChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }
}

// ============================================
// Bootstrap
// ============================================
window.app = new SakiPhoneApp();
