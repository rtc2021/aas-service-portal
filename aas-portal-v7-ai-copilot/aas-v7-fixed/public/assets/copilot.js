/**
 * AAS Copilot Panel v2.2 - ROLE-PROTECTED
 * Intelligent field assistant for door diagnosis
 * Only visible to Admin and Tech roles
 */
(function() {
  'use strict';

  // ============================================
  // ROLE CHECK - Only show for Admin/Tech
  // ============================================
  const ALLOWED_ROLES = ['Admin', 'Tech'];
  
  async function checkCopilotAccess() {
    // Wait for AASAuth to be available
    if (!window.AASAuth) {
      console.log('[Copilot] Auth not loaded, hiding copilot');
      return false;
    }
    
    try {
      const authenticated = await window.AASAuth.isAuthenticated();
      if (!authenticated) {
        console.log('[Copilot] User not authenticated, hiding copilot');
        return false;
      }
      
      const roles = await window.AASAuth.getUserRoles();
      const hasAccess = ALLOWED_ROLES.some(r => roles.includes(r));
      
      if (!hasAccess) {
        console.log('[Copilot] User roles:', roles, '- Access denied (requires Admin or Tech)');
        return false;
      }
      
      console.log('[Copilot] Access granted for roles:', roles);
      return true;
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
      console.error('[Copilot] Failed to get token:', err);
      return null;
    }
  }
  // ============================================

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
  let activeTab = 'diagnose';
  let doorContext = null;
  let lastResponse = null;
  let isLoading = false;
  let manualSystemKey = null;
  let copilotEnabled = false; // Will be set after auth check

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const escape = s => (s ?? '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // API call - NOW WITH AUTH TOKEN
  async function callCopilotAPI(symptom, errorCode = '') {
    // Get auth token
    const token = await getAuthToken();
    if (!token) {
      lastResponse = { 
        status: 'auth_error', 
        message: 'Authentication required. Please log in.' 
      };
      renderTabContent(activeTab);
      return lastResponse;
    }

    // Use manual system or door context
    let ctx = doorContext || {};
    
    if (manualSystemKey) {
      const sys = AVAILABLE_SYSTEMS.find(s => s.key === manualSystemKey);
      if (sys) {
        ctx = { ...ctx, manufacturer: sys.mfg, model: sys.model };
      }
    }

    if (!ctx.manufacturer && !ctx.model) {
      lastResponse = { 
        status: 'no_context', 
        message: 'Please select a door system above to begin troubleshooting.' 
      };
      renderTabContent(activeTab);
      return lastResponse;
    }

    isLoading = true;
    renderTabContent(activeTab);

    try {
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          door_id: ctx.door_id || ctx.id || 'manual',
          symptom: symptom,
          error_code: errorCode,
          context: {
            manufacturer: ctx.manufacturer || '',
            model: ctx.model || '',
            door_type: ctx.door_type || ctx.type || '',
            customer: ctx.customer || '',
          }
        })
      });

      // Handle auth errors
      if (response.status === 401 || response.status === 403) {
        const errData = await response.json();
        lastResponse = { 
          status: 'auth_error', 
          message: errData.message || 'Access denied. Admin or Tech role required.' 
        };
        isLoading = false;
        renderTabContent(activeTab);
        return lastResponse;
      }

      const data = await response.json();
      lastResponse = data;
      isLoading = false;
      renderTabContent(activeTab);
      return data;
    } catch (err) {
      isLoading = false;
      lastResponse = { error: err.message };
      renderTabContent(activeTab);
      return { error: err.message };
    }
  }

  function openPanel() {
    const panel = $('#copilotPanel');
    if (panel) {
      panel.classList.add('open');
      isOpen = true;
      document.body.style.overflow = 'hidden';
    }
  }

  function closePanel() {
    const panel = $('#copilotPanel');
    if (panel) {
      panel.classList.remove('open');
      isOpen = false;
      document.body.style.overflow = '';
    }
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function switchTab(tabName) {
    activeTab = tabName;
    $$('.copilot-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    renderTabContent(tabName);
  }

  function renderTabContent(tab) {
    const content = $('.copilot-content');
    if (!content) return;
    
    if (isLoading) {
      content.innerHTML = `
        <div class="copilot-loading">
          <div class="copilot-spinner"></div>
          <p>Analyzing...</p>
        </div>
      `;
      return;
    }

    // Handle auth errors
    if (lastResponse && (lastResponse.status === 'auth_error')) {
      content.innerHTML = `
        <div class="copilot-empty">
          <div class="copilot-empty__icon">🔒</div>
          <div class="copilot-empty__title">Authentication Required</div>
          <p class="copilot-empty__hint">${escape(lastResponse.message)}</p>
          <button class="copilot-login-btn" onclick="window.AASAuth && window.AASAuth.login()">Log In</button>
        </div>
      `;
      return;
    }
    
    switch (tab) {
      case 'diagnose':
        content.innerHTML = renderDiagnoseTab();
        break;
      case 'parts':
        content.innerHTML = renderPartsTab();
        break;
      case 'procedures':
        content.innerHTML = renderProceduresTab();
        break;
      case 'history':
        content.innerHTML = renderHistoryTab();
        break;
      case 'admin':
        content.innerHTML = renderAdminTab();
        break;
      default:
        content.innerHTML = '<div class="copilot-empty"><div class="copilot-empty__icon">🔧</div><p>Select a tab above</p></div>';
    }
    
    bindContentEvents();
  }

  function renderSystemSelector() {
    const ctx = doorContext || {};
    const hasDoorData = ctx.manufacturer || ctx.model;
    
    let html = `<div class="copilot-system-selector">`;
    
    if (hasDoorData && !manualSystemKey) {
      html += `
        <div class="copilot-door-info">
          <strong>${escape(ctx.manufacturer || 'Unknown')} ${escape(ctx.model || '')}</strong>
          <span class="copilot-door-type">${escape(ctx.door_type || ctx.type || '')}</span>
          <button class="copilot-change-btn" id="copilotChangeSystem">Change</button>
        </div>
      `;
    } else {
      html += `
        <label class="copilot-select-label">Select Door System:</label>
        <select id="copilotSystemSelect" class="copilot-select">
          <option value="">-- Choose System --</option>
          ${AVAILABLE_SYSTEMS.map(s => `
            <option value="${escape(s.key)}" ${manualSystemKey === s.key ? 'selected' : ''}>${escape(s.label)}</option>
          `).join('')}
        </select>
      `;
    }
    
    html += `</div>`;
    return html;
  }

  function renderDiagnoseTab() {
    let html = renderSystemSelector();

    let effectiveCtx = doorContext || {};
    if (manualSystemKey) {
      const sys = AVAILABLE_SYSTEMS.find(s => s.key === manualSystemKey);
      if (sys) effectiveCtx = { manufacturer: sys.mfg, model: sys.model };
    }

    if (!effectiveCtx.manufacturer && !effectiveCtx.model && !lastResponse) {
      html += `
        <div class="copilot-prompt">
          <p>👆 Select a door system above to start troubleshooting.</p>
        </div>
      `;
      return html;
    }

    if (lastResponse && lastResponse.status === 'ok') {
      if (lastResponse.available_symptoms && lastResponse.available_symptoms.length > 0) {
        html += `<div class="copilot-section"><h4>Common Issues</h4><div class="copilot-quick-btns">`;
        lastResponse.available_symptoms.slice(0, 10).forEach(s => {
          html += `<button class="copilot-quick-btn" data-symptom="${escape(s.title)}">${escape(s.title)}</button>`;
        });
        html += `</div></div>`;
      }

      if (lastResponse.available_error_codes && lastResponse.available_error_codes.length > 0) {
        html += `<div class="copilot-section"><h4>Error Codes</h4><div class="copilot-quick-btns copilot-error-codes">`;
        lastResponse.available_error_codes.slice(0, 20).forEach(code => {
          html += `<button class="copilot-quick-btn copilot-error-btn" data-error="${escape(code)}">${escape(code)}</button>`;
        });
        html += `</div></div>`;
      }

      if (lastResponse.next_actions && lastResponse.next_actions.length > 0) {
        html += `<div class="copilot-section"><h4>📋 Diagnosis Steps</h4>`;
        lastResponse.next_actions.forEach(action => {
          if (action.type === 'checklist' && action.steps) {
            html += `
              <div class="copilot-checklist">
                <h5>${escape(action.title)}</h5>
                <ul class="copilot-steps">
                  ${action.steps.map((s, i) => `
                    <li class="copilot-step">
                      <span class="copilot-step-num">${i + 1}</span>
                      <span class="copilot-step-text">${escape(s.text || s)}</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            `;
          } else if (action.type === 'error_resolution') {
            html += `
              <div class="copilot-error-info">
                <h5>⚠️ ${escape(action.title)}</h5>
                <p>${escape(action.action)}</p>
              </div>
            `;
          }
        });
        html += `</div>`;
      }
    } else if (lastResponse && lastResponse.status === 'no_playbook') {
      html += `
        <div class="copilot-empty">
          <div class="copilot-empty__icon">📖</div>
          <div class="copilot-empty__title">No Playbook Found</div>
          <p class="copilot-empty__hint">${escape(lastResponse.message)}</p>
        </div>
      `;
    } else if (lastResponse && lastResponse.error) {
      html += `
        <div class="copilot-empty">
          <div class="copilot-empty__icon">❌</div>
          <div class="copilot-empty__title">Error</div>
          <p class="copilot-empty__hint">${escape(lastResponse.error)}</p>
        </div>
      `;
    }

    return html;
  }

  function renderPartsTab() {
    if (!lastResponse || !lastResponse.part_candidates || lastResponse.part_candidates.length === 0) {
      return `
        <div class="copilot-empty">
          <div class="copilot-empty__icon">🔩</div>
          <div class="copilot-empty__title">No Parts Suggested</div>
          <p class="copilot-empty__hint">Run a diagnosis to see recommended parts.</p>
        </div>
      `;
    }

    let html = '<div class="copilot-section"><h4>Suggested Parts</h4><ul class="copilot-parts-list">';
    lastResponse.part_candidates.forEach(p => {
      const conf = Math.round((p.confidence || 0.5) * 100);
      html += `
        <li class="copilot-part">
          <span class="copilot-part-rank">#${p.rank}</span>
          <span class="copilot-part-name">${escape(p.name)}</span>
          <span class="copilot-part-conf">${conf}%</span>
        </li>
      `;
    });
    html += '</ul></div>';
    return html;
  }

  function renderProceduresTab() {
    if (!lastResponse || !lastResponse.test_procedure) {
      return `
        <div class="copilot-empty">
          <div class="copilot-empty__icon">📋</div>
          <div class="copilot-empty__title">No Procedures</div>
          <p class="copilot-empty__hint">Run a diagnosis first.</p>
        </div>
      `;
    }

    const proc = lastResponse.test_procedure;
    return `
      <div class="copilot-section">
        <h4>${escape(proc.title)}</h4>
        <ol class="copilot-procedure-steps">
          ${(proc.steps || []).map(s => `<li>${escape(s)}</li>`).join('')}
        </ol>
      </div>
    `;
  }

  function renderHistoryTab() {
    return `
      <div class="copilot-empty">
        <div class="copilot-empty__icon">📜</div>
        <div class="copilot-empty__title">Service History</div>
        <p class="copilot-empty__hint">Coming soon.</p>
      </div>
    `;
  }

  function renderAdminTab() {
    if (!lastResponse || !lastResponse.wiring) {
      return `
        <div class="copilot-empty">
          <div class="copilot-empty__icon">⚙️</div>
          <div class="copilot-empty__title">Wiring Info</div>
          <p class="copilot-empty__hint">Run a diagnosis to see wiring details.</p>
        </div>
      `;
    }

    let html = '<div class="copilot-section"><h4>Wiring</h4>';
    const wiring = lastResponse.wiring;
    for (const [section, data] of Object.entries(wiring)) {
      html += `<div class="copilot-wiring-section"><h5>${escape(section)}</h5>`;
      if (typeof data === 'object' && data !== null) {
        html += '<ul class="copilot-wiring-list">';
        for (const [key, val] of Object.entries(data)) {
          html += `<li><strong>${escape(key)}:</strong> ${escape(String(val))}</li>`;
        }
        html += '</ul>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function bindContentEvents() {
    const select = $('#copilotSystemSelect');
    if (select) {
      select.addEventListener('change', () => {
        manualSystemKey = select.value || null;
        lastResponse = null;
        if (manualSystemKey) {
          callCopilotAPI('');
        } else {
          renderTabContent(activeTab);
        }
      });
    }

    $('#copilotChangeSystem')?.addEventListener('click', () => {
      manualSystemKey = '__show_selector__';
      renderTabContent(activeTab);
      setTimeout(() => {
        manualSystemKey = null;
        renderTabContent(activeTab);
      }, 0);
    });

    $$('.copilot-quick-btn[data-symptom]').forEach(btn => {
      btn.addEventListener('click', () => {
        const symptom = btn.dataset.symptom;
        const input = $('#copilotSymptomInput');
        if (input) input.value = symptom;
        callCopilotAPI(symptom);
      });
    });

    $$('.copilot-quick-btn[data-error]').forEach(btn => {
      btn.addEventListener('click', () => {
        const errorCode = btn.dataset.error;
        const input = $('#copilotSymptomInput');
        if (input) input.value = `Error: ${errorCode}`;
        callCopilotAPI('', errorCode);
      });
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
    if (doorId) {
      doorContext = { door_id: doorId, id: doorId };
    }

    const mfgEl = document.querySelector('[data-manufacturer]');
    const modelEl = document.querySelector('[data-model]');
    if (mfgEl || modelEl) {
      doorContext = doorContext || {};
      doorContext.manufacturer = mfgEl?.dataset.manufacturer || mfgEl?.textContent || '';
      doorContext.model = modelEl?.dataset.model || modelEl?.textContent || '';
    }
  }

  function createPanel() {
    if ($('#copilotPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'copilotPanel';
    panel.className = 'copilot-panel';
    panel.innerHTML = `
      <header class="copilot-header">
        <h2>🤖 Copilot</h2>
        <button class="copilot-close" id="copilotClose">×</button>
      </header>
      
      <nav class="copilot-tabs">
        <button class="copilot-tab active" data-tab="diagnose">Diagnose</button>
        <button class="copilot-tab" data-tab="parts">Parts</button>
        <button class="copilot-tab" data-tab="procedures">Procedures</button>
        <button class="copilot-tab" data-tab="history">History</button>
        <button class="copilot-tab" data-tab="admin">Wiring</button>
      </nav>
      
      <div class="copilot-input">
        <input type="text" placeholder="Describe issue or enter error code…" id="copilotSymptomInput">
        <button id="copilotAnalyzeBtn">Analyze</button>
      </div>
      
      <div class="copilot-content"></div>
    `;
    
    document.body.appendChild(panel);
    
    if (!$('#copilotTrigger')) {
      const trigger = document.createElement('button');
      trigger.id = 'copilotTrigger';
      trigger.className = 'copilot-trigger';
      trigger.innerHTML = '🤖';
      trigger.title = 'Open Copilot';
      document.body.appendChild(trigger);
    }
  }

  function removeCopilotUI() {
    const panel = $('#copilotPanel');
    const trigger = $('#copilotTrigger');
    if (panel) panel.remove();
    if (trigger) trigger.remove();
  }

  async function init() {
    // ============================================
    // ROLE CHECK BEFORE CREATING UI
    // ============================================
    const hasAccess = await checkCopilotAccess();
    
    if (!hasAccess) {
      console.log('[Copilot] Access denied - not creating UI');
      removeCopilotUI();
      copilotEnabled = false;
      return;
    }
    
    copilotEnabled = true;
    // ============================================
    
    createPanel();
    loadDoorContext();
    
    $('#copilotTrigger')?.addEventListener('click', togglePanel);
    $('#copilotClose')?.addEventListener('click', closePanel);
    
    $$('.copilot-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    
    $('#copilotAnalyzeBtn')?.addEventListener('click', () => {
      const input = $('#copilotSymptomInput');
      if (input) {
        const val = input.value.trim();
        if (val.match(/^(error:?\s*)?[A-Za-z0-9]{1,4}$/i)) {
          callCopilotAPI('', val.replace(/^error:?\s*/i, ''));
        } else {
          callCopilotAPI(val || '');
        }
      }
    });
    
    $('#copilotSymptomInput')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') $('#copilotAnalyzeBtn')?.click();
    });
    
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) closePanel();
    });
    
    $('#copilotPanel')?.addEventListener('click', e => {
      if (e.target === $('#copilotPanel')) closePanel();
    });
    
    renderTabContent(activeTab);
    
    if (doorContext && (doorContext.manufacturer || doorContext.model)) {
      callCopilotAPI('');
    }
  }

  function waitForAuth() {
    return new Promise((resolve) => {
      const maxWait = 5000;
      const startTime = Date.now();
      
      function check() {
        if (window.AASAuth) {
          resolve(true);
        } else if (Date.now() - startTime > maxWait) {
          console.warn('[Copilot] Auth not available after timeout');
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      }
      check();
    });
  }

  async function startup() {
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }
    
    await waitForAuth();
    await new Promise(r => setTimeout(r, 500));
    await init();
  }

  startup();

  window.AASCopilot = {
    open: () => copilotEnabled && openPanel(),
    close: closePanel,
    toggle: () => copilotEnabled && togglePanel(),
    isEnabled: () => copilotEnabled,
    setDoorContext: (ctx) => { 
      if (!copilotEnabled) return;
      doorContext = ctx; 
      manualSystemKey = null;
      lastResponse = null;
      renderTabContent(activeTab);
      if (ctx && (ctx.manufacturer || ctx.model)) {
        callCopilotAPI('');
      }
    },
    selectSystem: (key) => {
      if (!copilotEnabled) return;
      manualSystemKey = key;
      lastResponse = null;
      callCopilotAPI('');
    },
    analyze: (symptom, errorCode) => copilotEnabled && callCopilotAPI(symptom || '', errorCode || ''),
    recheckAccess: async () => {
      const hasAccess = await checkCopilotAccess();
      if (hasAccess && !copilotEnabled) {
        await init();
      } else if (!hasAccess && copilotEnabled) {
        removeCopilotUI();
        copilotEnabled = false;
      }
    }
  };
})();
