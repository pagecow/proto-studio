/* Proto Studio — app logic.
   Left: projects · Middle: Proto Agent · Right: the prototype canvas.
   Everything persists in scopedData; prototypes are plain self-contained HTML
   rendered in a sandboxed sub-frame (device chrome: desktop / tablet / phone). */

'use strict';

(function () {

  const STORE_KEY = 'protoStudio.v1';

  const TARGETS = {
    desktop: { key: 'desktop', label: 'Desktop', kind: 'a website', w: 1440, h: 900, chrome: 36, pad: 0, notch: false, home: false },
    tablet: { key: 'tablet', label: 'Tablet', kind: 'a tablet app', w: 834, h: 1112, chrome: 0, pad: 20, notch: false, home: false },
    phone: { key: 'phone', label: 'Phone', kind: 'a phone app', w: 390, h: 844, chrome: 0, pad: 12, notch: true, home: true }
  };

  const STARTERS = [
    'A landing page for a small-batch coffee subscription',
    'A SaaS analytics dashboard with a sidebar',
    'An onboarding flow for a fitness app on a phone',
    'A checkout screen for an online plant shop',
    'A restaurant site with menu and reservations',
    'A booking flow for a boutique hotel'
  ];

  /* ── helpers ──────────────────────────────────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const slug = (s) => String(s || 'prototype').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'prototype';

  function fmtBytes(n) {
    if (n == null) return '';
    return n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
  }

  function ago(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 604800) return Math.round(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function inlineMd(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function mdToHtml(text) {
    const src = esc(text || '').trim();
    if (!src) return '';
    return src.split(/\n{2,}/).map(function (block) {
      const lines = block.split('\n');
      const bullet = lines.every((l) => /^\s*[-*]\s+/.test(l));
      const numbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
      if (bullet || numbered) {
        const tag = numbered ? 'ol' : 'ul';
        const items = lines.map((l) => '<li>' + inlineMd(l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')) + '</li>').join('');
        return '<' + tag + '>' + items + '</' + tag + '>';
      }
      return '<p>' + lines.map(inlineMd).join('<br>') + '</p>';
    }).join('');
  }

  /* ── state ────────────────────────────────────────────────────────── */
  const store = {
    projects: [],
    activeId: null,
    model: null,
    zoom: 'fit',
    widths: { left: 236, mid: 384 }
  };

  let busy = false;
  let abortCtl = null;
  let liveEl = null;
  let liveBuf = '';
  let frameDoc = null;
  let codeOpen = false;
  let models = [];
  let defaultModel = null;
  let nameResolve = null;
  let confirmResolve = null;
  let saveTimer = null;
  let toastTimer = null;

  const active = () => store.projects.find((p) => p.id === store.activeId) || null;
  const targetOf = (p) => TARGETS[(p && p.target) || 'desktop'];

  function dimsFor(p) {
    const t = targetOf(p);
    if (p && p.landscape && p.target !== 'desktop') return { w: t.h, h: t.w };
    return { w: t.w, h: t.h };
  }

  function newProject(name, target, html) {
    return {
      id: uid(),
      name: name || 'Untitled prototype',
      target: TARGETS[target] ? target : 'desktop',
      landscape: false,
      targetAuto: !target,
      html: html || '',
      chat: [],
      model: null,
      created: Date.now(),
      updated: Date.now()
    };
  }

  /* ── persistence ──────────────────────────────────────────────────── */
  async function loadStore() {
    try {
      const saved = await window.chatoss.scopedData.get(STORE_KEY);
      if (saved && typeof saved === 'object' && Array.isArray(saved.projects)) {
        store.projects = saved.projects.filter((p) => p && p.id);
        store.activeId = saved.activeId || null;
        store.model = saved.model || null;
        store.zoom = saved.zoom || 'fit';
        store.widths = Object.assign({ left: 236, mid: 384 }, saved.widths || {});
      }
    } catch (err) {
      console.warn('[proto] could not load state', err);
    }
    if (!store.projects.length) seed();
    if (!store.projects.some((p) => p.id === store.activeId)) {
      store.activeId = store.projects.length ? store.projects[0].id : null;
    }
  }

  async function persist() {
    try {
      await window.chatoss.scopedData.set(STORE_KEY, store);
    } catch (err) {
      console.warn('[proto] could not save state', err);
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  }

  window.addEventListener('pagehide', function () {
    clearTimeout(saveTimer);
    persist();
  });

  function seed() {
    const p = newProject('Ember & Oak — coffee landing', 'desktop', SAMPLE_HTML);
    p.chat.push({
      role: 'assistant',
      applied: true,
      ts: Date.now(),
      content: 'Welcome to Proto Studio. This is a starting landing page — ask me for changes ("add a testimonials section", "make the pricing clearer"), switch the device above the canvas, or press Code to edit the HTML by hand.'
    });
    store.projects.push(p);
    store.activeId = p.id;
  }

  /* ── rendering: projects ──────────────────────────────────────────── */
  function renderProjects() {
    const list = $('#projectList');
    list.textContent = '';
    const ordered = store.projects.slice().sort((a, b) => b.updated - a.updated);
    ordered.forEach(function (p) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'list-row pf-proj' + (p.id === store.activeId ? ' is-selected' : '');
      const main = document.createElement('span');
      main.className = 'pf-proj-main';
      const title = document.createElement('span');
      title.className = 'list-row-title truncate';
      title.textContent = p.name;
      const meta = document.createElement('span');
      meta.className = 'list-row-meta truncate';
      meta.textContent = [(p.html ? 'designed' : 'empty'), ago(p.updated)].filter(Boolean).join(' · ');
      main.append(title, meta);
      const badge = document.createElement('span');
      badge.className = 'badge pf-proj-badge';
      badge.textContent = targetOf(p).label;
      row.append(main, badge);
      row.addEventListener('click', function () { selectProject(p.id); });
      list.append(row);
    });
    $('#projectEmpty').hidden = ordered.length > 0;
    const has = !!active();
    $('#btnRename').disabled = !has;
    $('#btnDuplicate').disabled = !has;
    $('#btnDelete').disabled = !has;
    $('#btnClearChat').disabled = !has;
  }

  function selectProject(id) {
    if (busy) return;
    if (store.activeId === id) return;
    store.activeId = id;
    frameDoc = null;
    save();
    renderAll();
  }

  /* ── rendering: agent header + chat ───────────────────────────────── */
  function renderAgentHeader() {
    const p = active();
    const t = targetOf(p);
    const want = resolveModel(p);
    if (want) $('#modelSelect').value = want;
    $('#agentMeta').textContent = p
      ? t.label + (p.landscape && p.target !== 'desktop' ? ' · landscape' : '') +
        (p.html ? ' · ' + fmtBytes(p.html.length) : ' · no design yet')
      : 'no project';
  }

  /* Never hand the engine a model id that is not in the current list. */
  function resolveModel(p) {
    const want = (p && p.model) || store.model || defaultModel || '';
    if (want && models.some((m) => m.id === want)) return want;
    const first = models.find((m) => m.available !== false);
    return first ? first.id : undefined;
  }

  function msgEl(m) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    const role = document.createElement('div');
    role.className = 'msg-role';
    role.textContent = m.role === 'user' ? 'You' : 'Proto Agent';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = mdToHtml(m.content || '') || '<p class="faint">…</p>';
    bubble.append(body);
    if (m.error) body.classList.add('pf-error');
    if (m.applied) {
      const flag = document.createElement('div');
      flag.className = 'pf-note';
      flag.innerHTML = '<span class="badge badge-success">prototype updated</span>';
      bubble.append(flag);
    }
    wrap.append(role, bubble);
    return wrap;
  }

  function renderChat() {
    const log = $('#chatLog');
    log.textContent = '';
    const p = active();
    if (!p) {
      const intro = document.createElement('div');
      intro.className = 'empty pf-intro';
      intro.innerHTML = '<div class="empty-title">No project selected</div>' +
        '<div class="empty-text">Describe what you want to build — a project is created for you.</div>';
      log.append(intro);
    } else if (!p.chat.length) {
      const t = targetOf(p);
      const intro = document.createElement('div');
      intro.className = 'empty pf-intro';
      intro.innerHTML = '<div class="empty-title">Proto Agent</div>' +
        '<div class="empty-text">Designing for <strong>' + esc(t.label) + '</strong> (' + dimsFor(p).w + ' × ' + dimsFor(p).h + '). ' +
        'Describe the product, the audience and the key screen — I will write the whole prototype.</div>';
      log.append(intro);
    }
    p && p.chat.forEach((m) => log.append(msgEl(m)));
    scrollChat();
  }

  function scrollChat() {
    const log = $('#chatLog');
    log.scrollTop = log.scrollHeight;
  }

  function renderChips() {
    const box = $('#chips');
    box.textContent = '';
    if (busy) return;
    STARTERS.forEach(function (s) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = s.length > 42 ? s.slice(0, 40).trim() + '…' : s;
      chip.title = s;
      chip.addEventListener('click', function () {
        if (!$('#prompt').value.trim()) send(s);
        else { $('#prompt').value = s; autoGrow($('#prompt')); $('#prompt').focus(); }
      });
      box.append(chip);
    });
  }

  /* ── rendering: canvas ────────────────────────────────────────────── */
  function zoomFor(w, h) {
    if (store.zoom !== 'fit') {
      const n = Number(store.zoom);
      return isFinite(n) && n > 0 ? n : 1;
    }
    const r = $('#stage').getBoundingClientRect();
    const availW = Math.max(140, r.width - 58);
    const availH = Math.max(140, r.height - 86);
    const z = Math.min(availW / w, availH / h, 1);
    return Math.max(0.1, Math.round(z * 1000) / 1000);
  }

  function renderCanvas() {
    const p = active();
    const key = p ? p.target : 'desktop';
    $$('#targetSeg .seg-item').forEach(function (b) {
      const on = b.dataset.target === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('#btnRotate').disabled = !p || p.target === 'desktop';
    $('#zoomSelect').value = store.zoom;

    const has = !!(p && p.html && p.html.trim());
    $('#stageEmpty').hidden = has;
    $('#deviceWrap').hidden = !has;
    if (!has) return;

    const t = targetOf(p);
    const d = dimsFor(p);
    const pad = t.pad;
    const chrome = t.chrome;
    const devW = d.w + pad * 2;
    const devH = d.h + pad * 2 + chrome;

    const dev = $('#device');
    const screen = $('#screen');
    dev.dataset.target = p.target;
    dev.style.width = devW + 'px';
    dev.style.height = devH + 'px';
    screen.style.width = d.w + 'px';
    screen.style.height = d.h + 'px';
    $('#chromeUrl').textContent = slug(p.name) + '.proto';
    $('#notch').hidden = !(t.notch && !p.landscape);
    $('#homeBar').hidden = !(t.home && !p.landscape);

    const z = zoomFor(devW, devH);
    const scaler = $('#scaler');
    scaler.style.width = Math.round(devW * z) + 'px';
    scaler.style.height = Math.round(devH * z) + 'px';
    dev.style.transform = 'scale(' + z + ')';
    $('#caption').textContent = t.label + ' · ' + d.w + ' × ' + d.h +
      (p.landscape && p.target !== 'desktop' ? ' · landscape' : '') +
      ' · ' + Math.round(z * 100) + '%';

    if (frameDoc !== p.html) {
      frameDoc = p.html;
      $('#frame').srcdoc = p.html;
    }
    if (codeOpen) syncCode();
  }

  function syncCode() {
    const p = active();
    $('#codeEditor').value = (p && p.html) || '';
    $('#codeHint').textContent = p && p.html
      ? fmtBytes(p.html.length) + ' · ' + p.html.split('\n').length + ' lines'
      : 'empty';
  }

  function renderAll() {
    applyWidths();
    renderProjects();
    renderAgentHeader();
    renderChat();
    renderChips();
    renderCanvas();
  }

  function applyWidths() {
    const w = store.widths || { left: 236, mid: 384 };
    $('#shell').style.setProperty('--pf-w-left', Math.round(w.left || 236) + 'px');
    $('#shell').style.setProperty('--pf-w-mid', Math.round(w.mid || 384) + 'px');
  }

  /* ── the agent: prompt, tools, turn ───────────────────────────────── */
  function sysPrompt(p) {
    const t = targetOf(p);
    const d = dimsFor(p);
    const out = [];
    out.push('You are Proto Agent, a senior product designer and front-end engineer inside "Proto Studio", a tool for making visual UI prototypes.');
    out.push('TARGET DEVICE: ' + t.label + ' — design at exactly ' + d.w + ' × ' + d.h + ' CSS px (' + t.kind + '), ' +
      (p.landscape ? 'landscape' : p.target === 'desktop' ? 'desktop' : 'portrait') + '.');
    out.push('');
    out.push('HOW YOU REPLY:');
    out.push('1. Always call the set_prototype tool with the COMPLETE, updated HTML document — never a diff, a fragment or a description of a change.');
    out.push('2. Then write 1–2 short sentences saying what you changed and what the user could ask for next. No headings, no code blocks in the reply text.');
    out.push('');
    out.push('THE PROTOTYPE MUST:');
    out.push('- Be one self-contained HTML document: inline <style>, optional inline <script>. No frameworks, no build step, no CDN links.');
    out.push('- Make NO network requests — no external fonts, images, icons or scripts. Use a system font stack, CSS gradients, inline SVG and emoji for visuals.');
    out.push('- Include <meta charset="utf-8"> and <meta name="viewport" content="width=device-width, initial-scale=1">.');
    out.push('- Use REAL, specific copy for the product — never lorem ipsum, never "Sample text".');
    out.push('- Look deliberately designed: a type scale with clear hierarchy, a 4/8px spacing rhythm, one accent colour, generous whitespace, rounded corners, subtle shadows, and hover/active/focus states.');
    out.push('- Be interactive where it helps: working tabs, toggles, a cart badge, a stepper, a modal. Use plain inline JavaScript.');
    out.push('- NEVER use alert(), confirm() or prompt() — they are blocked in this environment. Build dialogs in the page itself by showing/hiding elements.');
    if (p.target === 'desktop') {
      out.push('- Be pointer-first: horizontal top nav, hover states, content max-width around 1180px, no horizontal scrolling at ' + d.w + 'px wide.');
    } else {
      out.push('- Be touch-first: a tab bar or bottom nav, ≥44px tap targets, no hover-only affordances, ~16–20px page padding, and no horizontal scrolling at ' + d.w + 'px wide.');
    }
    out.push('');
    out.push('Other tools: create_project(name, target), list_projects(), rename_project(name), set_device(target) — use them when the user asks for a separate prototype, a different device size, or a rename.');
    const html = (p.html || '').trim();
    out.push('');
    if (html) {
      out.push('CURRENT PROTOTYPE — this is what the user sees right now. Evolve it and keep what already works:');
      out.push('~~~html');
      out.push(html);
      out.push('~~~');
    } else {
      out.push('CURRENT PROTOTYPE: none yet — this is the first pass, so build the whole thing from scratch.');
    }
    return out.join('\n');
  }

  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'set_prototype',
        description: 'Replace the prototype with a COMPLETE, self-contained HTML document. Call this every time you change the design — the html you pass is exactly what the preview renders.',
        parameters: {
          type: 'object',
          properties: {
            html: { type: 'string', description: 'The complete HTML document (inline style/script), not a diff or fragment.' },
            summary: { type: 'string', description: 'One short sentence describing what changed.' }
          },
          required: ['html']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_project',
        description: 'Create a new empty prototype project and switch to it. Use this when the user asks for a separate prototype instead of a change to the current one.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name.' },
            target: { type: 'string', enum: ['desktop', 'tablet', 'phone'], description: 'Device the prototype is designed for.' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_projects',
        description: 'List the prototype projects in this app: id, name, device, whether they have a design, and which one is active.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rename_project',
        description: 'Rename the current prototype project.',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_device',
        description: 'Change the preview device for the current project.',
        parameters: { type: 'object', properties: { target: { type: 'string', enum: ['desktop', 'tablet', 'phone'] } }, required: ['target'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'open_project',
        description: 'Switch to another existing prototype project by its id or name (partial names work). Use list_projects first if you are unsure of the name.',
        parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } }
      }
    },
    {
      type: 'function',
      function: {
        name: 'duplicate_project',
        description: 'Copy the current project (design and conversation) into a new one and switch to it — the way to make a variant, such as a phone version of a desktop design.',
        parameters: { type: 'object', properties: { name: { type: 'string', description: 'Name for the copy. Defaults to the current name plus " copy".' } } }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_project',
        description: 'Delete the current prototype project and everything in it. ONLY call this when the user explicitly asks to delete a prototype.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clear_conversation',
        description: 'Clear the conversation history for the current project, keeping its prototype.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];

  function normalizeCall(call) {
    const fn = (call && call.function) || {};
    const name = (call && call.name) || fn.name || (call && call.tool) || '';
    let args = (call && call.arguments != null) ? call.arguments
      : (fn.arguments != null) ? fn.arguments
        : (call && call.args != null) ? call.args : {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (err) { args = {}; }
    }
    if (!args || typeof args !== 'object') args = {};
    return { name: String(name), args: args };
  }

  function applyHtml(p, html) {
    p.html = html;
    p.updated = Date.now();
    frameDoc = null;
    save();
    renderProjects();
    renderCanvas();
    renderAgentHeader();
  }

  async function handleTool(p, name, args) {
    switch (name) {
      case 'set_prototype': {
        const html = typeof args.html === 'string' ? args.html : '';
        if (!html.trim()) return 'ERROR: html was empty. Call set_prototype again with the complete document.';
        applyHtml(p, html);
        return 'Prototype updated — ' + fmtBytes(html.length) + ' now live in the preview.';
      }
      case 'create_project': {
        const proj = newProject(String(args.name || 'Untitled prototype'), args.target);
        if (typeof args.html === 'string' && args.html.trim()) proj.html = args.html;
        store.projects.push(proj);
        store.activeId = proj.id;
        frameDoc = null;
        save();
        renderAll();
        return 'Created and switched to project "' + proj.name + '" (id ' + proj.id + ', ' + targetOf(proj).label + ').';
      }
      case 'list_projects': {
        return JSON.stringify(store.projects.map((x) => ({
          id: x.id, name: x.name, device: x.target, hasDesign: !!x.html, active: x.id === store.activeId
        })));
      }
      case 'rename_project': {
        const nm = String(args.name || '').trim();
        if (!nm) return 'ERROR: name was empty.';
        p.name = nm;
        p.updated = Date.now();
        save();
        renderProjects();
        renderCanvas();
        return 'Renamed the project to "' + nm + '".';
      }
      case 'set_device': {
        const tg = String(args.target || '');
        if (!TARGETS[tg]) return 'ERROR: target must be desktop, tablet or phone.';
        p.target = tg;
        p.targetAuto = false;
        p.landscape = false;
        save();
        renderProjects();
        renderCanvas();
        renderAgentHeader();
        return 'Preview device is now ' + TARGETS[tg].label + '.';
      }
      case 'open_project': {
        const key = String(args.id || args.name || '').trim().toLowerCase();
        if (!key) return 'ERROR: pass an id or a name.';
        const found = store.projects.find((x) => x.id.toLowerCase() === key) ||
          store.projects.find((x) => x.name.toLowerCase() === key) ||
          store.projects.find((x) => x.name.toLowerCase().indexOf(key) >= 0);
        if (!found) return 'ERROR: no project matches "' + key + '". Use list_projects to see them.';
        store.activeId = found.id;
        frameDoc = null;
        save();
        renderAll();
        return 'Switched to "' + found.name + '" (' + targetOf(found).label + (found.html ? ', has a design' : ', empty') + ').';
      }
      case 'duplicate_project': {
        const copy = JSON.parse(JSON.stringify(p));
        copy.id = uid();
        copy.name = String(args.name || (p.name + ' copy')).trim();
        copy.created = Date.now();
        copy.updated = Date.now();
        store.projects.push(copy);
        store.activeId = copy.id;
        frameDoc = null;
        save();
        renderAll();
        return 'Duplicated to "' + copy.name + '" and switched to it.';
      }
      case 'delete_project': {
        const gone = p.name;
        store.projects = store.projects.filter((x) => x.id !== p.id);
        store.activeId = store.projects.length ? store.projects[0].id : null;
        frameDoc = null;
        save();
        renderAll();
        return 'Deleted the project "' + gone + '". Active project is now ' +
          (active() ? '"' + active().name + '"' : 'none') + '.';
      }
      case 'clear_conversation': {
        p.chat = [];
        save();
        renderChat();
        renderProjects();
        return 'Cleared this project’s conversation; the prototype is unchanged.';
      }
      default:
        return 'ERROR: unknown tool "' + name + '".';
    }
  }

  function tokenText(chunk) {
    if (typeof chunk === 'string') return chunk;
    if (!chunk || typeof chunk !== 'object') return '';
    if (typeof chunk.text === 'string') return chunk.text;
    if (typeof chunk.token === 'string') return chunk.token;
    if (typeof chunk.content === 'string') return chunk.content;
    return '';
  }

  function extractHtml(text) {
    const src = String(text || '');
    let best = '';
    const re = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const body = m[1].trim();
      if (body.length > 80 && /<(?:!doctype|html|head|body|div|section|main|style|script|nav|header)/i.test(body) && body.length > best.length) {
        best = body;
      }
    }
    if (best) return best;
    const trimmed = src.trim();
    if (/^<!doctype html/i.test(trimmed) || (/<html[\s>]/i.test(trimmed) && trimmed.length > 200)) return trimmed;
    return '';
  }

  function stripCode(text) {
    return String(text || '').replace(/```[a-zA-Z]*[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function buildMessages(p) {
    const msgs = [{ role: 'system', content: sysPrompt(p) }];
    p.chat.filter((m) => !m.error).slice(-20).forEach(function (m) {
      const c = (m.content || '').trim();
      if (!c) return;
      msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: c.length > 3000 ? c.slice(0, 3000) + ' …' : c });
    });
    return msgs;
  }

  function pushMsg(p, msg) {
    p.chat.push(Object.assign({ ts: Date.now() }, msg));
    if (p.chat.length > 60) p.chat.splice(0, p.chat.length - 60);
  }

  function pushLive() {
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    wrap.innerHTML = '<div class="msg-role">Proto Agent</div>' +
      '<div class="bubble"><div class="msg-body"><span class="pf-typing"><span></span><span></span><span></span></span></div></div>';
    $('#chatLog').append(wrap);
    scrollChat();
    return wrap;
  }

  function setLiveText(el, text) {
    const body = el.querySelector('.msg-body');
    if (body) body.innerHTML = mdToHtml(text) + '<span class="pf-cursor"></span>';
  }

  function addToolRow(name, ok) {
    if (!liveEl) return;
    const row = document.createElement('div');
    row.className = 'tool pf-tool';
    row.innerHTML = '<div class="tool-head"><span class="tool-name"></span><span class="tool-status">done</span></div>';
    row.querySelector('.tool-name').textContent = name;
    row.querySelector('.tool-status').textContent = ok;
    const bubble = liveEl.querySelector('.bubble');
    if (bubble) bubble.append(row);
    scrollChat();
  }

  function setBusy(on) {
    busy = on;
    $('#btnSend').disabled = on;
    $('#btnStop').hidden = !on;
    $('#prompt').disabled = on;
    $('#composerHint').textContent = on ? 'Proto Agent is designing…' : '⌘⏎ to send';
    if (on) $('#chips').textContent = ''; else renderChips();
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight + 2, 190) + 'px';
  }

  function autoName(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').slice(0, 7).join(' ');
    const name = words.charAt(0).toUpperCase() + words.slice(1);
    return name.length > 54 ? name.slice(0, 51).trim() + '…' : name;
  }

  function inferTarget(text) {
    const s = String(text || '').toLowerCase();
    if (/\b(phone|mobile|iphone|android|ios|smartphone|handset|app store)\b/.test(s)) return 'phone';
    if (/\b(tablet|ipad)\b/.test(s)) return 'tablet';
    if (/\b(website|web site|webpage|web page|landing page|marketing site|desktop|saas dashboard|admin panel)\b/.test(s)) return 'desktop';
    return null;
  }

  async function send(prefill) {
    if (busy) return;
    const box = $('#prompt');
    const text = String(prefill != null ? prefill : box.value).trim();
    if (!text) return;

    let p = active();
    if (!p) {
      p = newProject(autoName(text), null);
      store.projects.push(p);
      store.activeId = p.id;
    }
    if (p.targetAuto) {
      const guess = inferTarget(text);
      if (guess) p.target = guess;
      p.targetAuto = false;
      frameDoc = null;
    }
    pushMsg(p, { role: 'user', content: text });
    box.value = '';
    autoGrow(box);
    p.updated = Date.now();
    save();
    renderProjects();
    renderAgentHeader();
    renderChat();
    renderCanvas();
    await runTurn(p);
  }

  async function runTurn(p) {
    setBusy(true);
    liveBuf = '';
    liveEl = pushLive();
    abortCtl = new AbortController();
    const priorHtml = p.html;
    let finalText = '';
    let failed = null;
    let aborted = false;

    try {
      const res = await window.chatoss.chat.runTurn({
        model: resolveModel(p),
        messages: buildMessages(p),
        tools: TOOLS,
        onToken: function (chunk) {
          const s = tokenText(chunk);
          if (!s) return;
          if (liveBuf && s.length > liveBuf.length && s.indexOf(liveBuf) === 0) liveBuf = s;
          else liveBuf += s;
          if (liveEl) setLiveText(liveEl, liveBuf);
          scrollChat();
        },
        onToolCall: async function (call) {
          const info = normalizeCall(call);
          let out = '';
          try {
            out = await handleTool(p, info.name, info.args);
          } catch (err) {
            out = 'ERROR: ' + (err && err.message ? err.message : String(err));
          }
          addToolRow(info.name || 'tool', info.name === 'set_prototype' ? 'updated' : 'ok');
          return out;
        },
        signal: abortCtl.signal
      });
      if (res && typeof res.content === 'string') finalText = res.content;
      if (res && res.aborted) aborted = true;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if ((err && err.name === 'AbortError') || /abort/i.test(msg)) aborted = true;
      else failed = msg;
    }

    abortCtl = null;
    const reply = (finalText || liveBuf || '').trim();
    let applied = p.html !== priorHtml;

    if (!applied && reply) {
      const fromReply = extractHtml(reply);
      if (fromReply && fromReply !== p.html) {
        p.html = fromReply;
        p.updated = Date.now();
        frameDoc = null;
        applied = true;
      }
    }

    if (liveEl) liveEl.remove();
    liveEl = null;
    liveBuf = '';

    let note = stripCode(reply);
    if (aborted && !note) note = applied ? 'Stopped — what was designed so far is applied.' : 'Stopped.';
    if (note || applied) {
      pushMsg(p, { role: 'assistant', content: note || 'Prototype updated.', applied: applied });
      p.updated = Date.now();
      save();
    }
    if (failed) {
      const el = document.createElement('div');
      el.className = 'msg assistant';
      el.innerHTML = '<div class="msg-role">Proto Agent</div><div class="bubble"><div class="msg-body pf-error"></div></div>';
      el.querySelector('.msg-body').textContent = 'That turn did not finish: ' + failed +
        '\n\nRetry, or pick a different model in the picker above.';
      $('#chatLog').append(el);
      scrollChat();
      toast('Turn failed — see the conversation', true);
    }

    setBusy(false);
    renderProjects();
    renderAgentHeader();
    renderChat();
    renderCanvas();
  }

  /* ── modals (in-frame: window.confirm/alert/prompt do not work) ───── */
  function openNameModal(opts) {
    return new Promise(function (resolve) {
      nameResolve = resolve;
      $('#mdNameTitle').textContent = opts.title || 'New project';
      $('#mdNameInput').value = opts.value || '';
      $('#mdNameSave').textContent = opts.confirmLabel || 'Create';
      $('#mdTargetField').hidden = !opts.withTarget;
      if (opts.withTarget) $('#mdTargetSelect').value = opts.target || 'desktop';
      $('#mdName').hidden = false;
      setTimeout(function () { $('#mdNameInput').focus(); $('#mdNameInput').select(); }, 0);
    });
  }

  function closeNameModal(value) {
    $('#mdName').hidden = true;
    const r = nameResolve;
    nameResolve = null;
    if (r) r(value);
  }

  function openConfirm(opts) {
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      $('#mdConfirmTitle').textContent = opts.title || 'Are you sure?';
      $('#mdConfirmText').textContent = opts.text || '';
      $('#mdConfirmOk').textContent = opts.okLabel || 'Delete';
      $('#mdConfirm').hidden = false;
    });
  }

  function closeConfirm(value) {
    $('#mdConfirm').hidden = true;
    const r = confirmResolve;
    confirmResolve = null;
    if (r) r(value);
  }

  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  /* ── project actions ──────────────────────────────────────────────── */
  async function actionNew() {
    const out = await openNameModal({ title: 'New project', confirmLabel: 'Create', withTarget: true, value: '' });
    if (!out) return;
    const p = newProject(out.name, out.target);
    store.projects.push(p);
    store.activeId = p.id;
    frameDoc = null;
    save();
    renderAll();
    $('#prompt').focus();
  }

  async function actionRename() {
    const p = active();
    if (!p) return;
    const out = await openNameModal({ title: 'Rename project', confirmLabel: 'Save', value: p.name });
    if (!out) return;
    p.name = out.name;
    p.updated = Date.now();
    save();
    renderAll();
  }

  function actionDuplicate() {
    const p = active();
    if (!p) return;
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = uid();
    copy.name = p.name + ' copy';
    copy.created = Date.now();
    copy.updated = Date.now();
    store.projects.push(copy);
    store.activeId = copy.id;
    frameDoc = null;
    save();
    renderAll();
    toast('Duplicated "' + p.name + '"');
  }

  async function actionDelete() {
    const p = active();
    if (!p) return;
    const ok = await openConfirm({
      title: 'Delete project',
      text: 'Delete “' + p.name + '”? Its design and its conversation are removed. This cannot be undone.',
      okLabel: 'Delete'
    });
    if (!ok) return;
    store.projects = store.projects.filter((x) => x.id !== p.id);
    store.activeId = store.projects.length ? store.projects[0].id : null;
    frameDoc = null;
    save();
    renderAll();
    toast('Deleted "' + p.name + '"');
  }

  async function actionClearChat() {
    const p = active();
    if (!p || !p.chat.length) return;
    const ok = await openConfirm({
      title: 'Clear conversation',
      text: 'Clear this project’s conversation? The prototype itself is kept.',
      okLabel: 'Clear'
    });
    if (!ok) return;
    p.chat = [];
    save();
    renderChat();
    renderProjects();
  }

  /* ── canvas actions ───────────────────────────────────────────────── */
  function setTarget(tg) {
    const p = active();
    if (!p || !TARGETS[tg] || p.target === tg) return;
    p.target = tg;
    p.targetAuto = false;
    p.landscape = false;
    save();
    renderProjects();
    renderCanvas();
    renderAgentHeader();
    toast('Previewing as ' + TARGETS[tg].label);
  }

  function openCode() {
    codeOpen = true;
    $('#codePane').hidden = false;
    $('#stage').hidden = true;
    syncCode();
    $('#codeEditor').focus();
  }

  function closeCode() {
    codeOpen = false;
    $('#codePane').hidden = true;
    $('#stage').hidden = false;
    renderCanvas();
  }

  async function actionCopy() {
    const p = active();
    if (!p || !p.html) { toast('Nothing to copy yet', true); return; }
    try {
      await window.chatoss.clipboard.writeText(p.html);
      toast('Prototype HTML copied');
    } catch (err) {
      toast('Clipboard blocked — check the app’s permissions', true);
    }
  }

  async function actionSaveDrive() {
    const p = active();
    if (!p || !p.html) { toast('Nothing to save yet', true); return; }
    const btn = $('#btnSaveDrive');
    btn.disabled = true;
    try {
      const path = 'prototypes/' + slug(p.name) + '-' + p.target + '.html';
      const out = await window.chatoss.drive.writeFile(path, p.html, { mime: 'text/html' });
      toast('Saved to Drive · ' + ((out && out.path) || path));
    } catch (err) {
      toast('Could not save: ' + (err && err.message ? err.message : String(err)), true);
    } finally {
      btn.disabled = false;
    }
  }

  /* ── wiring ───────────────────────────────────────────────────────── */
  function initGrip(el, which) {
    el.addEventListener('pointerdown', function (down) {
      down.preventDefault();
      const startX = down.clientX;
      const startW = (store.widths && store.widths[which]) || (which === 'left' ? 236 : 384);
      el.classList.add('is-dragging');
      try { el.setPointerCapture(down.pointerId); } catch (err) { /* ignore */ }

      function move(ev) {
        const raw = startW + (ev.clientX - startX);
        const w = which === 'left'
          ? Math.max(160, Math.min(460, raw))
          : Math.max(280, Math.min(640, raw));
        store.widths[which] = w;
        applyWidths();
      }
      function up() {
        el.classList.remove('is-dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        save();
        if (store.zoom === 'fit') renderCanvas();
      }
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  async function loadModels() {
    const sel = $('#modelSelect');
    sel.textContent = '';
    try {
      const list = await window.chatoss.chat.listModels();
      defaultModel = await window.chatoss.chat.getDefaultModel().catch(function () { return null; });
      models = Array.isArray(list) ? list : [];
      if (!models.length) throw new Error('no models');
      models.forEach(function (m) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name + (m.available === false ? ' (unavailable)' : '');
        opt.disabled = m.available === false;
        sel.append(opt);
      });
    } catch (err) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'ChatOSS default model';
      sel.append(opt);
      console.warn('[proto] model list unavailable', err);
    }
    renderAgentHeader();
  }

  function initEvents() {
    $('#btnNew').addEventListener('click', actionNew);
    $('#btnRename').addEventListener('click', actionRename);
    $('#btnDuplicate').addEventListener('click', actionDuplicate);
    $('#btnDelete').addEventListener('click', actionDelete);
    $('#btnClearChat').addEventListener('click', actionClearChat);

    $('#btnSend').addEventListener('click', function () { send(); });
    $('#btnStop').addEventListener('click', function () {
      if (abortCtl) { try { abortCtl.abort(); } catch (err) { /* ignore */ } toast('Stopping…'); }
    });
    $('#prompt').addEventListener('input', function (e) { autoGrow(e.target); });
    $('#prompt').addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });

    $('#modelSelect').addEventListener('change', function (e) {
      const p = active();
      store.model = e.target.value;
      if (p) p.model = e.target.value;
      save();
      renderAgentHeader();
    });

    $$('#targetSeg .seg-item').forEach(function (b) {
      b.addEventListener('click', function () { setTarget(b.dataset.target); });
    });
    $('#btnRotate').addEventListener('click', function () {
      const p = active();
      if (!p || p.target === 'desktop') return;
      p.landscape = !p.landscape;
      save();
      renderCanvas();
      renderAgentHeader();
    });
    $('#zoomSelect').addEventListener('change', function (e) {
      store.zoom = e.target.value;
      save();
      renderCanvas();
    });
    $('#btnReload').addEventListener('click', function () {
      const p = active();
      if (!p || !p.html) return;
      frameDoc = null;
      renderCanvas();
      toast('Preview reloaded');
    });

    $('#btnCode').addEventListener('click', function () { codeOpen ? closeCode() : openCode(); });
    $('#btnCodeClose').addEventListener('click', closeCode);
    $('#btnCodeApply').addEventListener('click', function () {
      const p = active();
      if (!p) return;
      p.html = $('#codeEditor').value;
      p.updated = Date.now();
      save();
      frameDoc = null;
      renderCanvas();
      renderProjects();
      renderAgentHeader();
      toast('Prototype updated from source');
    });
    $('#btnCodeRevert').addEventListener('click', function () { syncCode(); toast('Source reverted'); });

    $('#btnCopy').addEventListener('click', actionCopy);
    $('#btnSaveDrive').addEventListener('click', actionSaveDrive);

    $('#btnStarter').addEventListener('click', function () {
      send('A landing page for a small-batch coffee subscription');
    });
    $('#btnStarterCode').addEventListener('click', openCode);

    $('#mdNameSave').addEventListener('click', function () {
      const v = $('#mdNameInput').value.trim();
      if (!v) { $('#mdNameInput').focus(); return; }
      closeNameModal({ name: v, target: $('#mdTargetSelect').value });
    });
    $('#mdNameCancel').addEventListener('click', function () { closeNameModal(null); });
    $('#mdNameX').addEventListener('click', function () { closeNameModal(null); });
    $('#mdNameInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#mdNameSave').click(); }
    });

    $('#mdConfirmOk').addEventListener('click', function () { closeConfirm(true); });
    $('#mdConfirmCancel').addEventListener('click', function () { closeConfirm(false); });
    $('#mdConfirmX').addEventListener('click', function () { closeConfirm(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#mdName').hidden) closeNameModal(null);
        if (!$('#mdConfirm').hidden) closeConfirm(false);
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && ['1', '2', '3'].indexOf(e.key) >= 0) {
        setTarget(['desktop', 'tablet', 'phone'][Number(e.key) - 1]);
      }
    });
  }

  function initStageObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(function () {
      if (store.zoom === 'fit') renderCanvas();
    });
    ro.observe($('#stage'));
  }

  /* ── boot ─────────────────────────────────────────────────────────── */
  async function boot() {
    if (!window.chatoss) {
      document.body.innerHTML = '<div class="empty" style="margin:80px auto;max-width:420px">' +
        '<div class="empty-title">Proto Studio needs the ChatOSS runtime</div>' +
        '<div class="empty-text">Open this app from the ChatOSS dock to run it.</div></div>';
      return;
    }
    await loadStore();
    applyWidths();
    initGrips();
    initEvents();
    initStageObserver();
    renderAll();
    await loadModels();
    autoGrow($('#prompt'));
  }

  function initGrips() {
    initGrip($('#gripLeft'), 'left');
    initGrip($('#gripMid'), 'mid');
  }

  /* The seed prototype — a compact, real-looking landing page so the canvas
     shows the device frames immediately. No network requests, no alerts. */
  const SAMPLE_HTML = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Ember &amp; Oak — small-batch coffee</title>',
    '<style>',
    '  :root{--ink:#1a1512;--muted:#6f6157;--brand:#c2410c;--bg:#fdf8f4;--line:#eadfd5;--card:#fff}',
    '  *{box-sizing:border-box}',
    '  html,body{margin:0}',
    '  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}',
    '  .wrap{max-width:1080px;margin:0 auto;padding:0 28px}',
    '  a{color:inherit}',
    '  header{position:sticky;top:0;z-index:5;background:rgba(253,248,244,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}',
    '  nav{display:flex;align-items:center;gap:26px;height:64px}',
    '  .logo{font-weight:800;letter-spacing:-.02em;font-size:17px}',
    '  .logo em{color:var(--brand);font-style:normal}',
    '  nav .links{display:flex;gap:22px;margin-left:auto}',
    '  nav .links a{font-size:14px;color:var(--muted);text-decoration:none}',
    '  nav .links a:hover{color:var(--ink)}',
    '  .btn{display:inline-block;padding:11px 16px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none;border:1px solid transparent;cursor:pointer;transition:transform .12s ease,filter .12s ease}',
    '  .btn:active{transform:translateY(1px)}',
    '  .btn-primary{background:var(--brand);color:#fff}',
    '  .btn-primary:hover{filter:brightness(1.08)}',
    '  .btn-ghost{border-color:var(--line);background:#fff}',
    '  .btn-ghost:hover{border-color:#d6c6b8}',
    '  .hero{display:grid;grid-template-columns:1.02fr .98fr;gap:56px;align-items:center;padding:76px 0 58px}',
    '  .kicker{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--brand);margin:0 0 14px}',
    '  h1{margin:0 0 18px;font-size:clamp(34px,4.6vw,56px);line-height:1.04;letter-spacing:-.035em}',
    '  .lede{margin:0 0 28px;font-size:18px;color:var(--muted);max-width:44ch}',
    '  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}',
    '  .fine{font-size:13px;color:var(--muted)}',
    '  .art{position:relative;aspect-ratio:1/1.02;border-radius:26px;overflow:hidden;box-shadow:0 34px 70px rgba(124,45,18,.26);background:radial-gradient(130% 90% at 18% 8%,#ffd9a8 0%,rgba(255,217,168,0) 62%),linear-gradient(155deg,#7c2d12,#231d19)}',
    '  .art .cup{position:absolute;left:50%;top:52%;width:56%;aspect-ratio:1/.86;transform:translate(-50%,-50%);background:linear-gradient(180deg,#fdf3e8,#e0cbb2);border-radius:14px 14px 26px 26px;box-shadow:inset 0 -10px 24px rgba(124,45,18,.18)}',
    '  .art .cup::after{content:"";position:absolute;left:12%;right:12%;top:26%;height:16%;border-radius:8px;background:#43291c;opacity:.92}',
    '  .stats{display:flex;gap:34px;padding-top:22px;border-top:1px solid var(--line);margin-top:44px}',
    '  .stats b{display:block;font-size:22px;letter-spacing:-.02em}',
    '  .stats span{font-size:12.5px;color:var(--muted)}',
    '  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:8px 0 84px}',
    '  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;transition:box-shadow .16s ease,transform .16s ease}',
    '  .card:hover{transform:translateY(-2px);box-shadow:0 18px 40px rgba(26,21,18,.09)}',
    '  .card .ico{width:38px;height:38px;border-radius:11px;background:#fdece0;display:grid;place-items:center;font-size:18px;margin-bottom:14px}',
    '  .card h3{margin:0 0 6px;font-size:15.5px}',
    '  .card p{margin:0;font-size:13.5px;color:var(--muted)}',
    '  footer{border-top:1px solid var(--line)}',
    '  footer .wrap{display:flex;align-items:center;gap:12px;padding-top:24px;padding-bottom:24px;font-size:12.5px;color:var(--muted)}',
    '  @media (max-width:860px){.hero{grid-template-columns:1fr;padding-top:44px}.cards{grid-template-columns:1fr}.art{max-width:340px}}',
    '</style>',
    '</head>',
    '<body>',
    '<header><div class="wrap"><nav>',
    '  <div class="logo">Ember <em>&amp;</em> Oak</div>',
    '  <div class="links"><a href="#">Beans</a><a href="#">Subscribe</a><a href="#">Brew guide</a><a href="#">About</a></div>',
    '  <a class="btn btn-primary" href="#">Start a subscription</a>',
    '</nav></div></header>',
    '<main class="wrap">',
    '  <section class="hero">',
    '    <div>',
    '      <p class="kicker">Roasted every Tuesday</p>',
    '      <h1>Small-batch coffee,<br>delivered before it peaks.</h1>',
    '      <p class="lede">Two roasters, one farm list, zero guesswork. We ship within 48 hours of roast, so your first cup tastes like our cupping table.</p>',
    '      <div class="row">',
    '        <a class="btn btn-primary" href="#" id="cta">Choose your roast</a>',
    '        <a class="btn btn-ghost" href="#">See this week&rsquo;s lot</a>',
    '      </div>',
    '      <div class="stats">',
    '        <div><b>48h</b><span>roast to ship</span></div>',
    '        <div><b>11</b><span>partner farms</span></div>',
    '        <div><b>4.9</b><span>average rating</span></div>',
    '      </div>',
    '    </div>',
    '    <div class="art"><div class="cup"></div></div>',
    '  </section>',
    '  <section class="cards">',
    '    <div class="card"><div class="ico">🌱</div><h3>Single origin</h3><p>One farm, one harvest, tracked from lot to label.</p></div>',
    '    <div class="card"><div class="ico">⚖️</div><h3>Dialed in</h3><p>A brew card with grams, grind and time in every box.</p></div>',
    '    <div class="card"><div class="ico">📦</div><h3>Skip anytime</h3><p>Pause, skip or swap the lot from your dashboard.</p></div>',
    '  </section>',
    '</main>',
    '<footer><div class="wrap">© 2026 Ember &amp; Oak · Portland, OR <span style="margin-left:auto">Prototype — Proto Studio</span></div></footer>',
    '<script>',
    '  document.getElementById("cta").addEventListener("click", function (e) {',
    '    e.preventDefault();',
    '    this.textContent = "Added to your cart ✓";',
    '  });',
    '</' + 'script>',
    '</body>',
    '</html>'
  ].join('\n');

  boot();

})();
