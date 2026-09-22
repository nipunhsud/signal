// The chat over the alert pool, as a mountable widget. Two homes: the
// standalone page (chat.dataquant.ai, /chat) and the side panel inside the
// dashboard. Same DOM ids, same /api/chat, same voice. Plain script, no build.
//
//   const chat = DQChat.mount(rootEl, { region: 'us', compact: true, onClose });
//   chat.select('SWKS'); chat.ask('Compare the selected'); chat.focus();
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtPct = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
  const SUGGESTIONS = [
    'Weigh all the evidence on the strongest name in the pool.',
    'Which names in the pool are still within 5% of the pivot?',
    'Rank the pool by base grade, then by how far past the pivot each one closed.',
    'Which of these have the longest, shallowest bases?',
    'Which sectors lead right now, and which names sit in them?',
    'Does the market regime change how these breakouts are likely to go?',
    'Which names fell through the fail level, and what did their bases look like?',
  ];
  const TOOL_WORDS = { analyze_ticker: 'weighed the full dossier', get_recent_alerts: 'read the alert pool', get_signal_history: 'read the alert history', get_base_xray: 'ran the base X-ray', get_market_health: 'checked market health', get_sector_strength: 'checked sector strength', search_learn: 'searched Learn' };

  // Small markdown: paragraphs, bullets, numbered lists, bold, code, tables.
  function md(src) {
    const lines = String(src || '').split('\n');
    let out = '', i = 0;
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const head = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        i += 2; const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++; }
        out += '<div class="overflow-x-auto"><table><thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
        continue;
      }
      if (/^\s*[-*] /.test(l)) { out += '<ul>'; while (i < lines.length && /^\s*[-*] /.test(lines[i])) { out += '<li>' + inline(lines[i].replace(/^\s*[-*] /, '')) + '</li>'; i++; } out += '</ul>'; continue; }
      if (/^\s*\d+[.)] /.test(l)) { out += '<ol>'; while (i < lines.length && /^\s*\d+[.)] /.test(lines[i])) { out += '<li>' + inline(lines[i].replace(/^\s*\d+[.)] /, '')) + '</li>'; i++; } out += '</ol>'; continue; }
      if (/^#{1,3} /.test(l)) { out += '<p><strong>' + inline(l.replace(/^#{1,3} /, '')) + '</strong></p>'; i++; continue; }
      if (!l.trim()) { i++; continue; }
      let para = l; i++;
      while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)]) /.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^#{1,3} /.test(lines[i])) { para += ' ' + lines[i]; i++; }
      out += '<p>' + inline(para) + '</p>';
    }
    return out;
  }

  const CSS = `
    .dqc { display:flex; flex-direction:column; height:100%; min-height:0; color:#f3f4f6; }
    .dqc .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
    .dqc .msg p { margin: 0 0 .6em; } .dqc .msg p:last-child { margin-bottom: 0; }
    .dqc .msg ul, .dqc .msg ol { margin: 0 0 .6em 1.2em; } .dqc .msg li { margin: .15em 0; }
    .dqc .msg table { border-collapse: collapse; margin: .4em 0 .8em; font-size: 13px; }
    .dqc .msg th, .dqc .msg td { border: 1px solid #374151; padding: 4px 8px; text-align: left; white-space: nowrap; }
    .dqc .msg th { color: #9ca3af; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .dqc .msg code { background: rgba(148,163,184,.12); padding: 0 4px; border-radius: 4px; font-size: 12px; }
    .dqc .msg strong { color: #fff; }
    .dqc .tool { font-size: 11px; color: #9ca3af; } .dqc .tool::before { content: '·'; margin-right: 6px; color: #60a5fa; }
    .dqc .pool-row.selected { background: rgba(96,165,250,.12); }
    .dqc .chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #374151; color: #9ca3af; background: transparent; cursor: pointer; }
    .dqc .chip.on { border-color: #60a5fa; color: #bfdbfe; background: rgba(96,165,250,.12); }
    .dqc .kbd { font-size: 10px; border: 1px solid #374151; border-radius: 4px; padding: 0 4px; color: #9ca3af; }
    .dqc .typing::after { content: '▍'; animation: dqc-blink 1s steps(2) infinite; color: #9ca3af; }
    @keyframes dqc-blink { to { opacity: 0; } }
    .dqc.page { flex-direction: row; }
    .dqc.page .dqc-pool { width: 20rem; flex-shrink: 0; border-right: 1px solid #1f2937; }
    @media (min-width: 1024px) { .dqc.page .dqc-pool { width: 24rem; } }
    @media (max-width: 860px) { .dqc.page .dqc-pool { position: fixed; inset: 48px 0 0 0; z-index: 30; display: none; background:#111827; } .dqc.page .dqc-pool.open { display: flex; } }
    .dqc.compact .dqc-pool { border-bottom: 1px solid #1f2937; max-height: 40%; }
    .dqc.compact .dqc-pool.collapsed #pool-list, .dqc.compact .dqc-pool.collapsed #pool-filters, .dqc.compact .dqc-pool.collapsed .dqc-pool-foot { display: none; }
  `;

  // Clerk's session cookie is a short-lived token; page loads refresh it via
  // the server handshake, fetches do not. Load Clerk's browser SDK once in the
  // background (it keeps the cookie fresh) and expose a refresh for the 401
  // retry. Without this every question a minute after load came back 401 and
  // the page bounced to the landing.
  let clerkLoading = null;
  function loadClerk(key) {
    if (window.Clerk?.loaded) return Promise.resolve(window.Clerk);
    if (clerkLoading) return clerkLoading;
    if (!key) return Promise.reject(new Error('Clerk key not configured'));
    const frontendApi = atob(key.split('_').slice(2).join('_') || '').replace(/\$+$/, '');
    clerkLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://${frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.clerkPublishableKey = key;
      script.onload = () => window.Clerk.load().then(() => resolve(window.Clerk), reject);
      script.onerror = () => reject(new Error('Clerk SDK failed to load'));
      document.head.appendChild(script);
    }).catch((e) => { clerkLoading = null; throw e; });
    return clerkLoading;
  }
  async function refreshSession(key) {
    const clerk = await loadClerk(key);
    // getToken() mints a fresh session JWT and rewrites the __session cookie.
    await clerk.session?.getToken();
  }

  const timeHHMM = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const STORE_KEY = (region) => `dqchat:${region}`;

  function mount(root, opts = {}) {
    if (!document.getElementById('dqc-style')) { const st = document.createElement('style'); st.id = 'dqc-style'; st.textContent = CSS; document.head.appendChild(st); }
    const compact = !!opts.compact;
    root.innerHTML = `
      <div class="dqc ${compact ? 'compact' : 'page'}">
        <aside class="dqc-pool ${compact ? 'collapsed' : ''} flex flex-col bg-gray-900 min-h-0" id="pool">
          <div class="px-3 py-2 border-b border-gray-800 flex items-center gap-2 flex-wrap ${compact ? 'cursor-pointer select-none' : ''}" ${compact ? 'onclick="this.parentElement.classList.toggle(\'collapsed\')"' : ''}>
            <span class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">The pool</span>
            <select id="days" class="bg-gray-800 text-gray-300 text-xs rounded px-1.5 py-0.5 ring-1 ring-gray-700" onclick="event.stopPropagation()">
              <option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option><option value="60">60 days</option>
            </select>
            <span id="pool-summary" class="text-[11px] text-gray-500 ml-auto mono"></span>
            ${compact ? '<span class="text-gray-500 text-xs">▾</span>' : ''}
          </div>
          <div class="px-3 py-2 border-b border-gray-800 flex items-center gap-1.5 flex-wrap" id="pool-filters">
            <button class="chip" data-f="status:past">past the pivot</button>
            <button class="chip" data-f="status:below">below</button>
            <button class="chip" data-f="status:fell">fell through</button>
            <button class="chip" data-f="grade:S">S</button>
            <button class="chip" data-f="grade:A+">A+</button>
            <button class="chip" data-f="kind:shelf">cheat entries</button>
          </div>
          <div id="pool-list" class="flex-1 min-h-0 overflow-y-auto text-sm"><div class="p-3 text-xs text-gray-500">Loading the pool…</div></div>
          <div class="dqc-pool-foot px-3 py-2 border-t border-gray-800 flex items-center gap-2 text-xs">
            <span id="sel-count" class="text-gray-400">0 selected</span>
            <button id="sel-clear" class="text-gray-500 hover:text-gray-300">clear</button>
            <button id="sel-compare" class="ml-auto px-2.5 py-1 rounded bg-blue-600/20 text-blue-200 ring-1 ring-blue-500/40 hover:bg-blue-600/30">Compare selected</button>
          </div>
        </aside>
        <main class="flex-1 min-w-0 min-h-0 flex flex-col">
          <div id="thread" class="flex-1 min-h-0 overflow-y-auto ${compact ? 'px-3 py-3 space-y-4' : 'px-4 sm:px-8 py-5 space-y-5'}">
            <div id="welcome" class="max-w-2xl mx-auto ${compact ? 'mt-2' : 'mt-6'}">
              <h1 class="${compact ? 'text-base' : 'text-xl'} font-semibold">Ask the screen about its recent breakouts.</h1>
              <p class="text-sm text-gray-400 mt-2">It reads the alert pool, each name's base X-ray and history, market health and sector strength. It reports what it sees and does not tell you what to buy.</p>
              <div class="mt-3 flex flex-wrap gap-2" id="suggestions"></div>
            </div>
          </div>
          <div class="flex-shrink-0 border-t border-gray-800 bg-gray-900 ${compact ? 'px-3 py-2' : 'px-4 sm:px-8 py-3'}">
            <div class="max-w-3xl mx-auto">
              <div class="flex items-end gap-2">
                <textarea id="input" rows="1" placeholder="Ask about the pool, or pick names and compare them…"
                  class="flex-1 resize-none bg-gray-800 text-gray-100 text-sm rounded-lg px-3 py-2.5 ring-1 ring-gray-700 focus:ring-blue-500 outline-none placeholder:text-gray-500"></textarea>
                <button id="send" class="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">Ask</button>
                <button id="stop" hidden class="px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm font-semibold" title="Stop the answer">Stop</button>
              </div>
              <div class="mt-1.5 text-[11px] text-gray-500 flex justify-between gap-2 flex-wrap">
                <span><span class="kbd">Enter</span> ask · <span class="kbd">Shift+Enter</span> newline · <button id="new-conv" class="underline decoration-dotted hover:text-gray-300">new conversation</button></span>
                <span>Screen output for research, not advice.</span>
              </div>
            </div>
          </div>
        </main>
      </div>`;
    const $ = (id) => root.querySelector('#' + id);

    const ui = {
      region: opts.region || 'us',
      days: 14,
      pool: [],
      filters: new Set(),
      selected: new Set(),
      history: [],   // [{role, content}] sent to the server
      busy: false,
      setRegion(v) { this.region = v; this.selected.clear(); this.loadPool(); },
      setDays(v) { this.days = parseInt(v, 10) || 14; this.loadPool(); },
      togglePool() { $('pool').classList.toggle(compact ? 'collapsed' : 'open'); },
      async loadPool() {
        const el = $('pool-list');
        try {
          const r = await fetch(`/api/chat/pool?days=${this.days}&region=${this.region}`);
          if (r.status === 401) { location.href = '/?ref=chat&next=' + encodeURIComponent(location.pathname); return; }
          if (r.status === 402) { location.href = '/upgrade'; return; }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const d = await r.json();
          this.pool = d.alerts || [];
          const s = d.summary || {};
          $('pool-summary').textContent = s.count ? `${s.count} · ${s.past} past · ${s.fell} fell` : '';
          this.renderPool();
        } catch (e) {
          el.innerHTML = '<div class="p-3 text-xs text-gray-500">The pool is not available right now.</div>';
        }
      },
      toggleFilter(btn) { const f = btn.dataset.f; if (this.filters.has(f)) this.filters.delete(f); else this.filters.add(f); btn.classList.toggle('on', this.filters.has(f)); this.renderPool(); },
      visible() {
        const fs = [...this.filters];
        const by = (prefix) => fs.filter((f) => f.startsWith(prefix + ':')).map((f) => f.slice(prefix.length + 1));
        const st = by('status'), gr = by('grade'), kd = by('kind');
        return this.pool.filter((a) =>
          (!st.length || st.includes(a.status)) &&
          (!gr.length || gr.includes(a.grade)) &&
          (!kd.length || (kd.includes('shelf') && a.kind && a.kind !== 'pivot')));
      },
      renderPool() {
        const el = $('pool-list');
        const rows = this.visible();
        const color = { past: '#34d399', fell: '#f87171', below: '#9ca3af' };
        // Names selected from outside the pool (a row, a chart) sit on top.
        const extra = [...this.selected].filter((a) => !this.pool.some((p) => p.asset === a));
        const extraHtml = extra.map((a) => `
          <label class="pool-row selected flex items-center gap-2.5 px-3 py-2 border-b border-gray-800/70 cursor-pointer hover:bg-gray-800/60">
            <input type="checkbox" checked data-asset="${esc(a)}" class="accent-blue-500">
            <span class="mono font-semibold w-16">${esc(a)}</span>
            <span class="text-[11px] text-gray-500">not in the pool · asked from the screener</span>
          </label>`).join('');
        if (!rows.length && !extra.length) { el.innerHTML = '<div class="p-3 text-xs text-gray-500">Nothing in the pool for this window and filter.</div>'; this.updateSel(); return; }
        el.innerHTML = extraHtml + rows.map((a) => `
          <label class="pool-row ${this.selected.has(a.asset) ? 'selected' : ''} flex items-center gap-2.5 px-3 py-2 border-b border-gray-800/70 cursor-pointer hover:bg-gray-800/60">
            <input type="checkbox" ${this.selected.has(a.asset) ? 'checked' : ''} data-asset="${esc(a.asset)}" class="accent-blue-500">
            <a href="/$${esc(a.asset)}" data-ticker="${esc(a.asset)}" class="mono font-semibold w-16 hover:text-blue-300" onclick="event.stopPropagation()">${esc(a.asset)}</a>
            <span class="text-[11px] text-gray-400 w-20">${a.grade ? esc(a.grade) : '—'}${a.kind && a.kind !== 'pivot' ? ' · ' + esc(a.kind.replace('-', ' ')) : ''}</span>
            <span class="mono text-xs ml-auto" style="color:${color[a.status] || '#9ca3af'}">${fmtPct(a.pct)}</span>
            <a href="/$${esc(a.asset)}" target="_blank" class="text-gray-600 hover:text-blue-300 text-xs" title="Open on the screener">↗</a>
          </label>`).join('');
        this.updateSel();
      },
      select(asset, on = true) { const a = String(asset || '').toUpperCase(); if (!a) return; if (on) this.selected.add(a); else this.selected.delete(a); this.renderPool(); if (compact && on) $('pool').classList.remove('collapsed'); },
      clearSelection() { this.selected.clear(); this.renderPool(); },
      updateSel() { $('sel-count').textContent = `${this.selected.size} selected`; },
      compareSelected() {
        if (!this.selected.size) { this.ask('Compare the names in the pool: grade, base length and depth, and where each stands versus its pivot.'); return; }
        this.ask('Compare the selected names: base grade, base length and depth, volume on the breakout, where each stands versus its pivot and fail level, and how each behaved on earlier breakouts. Which of them rests on the most evidence?');
        if (!compact && window.innerWidth <= 860) $('pool').classList.remove('open');
      },
      autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; },
      focus() { $('input')?.focus(); },
      ask(text) { const t = $('input'); t.value = text; this.send(); },
      // Known tickers (pool + selection) and $CASHTAGS in an answer open the
      // ticker: the drawer inside the dashboard, the screener page elsewhere.
      linkTickers(html) {
        const known = new Set([...this.pool.map((a) => a.asset), ...this.selected]);
        const re = /(^|[^\w$])(\$?)([A-Z][A-Z0-9.\-]{0,9})(?=$|[^\w])/g;
        // Only text between tags is touched, so attributes and tag names stay intact.
        return html.split(/(<[^>]+>)/).map((seg) => seg.startsWith('<') ? seg : seg.replace(re, (m, pre, dollar, t) => {
          if (!dollar && !known.has(t)) return m;
          return `${pre}<a href="/$${t}" data-ticker="${t}" class="text-blue-300 hover:text-blue-200 underline decoration-dotted">${dollar}${t}</a>`;
        })).join('');
      },
      render(text) { return this.linkTickers(md(text)); },
      placeholder() {
        const t = $('input'); if (!t) return;
        const sel = [...this.selected];
        t.placeholder = sel.length ? `Ask about ${sel.slice(0, 3).join(', ')}${sel.length > 3 ? ` and ${sel.length - 3} more` : ''}…` : 'Ask about the pool, or pick names and compare them…';
      },
      followUps() {
        const sel = [...this.selected];
        const qs = sel.length
          ? [`Which of ${sel.length > 1 ? 'these' : 'its bases'} is closest to the pivot right now?`, `How did ${sel[0]} behave on its earlier breakouts?`, 'Is the tape supportive for these this week?']
          : ['Which of these rests on the most evidence?', 'Which names are within 5% of the pivot?', 'What does the base X-ray say about the best one?'];
        const wrap = document.createElement('div');
        wrap.className = 'max-w-3xl mx-auto flex flex-wrap gap-2 follow-ups';
        wrap.innerHTML = qs.map((q) => `<button class="chip hover:text-white" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
        wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) { wrap.remove(); ui.ask(b.dataset.ask); } });
        $('thread').appendChild(wrap);
      },
      persist() {
        try { sessionStorage.setItem(STORE_KEY(this.region), JSON.stringify({ history: this.history.slice(-24), selected: [...this.selected] })); } catch {}
      },
      restore() {
        let saved = null;
        try { saved = JSON.parse(sessionStorage.getItem(STORE_KEY(this.region)) || 'null'); } catch {}
        if (!saved || !Array.isArray(saved.history) || !saved.history.length) return false;
        this.history = saved.history;
        (saved.selected || []).forEach((a) => this.selected.add(a));
        $('welcome')?.remove();
        for (const m of this.history) {
          if (m.role === 'user') this.bubble('user', esc(m.content.replace(/^Selected: [^\n]*\n\n/, '')));
          else this.bubble('assistant', this.render(m.content));
        }
        this.scroll();
        return true;
      },
      newConversation() {
        this.history = [];
        try { sessionStorage.removeItem(STORE_KEY(this.region)); } catch {}
        const th = $('thread');
        th.innerHTML = '';
        th.appendChild(welcomeEl());
        wireSuggestions();
      },
      // POST with one retry after a session refresh: an expired Clerk cookie
      // answers 401 even though the user is signed in.
      // What the host has on screen (the open chart, the reader's own lines).
      // The standalone page has none; the dashboard panel supplies it.
      onScreen() {
        if (typeof opts.context !== 'function') return null;
        try { return opts.context() || null; } catch { return null; }
      },
      async post(body, signal) {
        const req = (retry) => fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(retry ? { 'X-Auth-Retry': '1' } : {}) }, body: JSON.stringify(body), signal });
        let r = await req(false);
        if (r.status === 401 && opts.refreshAuth) {
          try { await opts.refreshAuth(); r = await req(true); } catch {}
        }
        return r;
      },
      bubble(role, html, extraCls = '') {
        const wrap = document.createElement('div');
        wrap.className = 'max-w-3xl mx-auto ' + (role === 'user' ? 'flex justify-end' : '');
        wrap.innerHTML = role === 'user'
          ? `<div class="msg bg-blue-600/20 ring-1 ring-blue-500/30 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap">${html}</div>`
          : `<div class="msg text-sm leading-relaxed ${extraCls}">${html}</div>`;
        $('thread').appendChild(wrap);
        return wrap.firstElementChild;
      },
      scroll() { const t = $('thread'); t.scrollTop = t.scrollHeight; },
      async send() {
        if (this.busy) return;
        const t = $('input');
        const q = t.value.trim();
        if (!q) return;
        t.value = ''; this.autosize(t);
        $('welcome')?.remove();
        const sel = [...this.selected];
        const content = sel.length ? `Selected: ${sel.join(', ')}.\n\n${q}` : q;
        root.querySelectorAll('.follow-ups').forEach((el) => el.remove());
        this.bubble('user', esc(sel.length ? `${q}\n\n(${sel.join(', ')})` : q));
        this.history.push({ role: 'user', content });
        this.persist();
        this.busy = true; $('send').disabled = true; $('stop').hidden = false;
        const tools = document.createElement('div'); tools.className = 'max-w-3xl mx-auto space-y-0.5';
        tools.innerHTML = '<div class="tool" data-status>thinking…</div>';
        $('thread').appendChild(tools);
        const out = this.bubble('assistant', '', 'typing');
        let text = '';
        this.scroll();
        const ac = new AbortController();
        this._abort = ac;
        try {
          const r = await this.post({ messages: this.history, region: this.region, context: this.onScreen() }, ac.signal);
          if (r.status === 401) { location.href = '/?ref=chat&next=' + encodeURIComponent(location.pathname); return; }
          if (r.status === 402) { location.href = '/upgrade'; return; }
          if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'HTTP ' + r.status); }
          const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
              const ev = (chunk.match(/^event: (.*)$/m) || [])[1];
              const dataLine = (chunk.match(/^data: (.*)$/m) || [])[1];
              if (!ev || !dataLine) continue;
              const data = JSON.parse(dataLine);
              if (ev === 'text') { tools.querySelector('[data-status]')?.remove(); text += data.delta; out.innerHTML = this.render(text); this.scroll(); }
              else if (ev === 'tool') { tools.querySelector('[data-status]')?.remove(); const sym = data.input && (data.input.symbol || ''); tools.insertAdjacentHTML('beforeend', `<div class="tool">${esc(TOOL_WORDS[data.name] || data.name)}${sym ? ' · ' + esc(String(sym).toUpperCase()) : ''}</div>`); this.scroll(); }
              else if (ev === 'error') { tools.querySelector('[data-status]')?.remove(); text += (text ? '\n\n' : '') + data.message; out.innerHTML = this.render(text); }
            }
          }
          if (!text.trim()) { text = 'No answer came back. Ask again.'; out.innerHTML = this.render(text); }
          this.history.push({ role: 'assistant', content: text });
          this.persist();
          out.insertAdjacentHTML('beforeend', `<div class="mt-1.5 text-[10px] text-gray-600 flex gap-3"><span>${timeHHMM()}</span><button class="hover:text-gray-300" data-copy>copy</button></div>`);
          out.querySelector('[data-copy]')?.addEventListener('click', () => { try { navigator.clipboard.writeText(text); } catch {} });
          this.followUps();
        } catch (e) {
          tools.querySelector('[data-status]')?.remove();
          const msg = e.name === 'AbortError' ? 'Stopped.' : (e.message || 'The answer did not come through.');
          out.innerHTML = this.render(text + (text ? '\n\n' : '') + msg);
          if (text.trim()) { this.history.push({ role: 'assistant', content: text }); this.persist(); }
          else this.history.pop(); // the question went nowhere; let them ask again
        } finally {
          out.classList.remove('typing');
          this.busy = false; $('send').disabled = false; $('stop').hidden = true; this._abort = null;
          this.scroll();
        }
      },
      stop() { this._abort?.abort(); },
    };

    // Wiring (no inline handlers, so the widget works wherever it is mounted).
    const welcomeHtml = $('welcome').outerHTML;
    const welcomeEl = () => { const d = document.createElement('div'); d.innerHTML = welcomeHtml; return d.firstElementChild; };
    const wireSuggestions = () => {
      const sg = $('suggestions'); if (!sg) return;
      sg.innerHTML = SUGGESTIONS.map((s) => `<button class="chip hover:text-white" data-ask="${esc(s)}">${esc(s)}</button>`).join('');
      sg.addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) ui.ask(b.dataset.ask); });
    };
    wireSuggestions();
    $('new-conv').addEventListener('click', () => ui.newConversation());
    $('stop').addEventListener('click', () => ui.stop());
    // A ticker in an answer or the pool: the drawer inside the dashboard, the
    // screener page elsewhere.
    root.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-ticker]');
      if (!a) return;
      if (opts.onOpenTicker) { e.preventDefault(); opts.onOpenTicker(a.dataset.ticker); }
    });
    $('pool-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) ui.toggleFilter(b); });
    $('pool-list').addEventListener('change', (e) => { const cb = e.target; if (cb && cb.dataset && cb.dataset.asset) ui.select(cb.dataset.asset, cb.checked); });
    $('days').addEventListener('change', (e) => ui.setDays(e.target.value));
    $('sel-clear').addEventListener('click', () => ui.clearSelection());
    $('sel-compare').addEventListener('click', () => ui.compareSelected());
    $('send').addEventListener('click', () => ui.send());
    $('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ui.send(); }
      else if (e.key === 'Escape') { e.stopPropagation(); e.target.blur(); if (opts.onEscape) opts.onEscape(); }
    });
    $('input').addEventListener('input', (e) => ui.autosize(e.target));
    const origRender = ui.renderPool.bind(ui);
    ui.renderPool = function () { origRender(); this.placeholder(); };
    ui.restore();
    ui.loadPool();
    if (opts.clerkKey) loadClerk(opts.clerkKey).catch(() => {}); // keep the session cookie fresh
    return ui;
  }

  window.DQChat = { mount, md, loadClerk, refreshSession };
})();
