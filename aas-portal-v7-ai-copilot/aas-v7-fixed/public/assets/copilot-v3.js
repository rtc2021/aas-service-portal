/**
 * AAS Copilot Panel v3.0 - AI-POWERED + DETERMINISTIC
 * Dual-mode: Classic playbook mode + LLM chat mode
 * Only visible to Admin and Tech roles
 */
(function() {
  'use strict';

  const ALLOWED_ROLES = ['Admin', 'Tech'];
  
  // Available playbooks for manual selection
  const AVAILABLE_SYSTEMS = [
    { key: 'nabco-opus', label: 'NABCO OPUS (Sliding)', mfg: 'NABCO', model: 'OPUS' },
    { key: 'dorma-ed100', label: 'Dorma ED100/ED250 (Swing)', mfg: 'Dorma', model: 'ED100/ED250' },
    { key: 'dorma-esaii', label: 'Dorma ESA II (Sliding)', mfg: 'Dorma', model: 'ESA II' },
    { key: 'besam-unislide', label: 'Besam UniSlide (Sliding)', mfg: 'Besam', model: 'UniSlide' },
    { key: 'stanley-duraglide', label: 'Stanley Dura-Glide Model J (Sliding)', mfg: 'Stanley', model: 'Dura-Glide Model J' },
    { key: 'stanley-mc521', label: 'Stanley MC521 (Swing)', mfg: 'Stanley', model: 'MC521' },
    { key: 'horton-c4190', label: 'Horton C4190 (Swing/Folding)', mfg: 'Horton', model: 'C4190' },
    { key: 'record-8000', label: 'Record 8000 Series (Sliding)', mfg: 'Record', model: '8000 Series' },
  ];

  let isOpen = false;
  let copilotMode = 'ai'; // 'ai' or 'classic'
  let doorContext = null;
  let copilotEnabled = false;
  
  // AI Chat state
  let chatMessages = [];
  let isAiLoading = false;
  let aiAvailable = true;
  
  // Classic mode state
  let activeTab = 'diagnose';
  let lastResponse = null;
  let isLoading = false;
  let manualSystemKey = null;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const escape = s => (s ?? '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');

  // ============================================
  // AUTH FUNCTIONS
  // ============================================
  async function checkCopilotAccess() {
    if (!window.AASAuth) return false;
    try {
      const authenticated = await window.AASAuth.isAuthenticated();
      if (!authenticated) return false;
      const roles = await window.AASAuth.getUserRoles();
      return ALLOWED_ROLES.some(r => roles.includes(r));
    } catch (err) {
      console.error('[Copilot] Auth check failed:', err);
      return false;
    }
  }
  
  async function getAuthToken() {
    if (!window.AASAuth) return null;
    try {
      return await window.AASAuth.getAccessToken();
    } catch (err) {
      return null;
    }
  }

  // ============================================
  // AI CHAT FUNCTIONS
  // ============================================
  async function sendAiMessage(userMessage) {
    const token = await getAuthToken();
    if (!token) {
      chatMessages.push({ role: 'assistant', content: '🔒 Please log in to use AI Copilot.' });
      renderChatMessages();
      return;
    }

    // Add user message to chat
    chatMessages.push({ role: 'user', content: userMessage });
    isAiLoading = true;
    renderChatMessages();

    try {
      const response = await fetch('/api/copilot-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
          door_context: doorContext ? {
            door_id: doorContext.door_id || doorContext.id,
            manufacturer: doorContext.manufacturer,
            model: doorContext.model,
            customer: doorContext.customer
          } : undefined
        })
      });

      if (response.status === 503) {
        // AI server unavailable
        aiAvailable = false;
        const data = await response.json();
        chatMessages.push({ 
          role: 'assistant', 
          content: `⚠️ **AI Server Offline**\n\n${data.message}\n\nSwitching to Classic mode...`
        });
        setTimeout(() => switchMode('classic'), 2000);
      } else if (!response.ok) {
        const data = await response.json();
        chatMessages.push({ 
          role: 'assistant', 
          content: `❌ Error: ${data.message || 'Unknown error'}`
        });
      } else {
        const data = await response.json();
        chatMessages.push({ role: 'assistant', content: data.response });
      }
    } catch (err) {
      chatMessages.push({ 
        role: 'assistant', 
        content: `❌ Connection error: ${err.message}\n\nTry Classic mode instead.`
      });
    }

    isAiLoading = false;
    renderChatMessages();
  }

  function renderChatMessages() {
    const container = $('.copilot-chat-messages');
    if (!container) return;

    let html = '';
    
    if (chatMessages.length === 0) {
      html = `
        <div class="copilot-chat-welcome">
          <div class="copilot-chat-welcome__icon">🤖</div>
          <h3>AAS AI Copilot</h3>
          <p>Ask me anything about automatic doors:</p>
          <ul>
            <li>"How do I run a learn cycle on the MC521?"</li>
            <li>"Door won't close, showing error E3"</li>
            <li>"What's the belt tension spec for UniSlide?"</li>
            <li>"Look up door AAS-142"</li>
          </ul>
          ${doorContext?.manufacturer ? `<p class="copilot-chat-context">📍 Current door: <strong>${escape(doorContext.manufacturer)} ${escape(doorContext.model || '')}</strong></p>` : ''}
        </div>
      `;
    } else {
      chatMessages.forEach(msg => {
        const isUser = msg.role === 'user';
        html += `
          <div class="copilot-chat-msg ${isUser ? 'copilot-chat-msg--user' : 'copilot-chat-msg--ai'}">
            <div class="copilot-chat-msg__avatar">${isUser ? '👤' : '🤖'}</div>
            <div class="copilot-chat-msg__content">${escape(msg.content)}</div>
          </div>
        `;
      });
    }

    if (isAiLoading) {
      html += `
        <div class="copilot-chat-msg copilot-chat-msg--ai">
          <div class="copilot-chat-msg__avatar">🤖</div>
          <div class="copilot-chat-msg__content copilot-chat-typing">
            <span></span><span></span><span></span>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  // ============================================
  // CLASSIC MODE FUNCTIONS (from v2.2)
  // ============================================
  async function callClassicAPI(symptom, errorCode = '') {
    const token = await getAuthToken();
    if (!token) {
      lastResponse = { status: 'auth_error', message: 'Please log in.' };
      renderClassicContent();
      return;
    }

    let ctx = doorContext || {};
    if (manualSystemKey) {
      const sys = AVAILABLE_SYSTEMS.find(s => s.key === manualSystemKey);
      if (sys) ctx = { ...ctx, manufacturer: sys.mfg, model: sys.model };
    }

    if (!ctx.manufacturer && !ctx.model) {
      lastResponse = { status: 'no_context', message: 'Select a door system above.' };
      renderClassicContent();
      return;
    }

    isLoading = true;
    renderClassicContent();

    try {
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          door_id: ctx.door_id || ctx.id || 'manual',
          symptom, error_code: errorCode,
          context: { manufacturer: ctx.manufacturer || '', model: ctx.model || '', door_type: ctx.door_type || '', customer: ctx.customer || '' }
        })
      });

      lastResponse = await response.json();
    } catch (err) {
      lastResponse = { error: err.message };
    }

    isLoading = false;
    renderClassicContent();
  }

  function renderClassicContent() {
    const content = $('.copilot-classic-content');
    if (!content) return;

    if (isLoading) {
      content.innerHTML = '<div class="copilot-loading"><div class="copilot-spinner"></div><p>Analyzing...</p></div>';
      return;
    }

    let html = renderSystemSelector();
    
    if (lastResponse?.status === 'ok') {
      if (lastResponse.available_symptoms?.length > 0) {
        html += `<div class="copilot-section"><h4>Common Issues</h4><div class="copilot-quick-btns">`;
        lastResponse.available_symptoms.slice(0, 8).forEach(s => {
          html += `<button class="copilot-quick-btn" data-symptom="${escape(s.title)}">${escape(s.title)}</button>`;
        });
        html += `</div></div>`;
      }

      if (lastResponse.next_actions?.length > 0) {
        html += `<div class="copilot-section"><h4>📋 Steps</h4>`;
        lastResponse.next_actions.forEach(action => {
          if (action.type === 'checklist' && action.steps) {
            html += `<div class="copilot-checklist"><h5>${escape(action.title)}</h5><ul class="copilot-steps">`;
            action.steps.forEach((s, i) => {
              html += `<li class="copilot-step"><span class="copilot-step-num">${i+1}</span><span>${escape(s.text||s)}</span></li>`;
            });
            html += `</ul></div>`;
          }
        });
        html += `</div>`;
      }
    } else if (!lastResponse && !manualSystemKey) {
      html += `<div class="copilot-prompt"><p>👆 Select a door system to start.</p></div>`;
    }

    content.innerHTML = html;
    bindClassicEvents();
  }

  function renderSystemSelector() {
    const ctx = doorContext || {};
    const hasDoorData = ctx.manufacturer || ctx.model;
    
    if (hasDoorData && !manualSystemKey) {
      return `
        <div class="copilot-system-selector">
          <div class="copilot-door-info">
            <strong>${escape(ctx.manufacturer || 'Unknown')} ${escape(ctx.model || '')}</strong>
            <button class="copilot-change-btn" id="copilotChangeSystem">Change</button>
          </div>
        </div>
      `;
    }
    
    return `
      <div class="copilot-system-selector">
        <label class="copilot-select-label">Select Door System:</label>
        <select id="copilotSystemSelect" class="copilot-select">
          <option value="">-- Choose System --</option>
          ${AVAILABLE_SYSTEMS.map(s => `<option value="${escape(s.key)}" ${manualSystemKey === s.key ? 'selected' : ''}>${escape(s.label)}</option>`).join('')}
        </select>
      </div>
    `;
  }

  function bindClassicEvents() {
    const select = $('#copilotSystemSelect');
    if (select) {
      select.onchange = () => {
        manualSystemKey = select.value || null;
        lastResponse = null;
        if (manualSystemKey) callClassicAPI('');
        else renderClassicContent();
      };
    }
    $('#copilotChangeSystem')?.addEventListener('click', () => {
      manualSystemKey = null;
      lastResponse = null;
      renderClassicContent();
    });
    $$('.copilot-quick-btn[data-symptom]').forEach(btn => {
      btn.onclick = () => callClassicAPI(btn.dataset.symptom);
    });
  }

  // ============================================
  // UI MANAGEMENT
  // ============================================
  function switchMode(mode) {
    copilotMode = mode;
    $$('.copilot-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('.copilot-ai-view').style.display = mode === 'ai' ? 'flex' : 'none';
    $('.copilot-classic-view').style.display = mode === 'classic' ? 'block' : 'none';
    
    if (mode === 'ai') renderChatMessages();
    else renderClassicContent();
  }

  function openPanel() {
    $('#copilotPanel')?.classList.add('open');
    isOpen = true;
    document.body.style.overflow = 'hidden';
  }

  function closePanel() {
    $('#copilotPanel')?.classList.remove('open');
    isOpen = false;
    document.body.style.overflow = '';
  }

  function createPanel() {
    if ($('#copilotPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'copilotPanel';
    panel.className = 'copilot-panel';
    panel.innerHTML = `
      <header class="copilot-header">
        <h2>🤖 Copilot</h2>
        <div class="copilot-mode-toggle">
          <button class="copilot-mode-btn active" data-mode="ai">AI Chat</button>
          <button class="copilot-mode-btn" data-mode="classic">Classic</button>
        </div>
        <button class="copilot-close" id="copilotClose">×</button>
      </header>
      
      <!-- AI Chat View -->
      <div class="copilot-ai-view">
        <div class="copilot-chat-messages"></div>
        <div class="copilot-chat-input">
          <input type="text" placeholder="Ask about this door or any troubleshooting question..." id="copilotAiInput">
          <button id="copilotAiSend">Send</button>
        </div>
        <div class="copilot-chat-actions">
          <button class="copilot-chat-action" data-msg="How do I run a learn cycle?">Learn Cycle</button>
          <button class="copilot-chat-action" data-msg="What do the LED indicators mean?">LED Codes</button>
          <button class="copilot-chat-action" data-msg="Door won't close properly">Won't Close</button>
          <button class="copilot-chat-action" id="copilotClearChat">Clear Chat</button>
        </div>
      </div>
      
      <!-- Classic View -->
      <div class="copilot-classic-view" style="display:none;">
        <div class="copilot-classic-content"></div>
      </div>
    `;
    
    document.body.appendChild(panel);

    // Create trigger button
    if (!$('#copilotTrigger')) {
      const trigger = document.createElement('button');
      trigger.id = 'copilotTrigger';
      trigger.className = 'copilot-trigger';
      trigger.innerHTML = '🤖';
      trigger.title = 'Open Copilot';
      document.body.appendChild(trigger);
    }
  }

  function bindPanelEvents() {
    $('#copilotTrigger')?.addEventListener('click', () => isOpen ? closePanel() : openPanel());
    $('#copilotClose')?.addEventListener('click', closePanel);
    
    // Mode toggle
    $$('.copilot-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    // AI Chat
    const aiInput = $('#copilotAiInput');
    const aiSend = $('#copilotAiSend');
    
    aiSend?.addEventListener('click', () => {
      const msg = aiInput?.value?.trim();
      if (msg) {
        sendAiMessage(msg);
        aiInput.value = '';
      }
    });
    
    aiInput?.addEventListener('keypress', e => {
      if (e.key === 'Enter') aiSend?.click();
    });

    // Quick action buttons
    $$('.copilot-chat-action[data-msg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = btn.dataset.msg;
        if (msg) sendAiMessage(msg);
      });
    });

    // Clear chat
    $('#copilotClearChat')?.addEventListener('click', () => {
      chatMessages = [];
      renderChatMessages();
    });

    // Escape to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) closePanel();
    });
  }

  function loadDoorContext() {
    const doorData = window.doorData || window.currentDoor;
    if (doorData) {
      doorContext = doorData;
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const doorId = urlParams.get('id') || urlParams.get('door_id');
    if (doorId) doorContext = { door_id: doorId, id: doorId };

    const mfgEl = document.querySelector('[data-manufacturer]');
    const modelEl = document.querySelector('[data-model]');
    if (mfgEl || modelEl) {
      doorContext = doorContext || {};
      doorContext.manufacturer = mfgEl?.dataset.manufacturer || mfgEl?.textContent || '';
      doorContext.model = modelEl?.dataset.model || modelEl?.textContent || '';
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  async function init() {
    const hasAccess = await checkCopilotAccess();
    if (!hasAccess) {
      console.log('[Copilot] Access denied');
      return;
    }
    
    copilotEnabled = true;
    createPanel();
    loadDoorContext();
    bindPanelEvents();
    
    // Initialize views
    renderChatMessages();
    renderClassicContent();
  }

  async function startup() {
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }
    
    // Wait for auth
    const maxWait = 5000;
    const start = Date.now();
    while (!window.AASAuth && Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 100));
    }
    
    await new Promise(r => setTimeout(r, 500));
    await init();
  }

  startup();

  window.AASCopilot = {
    open: () => copilotEnabled && openPanel(),
    close: closePanel,
    toggle: () => copilotEnabled && (isOpen ? closePanel() : openPanel()),
    isEnabled: () => copilotEnabled,
    setDoorContext: (ctx) => { 
      doorContext = ctx;
      if (copilotEnabled) {
        renderChatMessages();
        renderClassicContent();
      }
    },
    sendMessage: (msg) => copilotEnabled && copilotMode === 'ai' && sendAiMessage(msg),
    switchMode: (mode) => copilotEnabled && switchMode(mode),
  };
})();
