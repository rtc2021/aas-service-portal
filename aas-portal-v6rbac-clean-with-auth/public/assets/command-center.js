/**
 * AAS Command Center v2.3 - Portal Edition
 * Unified search across manuals, parts, service records, and doors
 */
(function() {
  'use strict';

  const CONFIG = {
    DEBOUNCE_MS: 160,
    CACHE_TTL: 1000 * 60 * 30,
    MAX_RESULTS: 30,
    MAX_PER_TYPE: 8,
  };

  const DATA_SOURCES = {
    manuals: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTU61rKQUtfzsyATsgMQIKIhFZP0p5u7xeHoxVUt32hY3gHWiNarTnPH9guNhRkci2ZWucvJTPUxCVY/pub?gid=0&single=true&output=csv',
    parts: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQLWrgcUPv3oD7tIiKCQnDYEnGvlwZ5rYiN-4BhOdZsEV52XvI6NCy7wSqmCgrN02pdKKfSc9w6Fwx7/pub?gid=0&single=true&output=csv',
    service: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaL-Cagmos7f4rCojgOROSm_Zs8Gnl41nvUUN8hXJIrDyGdv4eYhtJKq56lMRK9euN0TvFNOj_rszM/pub?gid=379834637&single=true&output=csv',
    doors: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTcpq972LhvEzo3MA_iJzFeF7vJ1a7qudjvd3ooqxrfho-SZ7p1kvP0943VXsCfHWywDknQ-BHzC2Og/pub?output=csv',
  };

  const ICONS = {
    manual: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
    part: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
    service: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>',
    door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"/><circle cx="15" cy="12" r="1" fill="currentColor"/></svg>',
  };

  let data = { manuals: [], parts: [], service: [], doors: [] };
  let searchIndex = [];
  let isLoaded = false;

  const $ = sel => document.querySelector(sel);
  const clean = s => (s ?? '').toString().trim();
  const escape = s => clean(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const normSearch = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i+1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i+1] === '\n') i++;
          row.push(field);
          if (row.some(f => f.trim())) rows.push(row);
          row = []; field = '';
        } else field += c;
      }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function toObjects(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(h => clean(h));
    return rows.slice(1).map(cells => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = clean(cells[i]));
      return obj;
    });
  }

  async function fetchCSV(key) {
    const url = DATA_SOURCES[key];
    if (!url) return [];
    
    console.log("[CC] Fetching:", key);
    const cacheKey = 'cc_' + key;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { ts, text } = JSON.parse(cached);
        if (Date.now() - ts < CONFIG.CACHE_TTL) {
          console.log("[CC] Using cached:", key, "rows:", toObjects(parseCSV(text)).length);
          return toObjects(parseCSV(text));
        }
      }
    } catch (e) {
      console.log("[CC] Cache error:", key, e);
    }
    
    try {
      const res = await fetch(url + '&t=' + Date.now(), { cache: 'no-store' });
      console.log("[CC] Fetch status:", key, res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      console.log("[CC] Received:", key, "length:", text.length);
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), text })); } catch {}
      const result = toObjects(parseCSV(text));
      console.log("[CC] Parsed:", key, "rows:", result.length);
      return result;
    } catch (e) {
      console.error('[CC] Fetch error:', key, e);
      return [];
    }
  }

  async function loadAllData() {
    console.log("[CC] Starting loadAllData...");
    const [manuals, parts, service, doors] = await Promise.all([
      fetchCSV('manuals'),
      fetchCSV('parts'),
      fetchCSV('service'),
      fetchCSV('doors'),
    ]);
    
    data = { manuals, parts, service, doors };
    console.log("[CC] Data loaded - manuals:", manuals.length, "parts:", parts.length, "service:", service.length, "doors:", doors.length);
    
    buildSearchIndex();
    console.log("[CC] Search index built:", searchIndex.length, "items");
    
    updateCounts();
    updateActivity();
    isLoaded = true;
    console.log("[CC] Load complete");
  }

  function buildSearchIndex() {
    searchIndex = [];
    
    data.manuals.forEach(m => {
      const url = m.DriveLink || m['Drive Link'];
      if (!url) return;
      const title = m.Model_Final || m.FileName || m.Model || 'Manual';
      const subtitle = [m.Manufacturer, m.ManualType_Final].filter(Boolean).join(' • ');
      searchIndex.push({
        type: 'manual',
        title,
        subtitle,
        url,
        searchText: normSearch([title, subtitle, m.Tags].join(' ')),
      });
    });
    
    data.parts.forEach(p => {
      const key = p['Addison #'] || p['MFG #'];
      if (!key) return;
      const subtitle = [p.Manufacturer, p.Description].filter(Boolean).join(' • ');
      searchIndex.push({
        type: 'part',
        title: key,
        subtitle,
        url: '/tech/parts?q=' + encodeURIComponent(key),
        searchText: normSearch([key, subtitle].join(' ')),
      });
    });
    
    data.service.forEach(s => {
      const title = s['Door Name'] || s.Name || s['Door ID'] || 'Service';
      const subtitle = [s.Customer, s.Date, s.Technician].filter(Boolean).join(' • ');
      searchIndex.push({
        type: 'service',
        title,
        subtitle,
        url: '/door?id=' + encodeURIComponent(title),
        searchText: normSearch([title, subtitle, s.Notes].join(' ')),
      });
    });
    
    data.doors.forEach(d => {
      const name = d.Name || d['Door ID'];
      if (!name) return;
      const subtitle = [d.Customer, d.Address, d['Door location']].filter(Boolean).join(' • ');
      searchIndex.push({
        type: 'door',
        title: name,
        subtitle,
        url: '/door?id=' + encodeURIComponent(name),
        searchText: normSearch([name, subtitle, d.Manufacturer, d.Model].join(' ')),
      });
    });
  }

  function search(query) {
    const q = normSearch(query);
    if (!q) return [];
    
    const tokens = q.split(' ').filter(t => t.length >= 2);
    if (!tokens.length) return [];
    
    const scored = [];
    searchIndex.forEach(item => {
      let score = 0;
      tokens.forEach(token => {
        if (item.searchText.includes(token)) {
          score += item.title.toLowerCase().includes(token) ? 10 : 5;
        }
      });
      if (score > 0) scored.push({ item, score });
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, CONFIG.MAX_RESULTS).map(x => x.item);
  }

  function highlightMatch(text, query) {
    const tokens = normSearch(query).split(' ').filter(t => t.length >= 2);
    if (!tokens.length) return escape(text);
    const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return escape(text).replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  }

  function renderResults(results, query) {
    const el = $('#ccSearchResults');
    if (!el) return;
    
    if (!isLoaded) {
      el.innerHTML = '<div class="cc-results__empty"><div class="cc-results__empty-icon">⏳</div><p>Loading data…</p></div>';
      el.classList.add('is-open');
      return;
    }
    
    if (!results.length) {
      el.innerHTML = `<div class="cc-results__empty"><div class="cc-results__empty-icon">🔍</div><p>No results for "${escape(query)}"</p></div>`;
      el.classList.add('is-open');
      return;
    }
    
    const grouped = {
      door: results.filter(r => r.type === 'door'),
      manual: results.filter(r => r.type === 'manual'),
      part: results.filter(r => r.type === 'part'),
      service: results.filter(r => r.type === 'service'),
    };
    
    const labels = { door: 'Doors', manual: 'Manuals', part: 'Parts', service: 'Service Records' };
    const iconClasses = { door: 'cc-results__item-icon--door', manual: 'cc-results__item-icon--manual', part: 'cc-results__item-icon--part', service: 'cc-results__item-icon--service' };
    
    let html = '';
    Object.entries(grouped).forEach(([type, items]) => {
      if (!items.length) return;
      html += `<div class="cc-results__section"><div class="cc-results__label">${labels[type]} (${items.length})</div>`;
      items.slice(0, CONFIG.MAX_PER_TYPE).forEach(item => {
        html += `<div class="cc-results__item" data-url="${escape(item.url)}"><div class="cc-results__item-icon ${iconClasses[type]}">${ICONS[type]}</div><div class="cc-results__item-text"><div class="cc-results__item-title">${highlightMatch(item.title, query)}</div><div class="cc-results__item-meta">${escape(item.subtitle || '')}</div></div></div>`;
      });
      html += `</div>`;
    });
    
    el.innerHTML = html;
    el.classList.add('is-open');
    
    el.querySelectorAll('.cc-results__item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        if (url) {
          if (url.startsWith('http')) window.open(url, '_blank');
          else window.location.href = url;
        }
      });
    });
  }

  function closeResults() {
    const el = $('#ccSearchResults');
    if (el) el.classList.remove('is-open');
  }

  function updateCounts() {
    const manualEl = $('#ccManualCount');
    const partsEl = $('#ccPartsCount');
    const serviceEl = $('#ccServiceCount');
    const doorEl = $('#ccDoorCount');
    
    if (manualEl) manualEl.textContent = data.manuals.length + ' manuals';
    if (partsEl) partsEl.textContent = data.parts.length + ' parts';
    if (serviceEl) serviceEl.textContent = data.service.length + ' records';
    if (doorEl) doorEl.textContent = data.doors.length + ' doors';
    
    const statDoors = $('#statTotalDoors');
    const statMan = $('#statManuals');
    const statParts = $('#statParts');
    
    if (statDoors) statDoors.textContent = data.doors.length.toLocaleString();
    if (statMan) statMan.textContent = data.manuals.length.toLocaleString();
    if (statParts) statParts.textContent = data.parts.length.toLocaleString();
  }

  function updateActivity() {
    const el = $('#ccActivity');
    if (!el) return;
    
    const recent = data.service.filter(s => s.Date).sort((a, b) => new Date(b.Date) - new Date(a.Date)).slice(0, 5);
    
    if (!recent.length) {
      el.innerHTML = '<div class="cc-activity__item"><div class="cc-activity__icon">📋</div><div class="cc-activity__content"><div class="cc-activity__text">No recent activity</div></div></div>';
      return;
    }
    
    el.innerHTML = recent.map(s => `
      <div class="cc-activity__item" onclick="window.location.href='/door?id=${encodeURIComponent(s.Name || s['Door Name'] || '')}'">
        <div class="cc-activity__icon">🔧</div>
        <div class="cc-activity__content">
          <div class="cc-activity__text">${escape(s.Name || s['Door Name'] || 'Service')}</div>
          <div class="cc-activity__meta">${escape([s.Customer, s.Date, s.Technician].filter(Boolean).join(' • '))}</div>
        </div>
      </div>
    `).join('');
  }

  function init() {
    const searchInput = $('#ccGlobalSearch');
    const searchWrap = $('.cc-search');
    
    if (searchInput) {
      searchInput.addEventListener('input', debounce(e => {
        const q = e.target.value.trim();
        if (q.length < 2) { closeResults(); return; }
        renderResults(search(q), q);
      }, CONFIG.DEBOUNCE_MS));
      
      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length >= 2) {
          renderResults(search(searchInput.value), searchInput.value);
        }
      });
    }
    
    document.addEventListener('click', e => {
      if (searchWrap && !searchWrap.contains(e.target)) closeResults();
    });
    
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInput?.focus();
      }
      if (e.key === 'Escape') {
        closeResults();
        searchInput?.blur();
      }
    });
    
    loadAllData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
