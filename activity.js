// Following First — "Your activity" → Interactions as a big borderless grid,
// "Saved" first (our own Pinterest-like grid with collections), "Saved" in the
// left nav, and tile actions: send (opens the post's Share dialog), unlike (in
// place, through Instagram's own Select mode) and unsave (in a background tab,
// the tile just greys out). Strings: igxT() from i18n.js (same content-script world).
(() => {
  const T = globalThis.igxT;
  const ACT_RE = /^\/your_activity\/interactions(\/|$)/;
  const LIKES_URL = '/your_activity/interactions/likes/';
  const SAVED_HASH = '#igx-saved';
  const PENDING = 'igxPostAction'; // sessionStorage: { action, ts } — "send" from a tile
  const JOB_KEY = 'igxJob_';       // chrome.storage.local: background-tab job results
  const COLL_KEY = 'igxCollections'; // chrome.storage.local: { ts, user, items: [{ id, name }] }
  const APP_ID = '936619743392459';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const store = chrome.storage.local;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 8000, step = 150) {
    for (let t = 0; t < ms; t += step) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }
  // Filled glyph (tile buttons): { d, fill } — no stroke.
  function solid(d, size, fill) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', fill || 'currentColor');
    s.append(p);
    return s;
  }
  function icon(paths, size = 18) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    for (const d of paths) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
    return s;
  }
  const P_BOOKMARK = ['M20 21 12 13.44 4 21V3h16z'];
  const P_BOOKMARK_FILLED = 'M20 22a.999.999 0 0 1-.687-.273L12 14.815l-7.313 6.912A1 1 0 0 1 3 21V3a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1Z';
  const P_SEND = ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4z'];
  // Tile buttons show the current state (liked / saved); a click removes it.
  const G_HEART = 'M12 21.2s-7.6-4.6-9.6-9.2C.9 8.5 3 4.6 6.9 4.6c2.2 0 3.7 1.2 5.1 3 1.4-1.8 2.9-3 5.1-3 3.9 0 6 3.9 4.5 7.4-2 4.6-9.6 9.2-9.6 9.2Z';
  const IG_RED = '#ff3040';
  const P_COLLECTIONS = ['M4 6h12', 'M4 11h12', 'M4 16h7', 'M18 13v8', 'M14 17h8'];

  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById('igx-toast');
    if (!t) { t = el('div'); t.id = 'igx-toast'; document.body.append(t); }
    t.textContent = text;
    t.classList.add('igx-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('igx-show'), 3000);
  }
  // Grey veil over a tile: "Removing…" → "Removed" (or gone on failure).
  function veil(host, text) {
    if (!host) return null;
    let v = host.querySelector(':scope > .igx-veil');
    if (!v) { v = el('div', 'igx-veil'); host.append(v); }
    v.textContent = text;
    return v;
  }
  const rgb = (e) => (getComputedStyle(e).color.match(/\d+/g) || []).map(Number);
  const isRed = (e) => { const [r, g, b] = rgb(e); return r > 200 && g < 110 && b < 130; };
  const isBlue = (e) => { const [r, g, b] = rgb(e); return r < 80 && g > 100 && b > 200; };

  // ---------- post page: Instagram's own action buttons ----------
  const isPostPage = () => /^\/(?:[^/]+\/)?(p|reel)\/[^/]+/.test(location.pathname);
  function postButtons() {
    // Share = paper plane, path "M13.973 20.046…" (any language).
    const share = [...document.querySelectorAll('main svg path')].find((p) => (p.getAttribute('d') || '').startsWith('M13.973 20.046'));
    const shareBtn = share && share.closest('[role="button"], button');
    if (!shareBtn) return null;
    let bar = shareBtn.parentElement;
    while (bar && bar.querySelectorAll('[role="button"], button').length < 3) bar = bar.parentElement;
    const buttons = bar ? [...bar.querySelectorAll('[role="button"], button')].filter((b) => b.querySelector('svg')) : [];
    // Filled bookmark = saved; it sits apart from the like/comment/share row.
    const mark = [...document.querySelectorAll('main svg path')].find((x) => (x.getAttribute('d') || '').startsWith('M20 22a.999'));
    return { shareBtn, like: buttons[0] || null, savedBtn: mark ? mark.closest('[role="button"], button') : null };
  }

  // "Send" from a tile: open the post, then press Share there.
  const setPending = (action) => { try { sessionStorage.setItem(PENDING, JSON.stringify({ action, ts: Date.now() })); } catch (e) { /* ignore */ } };
  let pendingBusy = false;
  async function runPending() {
    if (pendingBusy || !isPostPage()) return;
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch (e) { /* ignore */ }
    if (!p || Date.now() - p.ts > 20000) return;
    pendingBusy = true;
    try {
      const b = await waitFor(postButtons, 10000, 250);
      try { sessionStorage.removeItem(PENDING); } catch (e) { /* ignore */ }
      if (!b) { toast(T('actionFailed')); return; }
      if (p.action === 'send') b.shareBtn.click();
    } finally {
      pendingBusy = false;
    }
  }

  // ---------- background-tab jobs ----------
  // The page opens /p/CODE/#igx-job=ID&a=unsave (or /USER/saved/#…&a=collections)
  // in an inactive tab (background.js), the tab does the job with Instagram's own
  // buttons, writes igxJob_ID to storage and closes itself.
  const jobWaiters = new Map(); // id -> resolve
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    for (const k of Object.keys(ch)) {
      if (!k.startsWith(JOB_KEY) || !ch[k].newValue) continue;
      const done = jobWaiters.get(k.slice(JOB_KEY.length));
      if (done) { done(ch[k].newValue); store.remove(k); }
    }
  });
  function startJob(path, action) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { jobWaiters.delete(id); resolve({ ok: false }); }, 30000);
      jobWaiters.set(id, (r) => { clearTimeout(timer); jobWaiters.delete(id); resolve(r); });
      chrome.runtime.sendMessage({ type: 'bg-open', url: path + '#igx-job=' + id + '&a=' + action }, (r) => {
        if (chrome.runtime.lastError || !r || !r.ok) { clearTimeout(timer); jobWaiters.delete(id); resolve({ ok: false }); }
      });
    });
  }
  let jobStarted = false;
  async function runJob() {
    const m = location.hash.match(/^#igx-job=([a-z0-9]+)&a=(\w+)/);
    if (!m || jobStarted) return;
    jobStarted = true;
    const [, id, action] = m;
    let result = { ok: false };
    try {
      if (action === 'unsave') {
        const b = await waitFor(() => { const x = postButtons(); return x && (x.savedBtn || x.like) ? x : null; }, 15000, 250);
        if (b && b.savedBtn) {
          b.savedBtn.click();
          // Saved state is gone when the filled bookmark is gone.
          result = { ok: !!(await waitFor(() => !(postButtons() || {}).savedBtn, 5000)) };
        } else if (b) result = { ok: true, already: true };
      }
      if (action === 'collections') result = { ok: !!(await harvestCollections(25000, true)) };
    } catch (e) { /* result stays failed */ }
    await store.set({ [JOB_KEY + id]: result });
    chrome.runtime.sendMessage({ type: 'bg-close' });
  }

  // ---------- collections (names come only from the native /USER/saved/ page) ----------
  let collections = null; // { ts, user, items }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch[COLL_KEY]) { collections = ch[COLL_KEY].newValue || null; renderCollections(); }
  });
  function myUsername() {
    // The profile item in the left nav: a single-segment link that is not a known route.
    const known = new Set(['', 'reels', 'explore', 'direct', 'accounts', 'your_activity']);
    for (const a of document.querySelectorAll('nav a[href], div a[href]')) {
      const r = a.getBoundingClientRect();
      if (r.width > 0 && r.left < 90 && a.querySelector('img')) {
        const m = (a.getAttribute('href') || '').match(/^\/([\w.]+)\/$/);
        if (m && !known.has(m[1])) return m[1];
      }
    }
    return null;
  }
  function readCollectionLinks() {
    const items = [];
    for (const a of document.querySelectorAll('main a[href*="/saved/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([\w.]+)\/saved\/[^/]+\/(\d+)\/$/);
      if (m) items.push({ id: m[2], name: a.textContent.trim(), user: m[1] });
    }
    return items;
  }
  async function harvestCollections(ms, background) {
    const items = await waitFor(() => { const x = readCollectionLinks(); return x.length ? x : null; }, ms, 300);
    const user = (location.pathname.match(/^\/([\w.]+)\/saved/) || [])[1];
    if (!user) return false;
    // In a background tab the page may simply not have rendered yet — never
    // cache "no collections" from there; on a page the user looks at, it's real.
    if (!items && background) return false;
    await store.set({ [COLL_KEY]: { ts: Date.now(), user, items: (items || []).map(({ id, name }) => ({ id, name })) } });
    return true;
  }
  // Visiting the native saved page refreshes the cache for free.
  let harvestedHere = '';
  function maybeHarvestHere() {
    if (!/^\/[\w.]+\/saved\/?$/.test(location.pathname) || harvestedHere === location.pathname) return;
    harvestedHere = location.pathname;
    harvestCollections(8000);
  }
  let collJob = false;
  function ensureCollections() {
    if (collJob || (collections && collections.items.length && Date.now() - collections.ts < 24 * 3600e3)) return;
    // One background attempt per browser session (it briefly shows a tab).
    try { if (sessionStorage.getItem('igxCollJob')) return; sessionStorage.setItem('igxCollJob', '1'); } catch (e) { /* ignore */ }
    const user = myUsername();
    if (!user) return;
    collJob = true;
    startJob('/' + user + '/saved/', 'collections').finally(() => { collJob = false; });
  }

  // ---------- activity page layout ----------
  const onActivity = () => ACT_RE.test(location.pathname);
  const savedMode = () => onActivity() && location.hash === SAVED_HASH;

  function tweakActivity() {
    const on = onActivity();
    document.documentElement.toggleAttribute('data-igx-act', on);
    document.documentElement.toggleAttribute('data-igx-saved', on && savedMode());
    if (!on) return;
    const tabs = document.querySelector('main [role="tablist"]');
    const article = tabs && tabs.closest('article');
    if (!article || !article.parentElement) return;
    const box = article.parentElement;
    if (!box.hasAttribute('data-igx-actbox')) box.setAttribute('data-igx-actbox', '');
    if (!article.hasAttribute('data-igx-actmain')) article.setAttribute('data-igx-actmain', '');
    // The "Your activity" sidebar (Interactions / Photos and videos / Account history).
    for (const c of box.children) if (c !== article && !c.hasAttribute('data-igx-actside')) c.setAttribute('data-igx-actside', '');
    if (!tabs.hasAttribute('data-igx-acttabs')) tabs.setAttribute('data-igx-acttabs', '');
    for (const t of tabs.children) {
      if (/\/reviews\/?$/.test(t.getAttribute('href') || '') && !t.hasAttribute('data-igx-hidden')) t.setAttribute('data-igx-hidden', '');
    }
    // Native content next to the tabs (likes grid etc.) — hidden in saved mode.
    for (const c of tabs.parentElement.children) {
      if (c !== tabs && !c.classList.contains('igx-saved') && !c.hasAttribute('data-igx-actpanel')) c.setAttribute('data-igx-actpanel', '');
    }
    ensureSavedChip(tabs);
    if (savedMode()) ensureSavedView(tabs);
    else if (saved.el) saved.el.hidden = true;
    decorateLikeTiles();
  }

  function ensureSavedChip(tabs) {
    let chip = tabs.querySelector('.igx-savedchip');
    if (!chip) {
      chip = el('a', 'igx-savedchip');
      chip.href = LIKES_URL + SAVED_HASH;
      chip.append(icon(P_BOOKMARK, 16), el('span', null, T('saved')));
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        openSaved();
      });
    }
    if (tabs.firstElementChild !== chip) tabs.prepend(chip); // Saved first, then Likes…
    chip.classList.toggle('igx-on', savedMode());
  }
  function openSaved() {
    if (!ACT_RE.test(location.pathname)) { location.href = LIKES_URL + SAVED_HASH; return; }
    history.replaceState(history.state, '', location.pathname + location.search + SAVED_HASH);
    schedule();
  }

  // Leaving saved mode: a native chip of the current page doesn't navigate.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-igx-acttabs] a[role="tab"]');
    if (a && location.hash === SAVED_HASH) {
      history.replaceState(history.state, '', location.pathname + location.search);
      schedule();
    }
  }, true);

  // ---------- saved: collections row + masonry grid ----------
  const saved = {
    el: null, colls: null, cols: [], note: null,
    coll: 'all',           // 'all' or a collection id
    items: [], next: null, more: true, loading: false, failed: false, loadedAt: 0, gen: 0,
    removed: new Set(),    // codes removed in this session (stay greyed)
    covers: new Map(),     // collection id -> thumbnail url
  };

  const mediaOf = (m) => (m.carousel_media && m.carousel_media[0]) || m;
  function thumbOf(m) {
    const src = (m.image_versions2 && m.image_versions2.candidates) || (mediaOf(m).image_versions2 || {}).candidates || [];
    const ok = src.filter((c) => c.width >= 480).sort((a, b) => a.width - b.width);
    return (ok[0] || src[0] || {}).url || '';
  }
  function ratioOf(m) {
    const x = mediaOf(m);
    const w = x.original_width || m.original_width;
    const h = x.original_height || m.original_height;
    return w && h ? Math.min(Math.max(h / w, 0.5), 1.9) : 1; // height / width, clamped
  }

  function savedUrl() {
    const base = saved.coll === 'all' ? '/api/v1/feed/saved/posts/' : '/api/v1/feed/collection/' + saved.coll + '/posts/';
    return base + (saved.next ? '?max_id=' + encodeURIComponent(saved.next) : '');
  }
  async function apiGet(url) {
    const r = await fetch(url, { credentials: 'include', headers: { 'x-ig-app-id': APP_ID, 'x-requested-with': 'XMLHttpRequest' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function loadSaved(reset) {
    if (reset) {
      saved.gen++;
      saved.items = []; saved.next = null; saved.more = true; saved.loading = false;
      for (const c of saved.cols) { c.replaceChildren(); c._h = 0; }
    }
    if (saved.loading || !saved.more) return;
    const gen = saved.gen;
    saved.loading = true;
    saved.failed = false;
    renderSavedNote();
    try {
      const j = await apiGet(savedUrl());
      if (gen !== saved.gen) return;
      const fresh = (j.items || []).map((it) => it.media).filter((m) => m && m.code);
      saved.items.push(...fresh);
      saved.next = j.next_max_id || null;
      saved.more = !!(j.more_available && saved.next);
      saved.loadedAt = Date.now();
      appendTiles(fresh);
    } catch (e) {
      if (gen === saved.gen) saved.failed = true;
    } finally {
      if (gen === saved.gen) { saved.loading = false; renderSavedNote(); }
    }
  }

  function ensureSavedView(tabs) {
    if (!saved.el) {
      saved.el = el('div', 'igx-saved');
      saved.colls = el('div', 'igx-colls');
      const grid = el('div', 'igx-masonry');
      saved.cols = [0, 1, 2, 3].map(() => { const c = el('div', 'igx-mcol'); c._h = 0; grid.append(c); return c; });
      saved.note = el('div', 'igx-snote');
      saved.el.append(saved.colls, grid, saved.note);
      saved.el.addEventListener('scroll', () => {
        const s = saved.el;
        if (s.scrollTop + s.clientHeight > s.scrollHeight - 800) loadSaved(false);
      });
    }
    saved.el.hidden = false;
    if (saved.el.previousElementSibling !== tabs) tabs.after(saved.el);
    ensureCollections();
    renderCollections();
    // Fresh list each time saved mode is opened.
    if (!saved.loading && Date.now() - saved.loadedAt > 15000) loadSaved(true);
  }

  function collName(id) {
    const c = collections && collections.items.find((x) => x.id === String(id));
    return c ? c.name : null;
  }
  function renderCollections() {
    if (!saved.colls) return;
    const items = (collections && collections.items) || [];
    const allCover = saved.coll === 'all' && saved.items[0] ? thumbOf(saved.items[0]) : saved.allCover || null;
    if (allCover) saved.allCover = allCover;
    const key = JSON.stringify([saved.coll, items, [...saved.covers], allCover]);
    if (saved.colls.dataset.key === key) return;
    saved.colls.dataset.key = key;
    saved.colls.hidden = !items.length;
    const block = (id, name, cover) => {
      const b = el('button', 'igx-coll' + (saved.coll === id ? ' igx-on' : ''));
      b.type = 'button';
      const pic = el('span', 'igx-coll-pic');
      if (cover) { const i = el('img'); i.src = cover; i.alt = ''; pic.append(i); } else pic.append(icon(P_BOOKMARK, 22));
      b.append(pic, el('span', 'igx-coll-name', name));
      b.addEventListener('click', () => {
        if (saved.coll === id) return;
        saved.coll = id;
        saved.el.scrollTop = 0;
        renderCollections();
        loadSaved(true);
      });
      return b;
    };
    saved.colls.replaceChildren(
      block('all', T('allPosts'), allCover),
      ...items.map((c) => block(c.id, c.name, saved.covers.get(c.id))),
    );
    // Covers: first post of each collection (one small request each, once).
    for (const c of items) {
      if (saved.covers.has(c.id)) continue;
      saved.covers.set(c.id, null);
      apiGet('/api/v1/feed/collection/' + c.id + '/posts/')
        .then((j) => { const m = j.items && j.items[0] && j.items[0].media; if (m) { saved.covers.set(c.id, thumbOf(m)); renderCollections(); } })
        .catch(() => {});
    }
  }

  // Masonry: each post keeps its own proportions; a new tile goes to the
  // shortest column, so appending a page never reshuffles what's already there.
  function appendTiles(list) {
    for (const m of list) {
      const col = saved.cols.reduce((a, b) => (b._h < a._h ? b : a));
      const r = ratioOf(m);
      col.append(savedTile(m, r));
      col._h += r;
    }
    renderCollections();
  }

  function savedTile(m, ratio) {
    const a = el('a', 'igx-stile');
    a.href = '/p/' + m.code + '/';
    a.style.aspectRatio = '1 / ' + ratio.toFixed(3);
    const img = el('img');
    img.src = thumbOf(m);
    img.alt = '';
    img.decoding = 'async'; // no loading=lazy: inside our own scroller it sometimes never fires
    a.append(img);
    if (m.media_type === 8 || m.media_type === 2) a.append(el('span', 'igx-sbadge', m.media_type === 8 ? '❐' : '▶'));
    // Which collection(s) the post is in (in "All posts").
    setCollBadge(a, m);
    a.append(tileActions([
      ['send', () => icon(P_SEND, 18), T('send'), () => { setPending('send'); location.href = '/p/' + m.code + '/'; }],
      ...(collections && collections.items.length ? [['colls', () => icon(P_COLLECTIONS, 19), T('collections'), (btn) => openCollPop(m, a, btn)]] : []),
      ['unsave', () => solid(P_BOOKMARK_FILLED, 18), T('unsave'), () => unsave(m, a)],
    ]));
    if (saved.removed.has(m.code)) veil(a, T('unsaved'));
    return a;
  }

  function setCollBadge(tile, m) {
    tile.querySelector(':scope > .igx-scoll')?.remove();
    const names = (m.saved_collection_ids || []).map(collName).filter(Boolean);
    if (names.length && saved.coll === 'all') tile.append(el('span', 'igx-scoll', names.join(' · ')));
  }

  // ---------- "Collections" popover: tick the collections a post belongs to ----------
  // Changes go through Instagram's collection edit endpoint (added_media_ids /
  // removed_media_ids). No ticks at all = remove the post from saved.
  let collPop = null;
  function closeCollPop() { if (collPop) { collPop.remove(); collPop = null; } }
  document.addEventListener('mousedown', (e) => { if (collPop && !collPop.contains(e.target) && !(e.target.closest && e.target.closest('.igx-t-colls'))) closeCollPop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCollPop(); }, true);

  function openCollPop(m, tile, btn) {
    if (collPop && collPop.dataset.code === m.code) { closeCollPop(); return; }
    closeCollPop();
    const current = new Set((m.saved_collection_ids || []).map(String));
    const pop = el('div', 'igx-cpop');
    pop.dataset.code = m.code;
    pop.append(el('div', 'igx-cpop-title', T('collections')));
    const list = el('div', 'igx-cpop-list');
    const boxes = [];
    const done = el('button', 'igx-cpop-done', T('done'));
    done.type = 'button';
    // No collection ticked → "Done" is inactive; removing is its own button below.
    const sync = () => { done.disabled = !boxes.some((x) => x.checked); };
    for (const c of collections.items) {
      const row = el('label', 'igx-cpop-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = current.has(c.id);
      cb.value = c.id;
      cb.addEventListener('change', sync);
      boxes.push(cb);
      row.append(cb, el('span', null, c.name));
      list.append(row);
    }
    sync();
    done.addEventListener('click', () => {
      const next = new Set(boxes.filter((x) => x.checked).map((x) => x.value));
      if (!next.size) return;
      closeCollPop();
      applyCollections(m, tile, current, next);
    });
    const remove = el('button', 'igx-cpop-remove', T('unsave'));
    remove.type = 'button';
    remove.addEventListener('click', () => { closeCollPop(); unsave(m, tile); });
    pop.append(list, done, el('div', 'igx-cpop-sep'), remove);
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const w = 240;
    pop.style.left = Math.round(Math.min(Math.max(8, r.left), innerWidth - w - 8)) + 'px';
    const h = pop.offsetHeight;
    const below = r.bottom + 8;
    const top = below + h > innerHeight - 8 ? r.top - h - 8 : below;
    pop.style.top = Math.round(Math.min(Math.max(8, top), innerHeight - h - 8)) + 'px';
    collPop = pop;
  }

  async function collEdit(collectionId, field, pk) {
    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
    const body = new URLSearchParams({ [field]: JSON.stringify([pk]), module_name: 'feed_saved_collections' });
    const r = await fetch('/api/v1/collections/' + collectionId + '/edit/', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-ig-app-id': APP_ID, 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': csrf, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.status !== 'ok') throw new Error('collections edit ' + r.status);
  }

  async function applyCollections(m, tile, before, after) {
    const add = [...after].filter((id) => !before.has(id));
    const remove = [...before].filter((id) => !after.has(id));
    if (!add.length && !remove.length) return;
    veil(tile, T('savingColls'));
    const pk = String(m.pk || String(m.id).split('_')[0]);
    try {
      for (const id of add) await collEdit(id, 'added_media_ids', pk);
      for (const id of remove) await collEdit(id, 'removed_media_ids', pk);
      m.saved_collection_ids = [...after];
      tile.querySelector('.igx-veil')?.remove();
      setCollBadge(tile, m);
      // Viewing a collection the post just left: grey it out.
      if (saved.coll !== 'all' && !after.has(saved.coll)) veil(tile, T('movedOut'));
      toast(T('collectionsSaved'));
    } catch (e) {
      tile.querySelector('.igx-veil')?.remove();
      toast(T('collectionsFailed'));
    }
  }

  async function unsave(m, tile) {
    if (saved.removed.has(m.code)) return;
    saved.removed.add(m.code);
    tile.classList.add('igx-busy');
    veil(tile, T('removing'));
    const r = await startJob('/p/' + m.code + '/', 'unsave');
    tile.classList.remove('igx-busy');
    if (r.ok) veil(tile, T('unsaved'));
    else {
      saved.removed.delete(m.code);
      tile.querySelector('.igx-veil')?.remove();
      toast(T('actionFailed'));
    }
  }

  function renderSavedNote() {
    if (!saved.note) return;
    saved.note.textContent = saved.loading ? T('loadingSaved')
      : saved.failed ? T('savedFailed')
      : !saved.items.length ? T('noSaved') : '';
  }

  // ---------- buttons on tiles ----------
  function tileActions(list) {
    const box = el('div', 'igx-tactions');
    for (const [kind, glyph, title, run] of list) {
      const b = el('button', 'igx-tbtn igx-t-' + kind);
      b.type = 'button';
      b.title = title;
      b.append(glyph());
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(b); });
      box.append(b);
    }
    return box;
  }

  // Instagram's likes grid = list of rows of 3 tiles. Mark the list; CSS turns
  // it into a 4-column grid (rows and their wrappers become display: contents).
  function markLikesList() {
    if (document.querySelector('[data-igx-likelist]')) return;
    const tile = likeTiles()[0];
    let row = tile;
    while (row && !(row.children.length >= 2 && [...row.children].every((c) => c.querySelector('[role="button"][aria-label*="@"]')))) row = row.parentElement;
    const list = row && row.parentElement && row.parentElement.parentElement;
    if (list && list.closest('[data-igx-actpanel]')) list.setAttribute('data-igx-likelist', '');
  }
  const likeTiles = () => [...document.querySelectorAll('main [data-igx-actpanel] [role="button"][aria-label*="@"]')];
  function decorateLikeTiles() {
    if (!/\/likes\/?$/.test(location.pathname) || savedMode()) return;
    markLikesList();
    for (const tile of likeTiles()) {
      const host = tile.parentElement;
      if (!host || host.querySelector(':scope > .igx-tactions')) continue;
      host.classList.add('igx-ltile');
      host.append(tileActions([
        ['send', () => icon(P_SEND, 18), T('send'), () => { setPending('send'); tile.click(); }],
        ['unlike', () => solid(G_HEART, 19, IG_RED), T('unlike'), () => unlikeInPlace(tile.getAttribute('aria-label'))],
      ]));
    }
  }

  // Unlike without leaving the page: Instagram's own Select mode —
  // "Select" (blue, above the grid) → tick this tile → red "Unlike" → confirm.
  // Found by colour and position, not by text, so it works in any language.
  const leaves = (root) => [...root.querySelectorAll('*')].filter((e) => !e.children.length && e.textContent.trim() && e.getBoundingClientRect().height > 0);
  let unliking = false;
  async function unlikeInPlace(label) {
    if (unliking) return;
    const panel = document.querySelector('main [data-igx-actpanel]');
    const box = document.querySelector('[data-igx-actbox]');
    const findTile = () => likeTiles().find((t) => t.getAttribute('aria-label') === label);
    const tile = findTile();
    if (!panel || !box || !tile) return;
    unliking = true;
    document.documentElement.setAttribute('data-igx-unliking', '');
    veil(tile.parentElement, T('removing'));
    let ok = false;
    let entered = false;
    const selectToggle = (top) => leaves(panel).find((e) => isBlue(e) && e.getBoundingClientRect().bottom <= top);
    const top = tile.getBoundingClientRect().top;
    try {
      const toggle = selectToggle(top);
      if (!toggle) throw new Error('no select');
      toggle.click();
      entered = true;
      const t2 = await waitFor(findTile, 2000);
      if (!t2) throw new Error('tile gone');
      t2.click(); // tick
      const unlikeBtn = await waitFor(() => leaves(box).find((e) => isRed(e) && !e.closest('[aria-label*="@"]')), 3000);
      if (!unlikeBtn) throw new Error('no unlike');
      unlikeBtn.click();
      // Optional confirmation dialog: press its red button.
      const confirm = await waitFor(() => { const d = document.querySelector('div[role="dialog"]'); return d && leaves(d).find(isRed); }, 2000);
      if (confirm) confirm.click();
      ok = true;
    } catch (e) {
      // Leave Select mode if we entered it (the same blue link now says "Cancel").
      if (entered) selectToggle(top + 1)?.click();
    } finally {
      document.documentElement.removeAttribute('data-igx-unliking');
      unliking = false;
    }
    const host = findTile()?.parentElement;
    if (ok) { if (host) veil(host, T('unliked')); toast(T('unliked')); }
    else { host?.querySelector('.igx-veil')?.remove(); toast(T('actionFailed')); }
  }

  // ---------- "Saved" in the left nav ----------
  function ensureNavItem() {
    const search = document.querySelector('a[href="/explore/"]:not(.igx-navsaved a)');
    if (!search) return;
    // Item = the ancestor that is a direct child of the nav column.
    let item = search;
    while (item.parentElement && item.parentElement.children.length < 4) item = item.parentElement;
    if (!item.parentElement || item === document.body) return;
    // Instagram renders labels only while the nav is expanded (hover): rebuild
    // the copy whenever the native item's shape changes, so it gets the label
    // and the same wide hover highlight.
    const sig = item.querySelectorAll('span').length + ':' + Math.round(item.getBoundingClientRect().width);
    let clone = document.querySelector('.igx-navsaved');
    if (clone && clone.dataset.sig !== sig) { clone.remove(); clone = null; }
    if (!clone) {
      clone = item.cloneNode(true);
      clone.dataset.sig = sig;
      clone.classList.add('igx-navsaved');
      const a = clone.querySelector('a[href="/explore/"]') || clone;
      a.setAttribute('href', LIKES_URL + SAVED_HASH);
      a.removeAttribute('aria-current');
      const label = [...clone.querySelectorAll('span')].find((s) => !s.children.length && s.textContent.trim());
      if (label) { label.textContent = T('saved'); label.classList.add('igx-navlabel'); }
      a.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        openSaved();
      }, true);
      item.after(clone);
    }
    // Same look as the native items: their svg attributes (class sets the colour),
    // outline icon, filled + bold label when active.
    const active = savedMode();
    if (clone.dataset.igxActive === String(active)) return;
    clone.dataset.igxActive = String(active);
    const native = document.querySelector('a[href="/explore/"] svg');
    const old = clone.querySelector('svg');
    if (!old) return;
    const s = document.createElementNS(SVG_NS, 'svg');
    for (const at of (native || old).attributes) s.setAttribute(at.name, at.value);
    s.setAttribute('aria-label', T('saved'));
    const p = document.createElementNS(SVG_NS, active ? 'path' : 'polygon');
    if (active) p.setAttribute('d', P_BOOKMARK_FILLED);
    else {
      p.setAttribute('points', '20 21 12 13.44 4 21 4 3 20 3 20 21');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('stroke-width', '2');
    }
    s.append(p);
    old.replaceWith(s);
    clone.classList.toggle('igx-navactive', active);
  }

  // ---------- left nav: no hover expansion ----------
  // Instagram widens the nav to 238px with labels on hover (inline width set
  // from React mouse events). Labels aren't needed; swallow hover events inside
  // the nav before Instagram sees them. CSS :hover highlights still work.
  let navPanel = null;
  function lockNav() {
    if (navPanel && navPanel.isConnected) return;
    let e = document.querySelector('a[href="/explore/"]');
    while (e && !/(^|;)\s*width:/.test(e.getAttribute('style') || '')) e = e.parentElement;
    navPanel = e;
  }
  for (const t of ['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousemove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointermove']) {
    window.addEventListener(t, (ev) => {
      if (navPanel && ev.target instanceof Node && navPanel.contains(ev.target)) ev.stopImmediatePropagation();
    }, true);
  }

  // ---------- post page: big post, no frame, "more posts" folded ----------
  // main > wrap > [post block (--x-maxWidth 815px) > bordered box > media + comments (335px)], line, "More posts from …".
  function tweakPostPage() {
    // Standalone post page only: feed posts (and a post opened as a modal over
    // the feed) live inside <article>, the standalone page has none.
    const b = isPostPage() ? postButtons() : null;
    const on = !!b && !b.shareBtn.closest('article');
    document.documentElement.toggleAttribute('data-igx-post', on);
    if (!on) return;
    // Box = ancestor with exactly two children: media + comments column.
    let box = b.shareBtn;
    while (box && box.tagName !== 'MAIN' && !(box.children.length === 2 && box.children[1].contains(b.shareBtn) && box.children[0].querySelector('img, video'))) box = box.parentElement;
    if (!box || box.tagName === 'MAIN') return;
    const post = box.parentElement;
    const wrap = post && post.parentElement;
    if (!wrap || wrap.tagName === 'MAIN') return;
    if (!box.hasAttribute('data-igx-pbox')) box.setAttribute('data-igx-pbox', '');
    if (!post.hasAttribute('data-igx-ppost')) post.setAttribute('data-igx-ppost', '');
    if (!wrap.hasAttribute('data-igx-pwrap')) wrap.setAttribute('data-igx-pwrap', '');
    // Size: as tall as the window allows, keeping the media's proportions.
    const media = box.children[0].getBoundingClientRect();
    const side = box.children[1].getBoundingClientRect().width;
    if (media.width > 50 && media.height > 50) {
      const ratio = media.height / media.width;
      const top = box.getBoundingClientRect().top + scrollY; // space above the post
      const h = Math.max(400, innerHeight - 2 * top); // same space below: centred
      const w = Math.round(Math.min(h / ratio + side, 1600)) + 'px';
      if (post.style.getPropertyValue('--igx-post-max') !== w) post.style.setProperty('--igx-post-max', w);
    }
    // Everything after the post (line, "More posts from …") folds behind a button.
    for (const c of wrap.children) {
      if (c === post || c.classList.contains('igx-moretoggle')) continue;
      if (!c.hasAttribute('data-igx-pmore')) c.setAttribute('data-igx-pmore', '');
    }
    if (!wrap.querySelector(':scope > .igx-moretoggle') && wrap.querySelector('[data-igx-pmore] a[href*="/p/"], [data-igx-pmore] a[href*="/reel/"]')) {
      const t = el('button', 'igx-moretoggle', T('morePosts'));
      t.type = 'button';
      t.addEventListener('click', () => {
        const open = !wrap.hasAttribute('data-igx-pmore-open');
        wrap.toggleAttribute('data-igx-pmore-open', open);
        t.textContent = T(open ? 'lessPosts' : 'morePosts');
      });
      post.after(t);
    }
  }

  // ---------- loop ----------
  function run() {
    queued = false;
    tweakActivity();
    lockNav();
    ensureNavItem();
    tweakPostPage();
    maybeHarvestHere();
    runPending();
    runJob();
  }
  let queued = false;
  // setTimeout (not rAF) so it also runs in background tabs (jobs).
  const schedule = () => { if (!queued) { queued = true; setTimeout(run, 50); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  store.get(COLL_KEY, (r) => { collections = r[COLL_KEY] || null; schedule(); });
  schedule();
})();
