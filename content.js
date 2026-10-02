// Following First (for Instagram)
// - Followers/Following modals: full height, +128px wider
// - Personal groups per contact (create / rename / recolor / delete)
// - Filter by group (renders from saved data, zero requests)
// - "Follows me" indicator (own followers list, synced at most once a day)
(() => {
  'use strict';

  const ATTR = 'data-ig-tall';
  const LINK = 'a[href^="/"][role="link"]';
  const BTN = 'button, [role="button"]'; // Followers rows use div[role=button]
  const EXTRA_WIDTH = 288;
  const SYNC_MAX_AGE = 24 * 3600 * 1000;
  const IG_APP_ID = '936619743392459';
  const PALETTE = ['#34c759', '#8e8e93', '#ff9f0a', '#0a84ff', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#ac8e68'];
  const T = globalThis.igxT;
  // Default groups get labels in the interface language (only until the user saves groups).
  const DEFAULT_GROUPS = [
    { id: 'friends', label: 'friends', color: '#34c759' },
    { id: 'strangers', label: 'strangers', color: '#8e8e93' },
    { id: 'shops', label: 'shops', color: '#ff9f0a' },
  ];
  const store = chrome.storage.local;

  const defaultGroups = () => DEFAULT_GROUPS.map((g) => ({ ...g, label: T(g.label) }));
  let groups = defaultGroups();
  let tags = {};        // username -> groupId
  let people = {};      // username -> { name, pic }  (only for tagged contacts)
  let followers = null; // { uid, ts, users: [username] }
  let following = null; // { uid, ts, users: { username: pk } }  — accounts I follow
  let mutes = {};       // username -> { posts, stories, ts }
  let lastSync = null;  // { ts, manual } — last successful lists update
  let followerSet = null;
  let ready = false;
  let sync = { running: false, loaded: 0, error: null };
  let pop = null;
  let scheduled = false;

  // ---------- helpers ----------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const myId = () => (document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/) || [])[1] || null;
  const groupById = (id) => groups.find((g) => g.id === id) || null;
  const countIn = (id) => Object.values(tags).filter((t) => t === id).length;
  const ICON_CARET = '<svg viewBox="0 0 10 6" width="8" height="5"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_SYNC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  const ICON_GEAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

  function agoText(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return T('justNow');
    if (m < 60) return T('minAgo', m);
    const h = Math.round(m / 60);
    if (h < 24) return T('hAgo', h);
    return T('dAgo', Math.round(h / 24));
  }

  // ---------- storage ----------
  function setFollowers(f) {
    followers = f;
    const uid = myId();
    followerSet = f && f.uid === uid ? new Set(f.users) : null;
  }

  // Groups and tags also live in chrome.storage.sync (sync-store.js), so they
  // follow the user to other computers and survive a reinstall when Chrome
  // sync is on. The synced copy wins; if there is none yet, local data is
  // uploaded. Lists, people and mutes are caches and stay local only.
  store.get(['groups', 'tags', 'people', 'followers', 'following', 'mutes', 'lastSync'], async (r) => {
    lastSync = r.lastSync || null;
    following = r.following || null;
    mutes = r.mutes || {};
    if (Array.isArray(r.groups)) groups = r.groups;
    tags = r.tags || {};
    people = r.people || {};
    setFollowers(r.followers || null);
    const [sGroups, sTags] = await Promise.all([syncStore.read('groups'), syncStore.read('tags')]);
    if (Array.isArray(sGroups)) groups = sGroups;
    else if (Array.isArray(r.groups)) syncStore.write('groups', groups);
    if (sTags && typeof sTags === 'object') tags = sTags;
    else if (r.tags) syncStore.write('tags', tags);
    if (Array.isArray(sGroups) || sTags) store.set({ groups, tags });
    ready = true;
    schedule();
  });

  // Changes made on another computer (or another tab).
  syncStore.onChange('groups', (v) => { if (Array.isArray(v)) store.set({ groups: v }); });
  syncStore.onChange('tags', (v) => { if (v && typeof v === 'object') store.set({ tags: v }); });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.groups) {
      const json = JSON.stringify(ch.groups.newValue || null);
      if (groupEchoes.has(json)) groupEchoes.delete(json); // our own write coming back
      else groups = ch.groups.newValue || defaultGroups();
    }
    if (ch.tags) tags = ch.tags.newValue || {};
    if (ch.people) people = ch.people.newValue || {};
    if (ch.followers) setFollowers(ch.followers.newValue || null);
    if (ch.following) following = ch.following.newValue || null;
    if (ch.mutes) mutes = ch.mutes.newValue || {};
    if (ch.lastSync) lastSync = ch.lastSync.newValue || null;
    if (ch.following || ch.mutes) refreshMutes();
    if (ch.groups || ch.tags || ch.people || ch.followers) refreshAll();
  });

  let groupSaveTimer = null;
  const groupEchoes = new Set();
  let syncTimer = null;
  const writeSync = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncStore.write('groups', groups); syncStore.write('tags', tags); }, 1500);
  };
  const writeGroups = (extra) => {
    groupEchoes.add(JSON.stringify(groups));
    store.set({ groups, ...(extra || {}) });
    writeSync();
  };
  const saveGroups = (debounce) => {
    clearTimeout(groupSaveTimer);
    if (debounce) groupSaveTimer = setTimeout(writeGroups, 300);
    else writeGroups();
  };
  const saveTags = () => { store.set({ tags, people }); writeSync(); };

  // ---------- dialog detection ----------
  function isFollowDialog(d) {
    return d.querySelector('input[type="text"]') && d.querySelectorAll(LINK).length >= 2;
  }

  function usernameFrom(a) {
    const m = (a.getAttribute('href') || '').match(/^\/([^/?#]+)\/?$/);
    return m ? m[1] : null;
  }

  // From a profile link, find the whole row: the highest ancestor that still
  // holds only this one user. The action button is the row's LAST button
  // (Following / Follow / Remove) — Followers rows also have an inline
  // "· Follow" button next to the username that must be ignored.
  function findRow(a, dialog) {
    let best = null;
    for (let e = a.parentElement; e && e !== dialog; e = e.parentElement) {
      const users = new Set([...e.querySelectorAll(LINK)].map(usernameFrom).filter(Boolean));
      if (users.size > 1) break;
      // A search with a single result is also "one user" up to the dialog;
      // rows are ~60px tall and never contain the search input.
      if (e.querySelector('input') || e.getBoundingClientRect().height > 100) break;
      if (e.querySelector(BTN)) best = e;
    }
    if (!best) return null;
    while (best.children.length === 1) best = best.firstElementChild;
    const btns = [...best.querySelectorAll(BTN)].filter((b) => !b.closest('a') && !b.closest('.igx-chip, .igx-mute'));
    const btn = btns[btns.length - 1];
    if (!btn || btn === best) return null;
    let wrap = btn;
    while (wrap.parentElement !== best) wrap = wrap.parentElement;
    return [best, wrap];
  }

  function rowInfo(row, user) {
    const img = row.querySelector('img');
    // Language-independent: skip text inside buttons ("· Follow") and icons ("Verified").
    const parts = [];
    for (const c of row.children) {
      if (c === row.lastElementChild || /\bigx-(chip|fb|mute)\b/.test(c.className)) continue;
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.parentElement.closest('button, [role="button"], svg')) parts.push(n.nodeValue.trim());
      }
    }
    const name = parts.find((s) => s && s !== user && s !== '·') || '';
    return { name, pic: img ? img.src : '' };
  }

  function scrollContainerOf(d) {
    const a = [...d.querySelectorAll(LINK)].find((x) => !x.closest('.igx-list'));
    if (!a) return null;
    for (let e = a.parentElement; e && e !== d; e = e.parentElement) {
      const oy = getComputedStyle(e).overflowY;
      if (oy === 'auto' || oy === 'scroll') return e;
    }
    return null;
  }

  // ---------- chips & indicator ----------
  function makeChip(user) {
    const chip = el('button', 'igx-chip');
    chip.type = 'button';
    chip.dataset.user = user;
    chip.innerHTML = '<span class="igx-dot"></span><span class="igx-label"></span>' + ICON_CARET;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(chip);
    });
    renderChip(chip);
    return chip;
  }

  function renderChip(chip) {
    const g = groupById(tags[chip.dataset.user]);
    chip.classList.toggle('igx-empty', !g);
    chip.style.setProperty('--igx-c', g ? g.color : 'transparent');
    chip.querySelector('.igx-label').textContent = g ? g.label : T('group');
  }

  function makeFb(user) {
    const s = el('span', 'igx-fb');
    s.dataset.user = user;
    renderFb(s);
    return s;
  }

  function renderFb(s) {
    s.classList.remove('igx-yes', 'igx-no', 'igx-unknown');
    if (!followerSet) {
      s.classList.add('igx-unknown');
      s.textContent = sync.running ? T('checking') : '—';
      s.title = T('fbNoData');
    } else if (followerSet.has(s.dataset.user)) {
      s.classList.add('igx-yes');
      s.textContent = T('follows');
      s.title = T('fbYes', agoText(followers.ts));
    } else {
      s.classList.add('igx-no');
      s.textContent = T('notFollowing');
      s.title = T('fbNo', agoText(followers.ts));
    }
  }

  function setTag(user, groupId, row) {
    if (groupId) {
      tags[user] = groupId;
      if (row) people[user] = { ...(people[user] || {}), ...rowInfo(row, user) };
    } else {
      delete tags[user];
      delete people[user];
    }
    saveTags();
    refreshAll();
  }

  // ---------- filter bar & group list ----------
  function setupDialog(d) {
    d.setAttribute(ATTR, '1');
    const w = d.getBoundingClientRect().width;
    d.style.setProperty('width', Math.min(w + EXTRA_WIDTH, window.innerWidth - 32) + 'px', 'important');
    d.style.setProperty('max-width', 'none', 'important');
    d._igx = { filter: 'all', bar: null, list: null, scroll: null };
    d.addEventListener('input', (e) => {
      if (e.target.matches('input[type="text"]') && !e.target.closest('.igx-pop') && d._igx.filter !== 'all') renderList(d);
    }, true);
    runSync(false);
  }

  function ensureBar(d) {
    const st = d._igx;
    const sc = scrollContainerOf(d) || st.scroll;
    if (!sc || !sc.isConnected) return;
    if (st.scroll !== sc) {
      st.scroll = sc;
      sc.setAttribute('data-igx-scroll', '');
    }
    if (!st.bar) {
      st.bar = el('div', 'igx-bar');
      st.bar.innerHTML = '<div class="igx-pills"></div>';
      const syncBtn = el('button', 'igx-icon igx-sync');
      syncBtn.type = 'button';
      syncBtn.innerHTML = ICON_SYNC;
      syncBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); refreshEverything(); });
      const gear = el('button', 'igx-icon igx-gear');
      gear.type = 'button';
      gear.title = T('manageGroups');
      gear.innerHTML = ICON_GEAR;
      gear.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openManage(gear); });
      st.bar.append(syncBtn, gear);
      st.list = el('div', 'igx-list');
      st.list.hidden = true;
    }
    if (st.bar.parentElement !== sc.parentElement || st.list.nextElementSibling !== sc) {
      sc.parentElement.insertBefore(st.bar, sc);
      sc.parentElement.insertBefore(st.list, sc);
      apply(d);
    }
  }

  function apply(d) {
    const st = d._igx;
    if (!st || !st.bar) return;
    if (st.filter !== 'all' && !groupById(st.filter)) st.filter = 'all';
    const all = st.filter === 'all';
    st.list.hidden = all;
    // In group view hide Instagram's own list and its loaders (siblings after ours).
    for (const c of st.list.parentElement ? st.list.parentElement.children : []) {
      if (c === st.bar || c === st.list) continue;
      if (all) c.removeAttribute('data-igx-hide');
      else if (c.compareDocumentPosition(st.list) & Node.DOCUMENT_POSITION_PRECEDING) c.setAttribute('data-igx-hide', '');
    }
    renderBar(d);
    if (!all) renderList(d);
  }

  function renderBar(d) {
    const st = d._igx;
    const pills = st.bar.querySelector('.igx-pills');
    const items = [{ id: 'all', label: T('all') }, ...groups];
    pills.replaceChildren(...items.map((g) => {
      const p = el('button', 'igx-pill' + (st.filter === g.id ? ' igx-on' : ''));
      p.type = 'button';
      if (g.color) {
        p.style.setProperty('--igx-c', g.color);
        p.append(el('span', 'igx-dot'));
      }
      p.append(el('span', null, g.label));
      if (g.id !== 'all') p.append(el('span', 'igx-count', String(countIn(g.id))));
      p.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        st.filter = g.id;
        apply(d);
        if (!st.list.hidden) st.list.scrollTop = 0;
      });
      return p;
    }));
    const sb = st.bar.querySelector('.igx-sync');
    sb.classList.toggle('igx-spin', sync.running);
    sb.classList.toggle('igx-err', !!sync.error && !sync.running);
    sb.dataset.tip = syncTitle();
    sb.setAttribute('aria-label', syncTitle());
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const opts = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleString(globalThis.igxLocale(), opts);
  }

  // Tooltip of the ↻ button (multi-line, shown instantly on hover).
  function syncTitle() {
    const counts = [
      followerSet ? T('followersN', followerSet.size) : null,
      following ? T('followingN', Object.keys(following.users).length) : null,
    ].filter(Boolean).join(' · ');
    const last = sync.running ? sync.prev : lastSync || (followers && { ts: followers.ts, manual: false });
    const lastLine = last ? T('lastUpdate', fmtDate(last.ts) + ' · ' + T(last.manual ? 'manual' : 'auto')) : T('notUpdated');
    if (sync.running) return T('updating', sync.loaded) + '\n' + lastLine;
    if (sync.error) return T('updateFailed', sync.error) + '\n' + lastLine + '\n' + T('retry');
    return lastLine + (counts ? '\n' + counts : '') + '\n' + T('reloadHint');
  }


  function renderList(d) {
    const st = d._igx;
    const input = [...d.querySelectorAll('input[type="text"]')].find((i) => !i.closest('.igx-pop'));
    const q = ((input && input.value) || '').trim().toLowerCase();
    const users = Object.keys(tags)
      .filter((u) => tags[u] === st.filter)
      .filter((u) => !q || u.toLowerCase().includes(q) || ((people[u] && people[u].name) || '').toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b));
    if (!users.length) {
      st.list.replaceChildren(el('div', 'igx-emptylist', T(q ? 'noMatches' : 'emptyGroup')));
      return;
    }
    st.list.replaceChildren(...users.map((u) => {
      const info = people[u] || {};
      const row = el('div', 'igx-row');
      const av = el('a', 'igx-av');
      av.href = '/' + u + '/';
      const letter = () => av.replaceChildren(el('span', 'igx-letter', (u[0] || '?').toUpperCase()));
      if (info.pic) {
        const img = el('img');
        img.src = info.pic;
        img.alt = '';
        img.onerror = letter;
        av.append(img);
      } else letter();
      const who = el('a', 'igx-who');
      who.href = '/' + u + '/';
      who.append(el('span', 'igx-u', u));
      if (info.name) who.append(el('span', 'igx-n', info.name));
      row.append(av, who, makeChip(u), makeMute(u), makeFb(u));
      return row;
    }));
  }

  // ---------- popovers ----------
  function closePop() {
    if (pop) { pop.remove(); pop = null; }
  }

  function placePop(p, anchor) {
    const r = anchor.getBoundingClientRect();
    const mh = p.offsetHeight, mw = p.offsetWidth;
    let top = r.bottom + 6;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    p.style.top = top + 'px';
    p.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + 'px';
  }

  function showPop(p, anchor) {
    p._anchor = anchor;
    pop = p;
    (anchor.closest('[role="dialog"]') || document.body).appendChild(p);
    placePop(p, anchor);
  }

  function openMenu(chip) {
    if (pop && pop._anchor === chip) { closePop(); return; }
    closePop();
    const user = chip.dataset.user;
    const row = chip.parentElement;
    const current = tags[user] || '';
    const menu = el('div', 'igx-pop igx-menu');
    const add = (g, extraCls) => {
      const it = el('button', 'igx-item' + (extraCls || '') + (current === g.id ? ' igx-active' : ''));
      it.type = 'button';
      it.style.setProperty('--igx-c', g.color);
      it.append(el('span', 'igx-dot'), el('span', 'igx-grow', g.label), el('span', 'igx-check', '✓'));
      it.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closePop();
        setTag(user, g.id, row && !row.classList.contains('igx-row') ? row : null);
      });
      menu.append(it);
    };
    groups.forEach((g) => add(g));
    add({ id: '', label: T('noGroup'), color: 'transparent' }, ' igx-none');
    const manage = el('button', 'igx-item igx-manage-link', T('manageGroupsMenu'));
    manage.type = 'button';
    manage.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openManage(chip, true);
    });
    menu.append(manage);
    showPop(menu, chip);
  }

  function openManage(anchor, force) {
    if (pop && pop._anchor === anchor && !force) { closePop(); return; }
    closePop();
    const panel = el('div', 'igx-pop igx-manage');
    panel.append(el('div', 'igx-title', T('groups')));
    const list = el('div', 'igx-glist');
    const addBtn = el('button', 'igx-add', T('addGroup'));
    addBtn.type = 'button';
    panel.append(list, addBtn);

    const build = (focusId) => {
      list.replaceChildren(...groups.map((g) => {
        const r = el('div', 'igx-grow-row');
        const dot = el('button', 'igx-swatch');
        dot.type = 'button';
        dot.title = T('changeColor');
        dot.style.setProperty('--igx-c', g.color);
        dot.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const live = groupById(g.id);
          if (!live) return;
          live.color = PALETTE[(PALETTE.indexOf(live.color) + 1) % PALETTE.length];
          dot.style.setProperty('--igx-c', live.color);
          saveGroups();
          refreshAll();
        });
        const input = el('input', 'igx-name');
        input.value = g.label;
        input.maxLength = 24;
        input.addEventListener('input', () => {
          const live = groupById(g.id);
          if (!live) return;
          live.label = input.value.trim() || T('untitled');
          saveGroups(true);
          refreshAll();
        });
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') closePop();
        });
        const cnt = el('span', 'igx-count', String(countIn(g.id)));
        const del = el('button', 'igx-del');
        del.type = 'button';
        del.title = T('deleteGroup');
        del.innerHTML = ICON_TRASH;
        let armed = null;
        del.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!armed) {
            del.classList.add('igx-armed');
            del.textContent = T('deleteQ');
            armed = setTimeout(() => { armed = null; del.classList.remove('igx-armed'); del.innerHTML = ICON_TRASH; }, 3000);
            return;
          }
          clearTimeout(armed);
          groups = groups.filter((x) => x.id !== g.id);
          for (const u of Object.keys(tags)) if (tags[u] === g.id) { delete tags[u]; delete people[u]; }
          clearTimeout(groupSaveTimer);
          writeGroups({ tags, people });
          build();
          refreshAll();
        });
        r.append(dot, input, cnt, del);
        if (g.id === focusId) setTimeout(() => { input.focus(); input.select(); }, 0);
        return r;
      }));
      if (!groups.length) list.append(el('div', 'igx-emptylist', T('noGroups')));
      placePop(panel, anchor);
    };

    addBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const used = new Set(groups.map((g) => g.color));
      const color = PALETTE.find((c) => !used.has(c)) || PALETTE[groups.length % PALETTE.length];
      const g = { id: 'g' + Date.now().toString(36), label: T('newGroup'), color };
      groups.push(g);
      saveGroups();
      build(g.id);
      refreshAll();
    });

    showPop(panel, anchor);
    build();
  }

  document.addEventListener('click', (e) => {
    if (pop && !pop.contains(e.target) && !(pop._anchor && pop._anchor.contains(e.target))) closePop();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop) { e.stopPropagation(); e.preventDefault(); closePop(); }
  }, true);
  document.addEventListener('scroll', (e) => {
    if (pop && !(e.target instanceof Node && pop.contains(e.target))) closePop();
  }, true);
  window.addEventListener('resize', closePop);

  // ---------- followers / following sync ----------
  const API_HEADERS = { 'x-ig-app-id': IG_APP_ID, 'x-requested-with': 'XMLHttpRequest' };

  // Pages through /friendships/{uid}/{kind}/ at a human-like pace.
  async function fetchList(uid, kind, onUser) {
    let maxId = null;
    let pages = 0;
    do {
      const url = '/api/v1/friendships/' + uid + '/' + kind + '/?count=50' + (maxId ? '&max_id=' + encodeURIComponent(maxId) : '');
      const r = await fetch(url, { credentials: 'include', headers: API_HEADERS });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      for (const u of j.users || []) onUser(u);
      store.set({ syncLock: Date.now() });
      refreshSyncUi();
      maxId = j.next_max_id || null;
      pages++;
      if (maxId) await sleep(1500 + Math.random() * 2000);
    } while (maxId && pages < 400);
  }

  async function runSync(force) {
    const uid = myId();
    if (!uid || sync.running) return;
    const fresh = (x) => x && x.uid === uid && Date.now() - x.ts < SYNC_MAX_AGE;
    if (!force && fresh(followers) && fresh(following)) return;
    const lock = await new Promise((r) => store.get('syncLock', (x) => r(x.syncLock)));
    if (lock && Date.now() - lock < 60000) return; // another tab is syncing
    // Remember what "last update" was before this run, for the tooltip.
    sync = { running: true, loaded: 0, error: null, prev: lastSync || (followers && { ts: followers.ts, manual: false }) };
    store.set({ syncLock: Date.now() });
    refreshAll();
    const info = {};
    const keep = (u) => { if (tags[u.username]) info[u.username] = { name: u.full_name || '', pic: u.profile_pic_url || '' }; };
    try {
      if (force || !fresh(followers)) {
        const users = [];
        await fetchList(uid, 'followers', (u) => { users.push(u.username); keep(u); sync.loaded = users.length; });
        setFollowers({ uid, ts: Date.now(), users });
        store.set({ followers });
        refreshAll();
      }
      if (force || !fresh(following)) {
        await sleep(1500 + Math.random() * 1500);
        const map = {};
        await fetchList(uid, 'following', (u) => { map[u.username] = String(u.pk); keep(u); sync.loaded = Object.keys(map).length; });
        following = { uid, ts: Date.now(), users: map };
        store.set({ following });
      }
      for (const u of Object.keys(info)) people[u] = { ...(people[u] || {}), ...info[u] };
      lastSync = { ts: Date.now(), manual: !!force };
      store.set({ people, lastSync });
    } catch (err) {
      sync.error = err.message || String(err);
    } finally {
      sync.running = false;
      store.remove('syncLock');
      refreshAll();
    }
  }

  // ---------- mute (posts / stories in my feed) ----------
  // Instagram only exposes mute status per account (friendships/show/{pk}),
  // so statuses are fetched lazily for rows on screen, one at a time, and
  // cached for MUTE_MAX_AGE.
  const MUTE_MAX_AGE = 7 * 24 * 3600 * 1000;
  const ICON_POSTS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 15.5l4.5-4.5 4 4 2.5-2.5 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>';
  const ICON_STORIES = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3a9 9 0 0 1 9 9" /><path d="M21 12a9 9 0 0 1-9 9" stroke-dasharray="2.2 2.6"/><path d="M12 21a9 9 0 0 1-9-9" stroke-dasharray="2.2 2.6"/><path d="M3 12a9 9 0 0 1 9-9"/><circle cx="12" cy="12" r="4"/></svg>';
  const SLASH = '<svg class="igx-slash" viewBox="0 0 24 24" width="18" height="18"><path d="M4 20L20 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const muteQueue = new Set();
  let muteBusy = false;
  let muteBackoff = 0;

  const pkOf = (user) => (following && following.uid === myId() && following.users[user]) || null;
  const muteFresh = (user) => mutes[user] && Date.now() - mutes[user].ts < MUTE_MAX_AGE;

  const muteObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const user = e.target.dataset.user;
      if (e.isIntersecting) { if (pkOf(user) && !muteFresh(user)) muteQueue.add(user); }
      else muteQueue.delete(user);
    }
    pumpMutes();
  });

  async function fetchMuteStatus(user) {
    const pk = pkOf(user);
    if (!pk) return null;
    const r = await fetch('/api/v1/friendships/show/' + pk + '/', { credentials: 'include', headers: API_HEADERS });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    mutes[user] = { posts: !!j.muting, stories: !!j.is_muting_reel, ts: Date.now() };
    store.set({ mutes });
    renderMutesFor(user);
    return mutes[user];
  }

  async function pumpMutes() {
    if (muteBusy || !muteQueue.size || Date.now() < muteBackoff) return;
    const user = muteQueue.values().next().value;
    muteQueue.delete(user);
    if (!pkOf(user) || muteFresh(user)) { pumpMutes(); return; }
    muteBusy = true;
    try {
      await fetchMuteStatus(user);
    } catch (err) {
      muteBackoff = Date.now() + 60000; // back off for a minute on errors / rate limits
      setTimeout(pumpMutes, 61000);
    }
    await sleep(1200 + Math.random() * 600);
    muteBusy = false;
    pumpMutes();
  }

  // Click works even while the status is still loading: fetch it right away
  // (skipping the queue), then flip it.
  async function toggleMute(user, kind, btn) {
    const pk = pkOf(user);
    if (!pk || btn.classList.contains('igx-pending')) return;
    btn.classList.add('igx-pending');
    try {
      let cur = mutes[user];
      if (!cur) {
        muteQueue.delete(user);
        cur = await fetchMuteStatus(user);
      }
      const muting = !cur[kind];
      const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
      const body = (kind === 'posts' ? 'target_posts_author_id=' : 'target_reel_author_id=') + encodeURIComponent(pk);
      const r = await fetch('/api/v1/friendships/' + (muting ? 'mute' : 'unmute') + '_posts_or_story_from_follow/', {
        method: 'POST',
        credentials: 'include',
        headers: { ...API_HEADERS, 'x-csrftoken': csrf, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.status !== 'ok') throw new Error('HTTP ' + r.status);
      mutes[user] = { ...mutes[user], [kind]: muting, ts: Date.now() };
      store.set({ mutes });
    } catch (err) {
      btn.dataset.err = T('muteErr', err.message || err);
    } finally {
      btn.classList.remove('igx-pending');
      renderMutesFor(user);
    }
  }

  // ↻ in the filter bar: reload both lists and every mute status.
  function refreshEverything() {
    mutes = {};
    muteQueue.clear();
    store.set({ mutes });
    refreshMutes();
    runSync(true);
  }

  function makeMute(user) {
    const g = el('span', 'igx-mute');
    g.dataset.user = user;
    for (const kind of ['posts', 'stories']) {
      const b = el('button', 'igx-mbtn');
      b.type = 'button';
      b.dataset.kind = kind;
      b.innerHTML = (kind === 'posts' ? ICON_POSTS : ICON_STORIES) + SLASH;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleMute(user, kind, b); });
      g.append(b);
    }
    renderMute(g);
    muteObserver.observe(g);
    return g;
  }

  function renderMute(g) {
    const user = g.dataset.user;
    const pk = pkOf(user);
    const st = mutes[user];
    g.classList.toggle('igx-na', !!following && !pk);
    g.classList.toggle('igx-loading', !!pk && !st);
    for (const b of g.children) {
      const kind = b.dataset.kind;
      const name = T(kind);
      const muted = !!(st && st[kind]);
      b.classList.toggle('igx-muted', muted);
      b.disabled = !pk;
      if (!b.classList.contains('igx-pending')) {
        const err = b.dataset.err;
        delete b.dataset.err;
        b.title = err || (!following ? T('loadingFollowing')
          : !pk ? T('notFollowed')
          : !st ? T('muteChecking', name)
          : T(muted ? 'mutedHint' : 'shownHint', name));
      }
    }
  }

  function renderMutesFor(user) {
    document.querySelectorAll('.igx-mute').forEach((g) => { if (g.dataset.user === user) renderMute(g); });
  }

  function refreshMutes() {
    document.querySelectorAll('.igx-mute').forEach((g) => {
      renderMute(g);
      muteObserver.unobserve(g);
      muteObserver.observe(g); // re-evaluate visibility → queue
    });
  }

  function refreshSyncUi() {
    document.querySelectorAll('.igx-fb').forEach(renderFb);
    document.querySelectorAll('div[' + ATTR + ']').forEach((d) => d._igx && d._igx.bar && renderBar(d));
  }

  // ---------- main loop ----------
  function refreshAll() {
    document.querySelectorAll('.igx-chip').forEach(renderChip);
    document.querySelectorAll('.igx-mute').forEach(renderMute);
    document.querySelectorAll('.igx-fb').forEach(renderFb);
    document.querySelectorAll('div[' + ATTR + ']').forEach((d) => d._igx && apply(d));
  }

  function scan() {
    scheduled = false;
    if (!ready) return;
    document.querySelectorAll('div[role="dialog"]').forEach((d) => {
      if (!d._igx) {
        if (!isFollowDialog(d)) return;
        setupDialog(d);
      }
      ensureBar(d);
      d.querySelectorAll(LINK).forEach((a) => {
        if (a.closest('.igx-list')) return;
        const user = usernameFrom(a);
        if (!user) return;
        const found = findRow(a, d);
        if (!found) return;
        const [row, wrap] = found;
        if (row.querySelector('.igx-chip')) return;
        row.setAttribute('data-igx-row', '');
        // Instagram gives the list fixed pixel widths; let every level stretch.
        for (let e = row; e && e !== d && !e.hasAttribute('data-igx-full'); e = e.parentElement) e.setAttribute('data-igx-full', '');
        const info = [...row.children].filter((c) => c !== wrap && !c.querySelector('img')).pop();
        if (info) info.setAttribute('data-igx-info', '');
        row.insertBefore(makeChip(user), wrap);
        row.insertBefore(makeMute(user), wrap);
        row.insertBefore(makeFb(user), wrap);
        if (tags[user]) {
          const info = rowInfo(row, user);
          const old = people[user] || {};
          if (info.pic && (info.pic !== old.pic || info.name !== old.name)) {
            people[user] = { ...old, ...info };
            store.set({ people });
          }
        }
      });
    });
    if (pop && !pop._anchor.isConnected) closePop();
  }

  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(scan); }
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
