/**
 * AAS Copilot v3.0 - STRICT CONTRACT UI
 * Only renders: mode, summary, actions, cards, sources, warnings, debug
 * NO legacy field support (available_symptoms, test_procedure, etc.)
 */
(function() {
  'use strict';

  const CONFIG = {
    AI_ENDPOINT: '/api/copilot-ai',
    MAX_MESSAGES: 50,
    STORAGE_KEY: 'aas_copilot_v3_history',
  };

  const PAGE_PROMPTS = {
    manuals: ['Find Stanley MC521 manual', 'Horton C3150 learn cycle', 'Besam SL500 error codes'],
    parts: ['Horton motor replacement', 'Stanley breakout switch', 'Besam sensor parts'],
    doors: ['Search Ochsner doors', 'Find Horton doors', 'Manning Hospital doors'],
    command: ['Find manual for MH-1.62', 'Search Stanley doors', 'Horton troubleshooting'],
  };

  let isOpen = false;
  let isLoading = false;
  let messages = [];
  let pageContext = null;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const escape = s => (s ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function detectPageContext() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    
    let page = 'command';
    if (path.includes('/tech/manuals')) page = 'manuals';
    else if (path.includes('/tech/parts')) page = 'parts';
    else if (path.includes('/tech/doors')) page = 'doors';
    else if (path.includes('/tech/command')) page = 'command';
    else if (path.includes('/door')) page = 'door';
    else if (path.includes('/service')) page = 'service';

    let role = 'Tech';
    const userRole = window.AASAuth?.getRole?.() || 
                     localStorage.getItem('aas_user_role') ||
                     document.body.dataset.userRole;
    if (userRole) {
      role = userRole.charAt(0).toUpperCase() + userRole.slice(1).toLowerCase();
    }

    const doorId = params.get('id') || params.get('door_id');
    const doorData = window.doorData || window.currentDoor || {};

    pageContext = {
      page,
      role,
      path,
      query: params.get('q') || params.get('query') || null,
      door: (doorId || doorData.door_id) ? {
        door_id: doorId || doorData.door_id || doorData.id,
        manufacturer: doorData.manufacturer || doorData.Manufacturer || '',
        model: doorData.model || doorData.Model || '',
        customer: doorData.customer || doorData.Customer || '',
        location: doorData.location || doorData.Location || '',
      } : null,
    };

    window.AASCopilotContext = pageContext;
    return pageContext;
  }

  async function callAI(userMessage) {
    const ctx = detectPageContext();
    
    const apiMessages = messages
      .filter(m => m.role !== 'system')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));
    
    apiMessages.push({ role: 'user', content: userMessage });

    try {
      const response = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          page_context: {
            page: ctx.page,
            role: ctx.role,
            door: ctx.door,
            query: ctx.query,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          mode: 'error',
          summary: errorData.summary || `Error: ${response.status}`,
          cards: [],
          sources: [],
          warnings: [errorData.error || 'Request failed'],
          debug: errorData.debug || null,
        };
      }

      const data = await response.json();
      
      // STRICT CONTRACT - only accept expected fields
      return {
        mode: data.mode || 'portal',
        summary: data.summary || '',
        actions: Array.isArray(data.actions) ? data.actions : [],
        cards: Array.isArray(data.cards) ? data.cards : [],
        sources: Array.isArray(data.sources) ? data.sources : [],
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        debug: data.debug || null,
      };
    } catch (err) {
      console.error('[Copilot] Fetch error:', err);
      return {
        mode: 'error',
        summary: 'Unable to reach Copilot service.',
        cards: [],
        sources: [],
        warnings: [err.message],
        debug: null,
      };
    }
  }

  function getTypeIcon(type) {
    switch (type) {
      case 'manual': return '📖';
      case 'part': return '🔩';
      case 'door': return '🚪';
      case 'service': return '📋';
      default: return '📄';
    }
  }

  function createPanel() {
    if ($('#copilotV3Panel')) return;

    const panel = document.createElement('div');
    panel.id = 'copilotV3Panel';
    panel.className = 'copilot-v3';
    panel.innerHTML = `
      <header class="copilot-v3__header">
        <div class="copilot-v3__logo">🤖</div>
        <div class="copilot-v3__title">
          <h2>AAS Copilot</h2>
          <span>Portal AI Assistant</span>
        </div>
        <button class="copilot-v3__close" id="copilotV3Close">×</button>
      </header>

      <div class="copilot-v3__context" id="copilotContextBar">
        <div class="copilot-v3__context-icon">📍</div>
        <div class="copilot-v3__context-info">
          <div class="copilot-v3__context-page" id="copilotContextPage">Command Center</div>
          <div class="copilot-v3__context-detail" id="copilotContextDetail">Portal-wide search</div>
        </div>
        <div class="copilot-v3__context-role" id="copilotContextRole">Tech</div>
      </div>

      <div class="copilot-v3__messages" id="copilotMessages"></div>

      <div class="copilot-v3__input-area">
        <textarea id="copilotInput" placeholder="Ask about doors, manuals, parts..." rows="1"></textarea>
        <button id="copilotSend" class="copilot-v3__send">➤</button>
      </div>

      <div class="copilot-v3__footer">
        <button id="copilotClear" class="copilot-v3__clear">Clear Chat</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Trigger button
    const trigger = document.createElement('button');
    trigger.id = 'copilotV3Trigger';
    trigger.className = 'copilot-v3__trigger';
    trigger.innerHTML = '🤖';
    trigger.title = 'Open Copilot (Ctrl+Shift+K)';
    document.body.appendChild(trigger);
  }

  function renderMessages() {
    const container = $('#copilotMessages');
    if (!container) return;

    if (messages.length === 0) {
      renderWelcome(container);
      return;
    }

    let html = '';
    messages.forEach(msg => {
      html += renderMessage(msg);
    });

    if (isLoading) {
      html += `
        <div class="copilot-v3__typing">
          <div class="copilot-v3__typing-dot"></div>
          <div class="copilot-v3__typing-dot"></div>
          <div class="copilot-v3__typing-dot"></div>
        </div>
      `;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  function renderWelcome(container) {
    const ctx = pageContext || detectPageContext();
    const prompts = PAGE_PROMPTS[ctx.page] || PAGE_PROMPTS.command;
    
    container.innerHTML = `
      <div class="copilot-v3__welcome">
        <div class="copilot-v3__welcome-icon">🤖</div>
        <h3>AAS Portal Copilot v3</h3>
        <p>Search doors, manuals, parts from your portal data.</p>
        <div class="copilot-v3__prompts">
          ${prompts.map(p => `<button class="copilot-v3__prompt-btn" data-prompt="${escape(p)}">${escape(p)}</button>`).join('')}
        </div>
      </div>
    `;
    
    $$('.copilot-v3__prompt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $('#copilotInput').value = btn.dataset.prompt;
        handleSend();
      });
    });
  }

  function renderMessage(msg) {
    let html = '';

    if (msg.role === 'user') {
      html += `<div class="copilot-v3__msg copilot-v3__msg--user">${escape(msg.content)}</div>`;
    } else {
      // STRICT: Only render summary, cards, sources, warnings
      const data = msg.data || {};
      
      // Summary
      if (data.summary) {
        html += `<div class="copilot-v3__msg copilot-v3__msg--assistant">${escape(data.summary)}</div>`;
      }

      // Warnings
      if (data.warnings?.length) {
        html += `<div class="copilot-v3__warnings">`;
        data.warnings.forEach(w => {
          html += `<div class="copilot-v3__warning">⚠️ ${escape(w)}</div>`;
        });
        html += `</div>`;
      }

      // Cards
      if (data.cards?.length) {
        html += `
          <div class="copilot-v3__results">
            <div class="copilot-v3__results-header">📂 Portal Results (${data.cards.length})</div>
            <div class="copilot-v3__results-grid">
              ${data.cards.map(c => `
                <a href="${escape(c.url)}" class="copilot-v3__result copilot-v3__result--${c.type}" target="${c.url.startsWith('http') ? '_blank' : '_self'}">
                  <div class="copilot-v3__result-icon">${getTypeIcon(c.type)}</div>
                  <div class="copilot-v3__result-content">
                    <div class="copilot-v3__result-title">${escape(c.title)}</div>
                    ${c.subtitle ? `<div class="copilot-v3__result-subtitle">${escape(c.subtitle)}</div>` : ''}
                  </div>
                  <div class="copilot-v3__result-type">${escape(c.type)}</div>
                </a>
              `).join('')}
            </div>
          </div>
        `;
      }

      // Sources
      if (data.sources?.length) {
        html += `
          <div class="copilot-v3__sources">
            <span class="copilot-v3__sources-label">Sources:</span>
            ${data.sources.map(s => 
              s.url 
                ? `<a href="${escape(s.url)}" class="copilot-v3__source" target="_blank">${escape(s.label)}</a>`
                : `<span class="copilot-v3__source">${escape(s.label)}</span>`
            ).join('')}
          </div>
        `;
      }

      // Debug info (only in dev)
      if (data.debug && window.location.hostname === 'localhost') {
        html += `
          <details class="copilot-v3__debug">
            <summary>Debug (${data.debug.build})</summary>
            <pre>${escape(JSON.stringify(data.debug, null, 2))}</pre>
          </details>
        `;
      }
    }

    return html;
  }

  function updateContextBar() {
    const ctx = pageContext || detectPageContext();
    const pageNames = {
      manuals: 'Tech Manuals',
      parts: 'Parts Finder',
      doors: 'Door Browser',
      command: 'Command Center',
      door: 'Door Details',
    };

    const pageEl = $('#copilotContextPage');
    const detailEl = $('#copilotContextDetail');
    const roleEl = $('#copilotContextRole');

    if (pageEl) pageEl.textContent = pageNames[ctx.page] || 'Portal';

    if (detailEl) {
      let detail = '';
      if (ctx.door?.door_id) {
        detail = ctx.door.door_id;
        if (ctx.door.manufacturer) detail += ` • ${ctx.door.manufacturer}`;
      } else if (ctx.query) {
        detail = `Search: ${ctx.query}`;
      } else {
        detail = 'Portal-wide search';
      }
      detailEl.textContent = detail;
    }

    if (roleEl) roleEl.textContent = ctx.role;
  }

  async function handleSend() {
    const input = $('#copilotInput');
    const text = input?.value?.trim();
    if (!text || isLoading) return;

    messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    
    isLoading = true;
    renderMessages();

    const response = await callAI(text);
    
    isLoading = false;
    messages.push({ 
      role: 'assistant', 
      content: response.summary,
      data: response,
    });
    
    renderMessages();
    saveHistory();
  }

  function openPanel() {
    const panel = $('#copilotV3Panel');
    const trigger = $('#copilotV3Trigger');
    if (panel) {
      panel.classList.add('open');
      isOpen = true;
      document.body.style.overflow = 'hidden';
      if (trigger) trigger.classList.add('hidden');
      updateContextBar();
      renderMessages();
      setTimeout(() => $('#copilotInput')?.focus(), 100);
    }
  }

  function closePanel() {
    const panel = $('#copilotV3Panel');
    const trigger = $('#copilotV3Trigger');
    if (panel) {
      panel.classList.remove('open');
      isOpen = false;
      document.body.style.overflow = '';
      if (trigger) trigger.classList.remove('hidden');
    }
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function clearChat() {
    messages = [];
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    renderMessages();
  }

  function loadHistory() {
    try {
      const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (Array.isArray(data.messages)) {
          messages = data.messages.slice(-CONFIG.MAX_MESSAGES);
        }
      }
    } catch (e) {}
  }

  function saveHistory() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        messages: messages.slice(-CONFIG.MAX_MESSAGES),
        timestamp: Date.now(),
      }));
    } catch (e) {}
  }

  function setupTextarea() {
    const textarea = $('#copilotInput');
    if (!textarea) return;

    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });

    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  function bindEvents() {
    $('#copilotV3Trigger')?.addEventListener('click', togglePanel);
    $('#copilotV3Close')?.addEventListener('click', closePanel);
    $('#copilotSend')?.addEventListener('click', handleSend);
    $('#copilotClear')?.addEventListener('click', clearChat);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) closePanel();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        togglePanel();
      }
    });

    setupTextarea();
  }

  function init() {
    // Disabled on /service pages
    if (window.location.pathname.includes('/service')) {
      console.log('[Copilot] Disabled on service page');
      return;
    }

    createPanel();
    detectPageContext();
    loadHistory();
    bindEvents();
    renderMessages();

    console.log('[Copilot v3.0 Strict] Ready', { page: pageContext?.page, role: pageContext?.role });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AASCopilotV3 = {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    clear: clearChat,
    send: (msg) => { if (msg) { $('#copilotInput').value = msg; handleSend(); } },
  };
})();
