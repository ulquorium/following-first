// Following First — mute items in Instagram's "⋯" menu (posts, reels, stories):
// "Mute posts", "Mute stories", "Mute both" (or "Unmute …" when already muted)
// for the author, if I follow them. Same endpoints as the mute toggles in the
// follow lists (content.js); the `mutes` cache in storage is updated too.
(() => {
  const T = globalThis.igxT;
  const store = chrome.storage.local;
  const API_HEADERS = { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' };
  const KNOWN = new Set(['', 'reels', 'explore', 'direct', 'accounts', 'your_activity', 'stories', 'p', 'reel']);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById('igx-toast');
    if (!t) { t = el('div'); t.id = 'igx-toast'; document.body.append(t); }
    t.textContent = text;
    t.classList.add('igx-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('igx-show'), 3000);
  }

  // ---------- who is the author of the thing whose "⋯" was clicked ----------
  const userFromHref = (h) => { const m = (h || '').match(/^\/([\w.]+)\/$/); return m && !KNOWN.has(m[1]) ? m[1] : null; };
  function authorNear(btn) {
    const story = location.pathname.match(/^\/stories\/([\w.]+)\//);
    if (story) return story[1];
    // Nearest ancestor that holds a profile link (feed article header, post page, reel).
    for (let e = btn, i = 0; e && i < 14; e = e.parentElement, i++) {
      for (const a of e.querySelectorAll('a[href]')) {
        const u = userFromHref(a.getAttribute('href'));
        if (u && a.getBoundingClientRect().width > 0) return u;
      }
    }
    return null;
  }
  // "More options" = svg with three circles (any language).
  const isMoreButton = (b) => !!b && [...b.querySelectorAll('svg')].some((s) => s.querySelectorAll('circle').length === 3);

  let context = null; // { user, ts, story }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[role="button"], button');
    if (!isMoreButton(b) || b.closest('[role="dialog"] [role="dialog"]')) return;
    const user = authorNear(b);
    context = user ? { user, ts: Date.now(), story: /^\/stories\//.test(location.pathname) } : null;
    if (context) waitForMenu();
  }, true);

  // ---------- account id + mute status ----------
  async function pkOf(user) {
    const r = await new Promise((res) => store.get('following', res));
    const f = r.following;
    if (f && f.users && f.users[user]) return { pk: String(f.users[user]), following: true };
    const j = await (await fetch('/api/v1/users/web_profile_info/?username=' + encodeURIComponent(user), { credentials: 'include', headers: API_HEADERS })).json();
    const u = j && j.data && j.data.user;
    return u ? { pk: String(u.id), following: !!u.followed_by_viewer } : null;
  }
  async function statusOf(pk) {
    const r = await fetch('/api/v1/friendships/show/' + pk + '/', { credentials: 'include', headers: API_HEADERS });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return { following: !!j.following, posts: !!j.muting, stories: !!j.is_muting_reel };
  }
  async function setMute(pk, kind, on) {
    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
    const r = await fetch('/api/v1/friendships/' + (on ? 'mute' : 'unmute') + '_posts_or_story_from_follow/', {
      method: 'POST',
      credentials: 'include',
      headers: { ...API_HEADERS, 'x-csrftoken': csrf, 'content-type': 'application/x-www-form-urlencoded' },
      body: (kind === 'posts' ? 'target_posts_author_id=' : 'target_reel_author_id=') + encodeURIComponent(pk),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status !== 'ok') throw new Error('HTTP ' + r.status);
  }
  async function rememberMutes(user, st) {
    const r = await new Promise((res) => store.get('mutes', res));
    const mutes = r.mutes || {};
    mutes[user] = { posts: st.posts, stories: st.stories, ts: Date.now() };
    store.set({ mutes });
  }

  // ---------- the menu ----------
  // Instagram's menu = a dialog with a vertical list of <button>s, "Cancel" last.
  // Our rows are copies of a native row (same look), inserted before "Cancel".
  function menuDialog() {
    const ds = [...document.querySelectorAll('div[role="dialog"]')].filter((d) => d.querySelectorAll('button').length >= 3 && !d.querySelector('.igx-mutemenu'));
    return ds.pop() || null;
  }
  async function waitForMenu() {
    const ctx = context;
    let dialog = null;
    for (let i = 0; i < 20 && !(dialog = menuDialog()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!dialog || ctx !== context) return;
    const buttons = [...dialog.querySelectorAll('button')];
    const cancel = buttons[buttons.length - 1];
    const sample = buttons[buttons.length - 2] || cancel;
    const holder = el('div', 'igx-mutemenu'); // marker + container, display: contents
    cancel.before(holder);
    let info;
    try {
      info = await pkOf(ctx.user);
      if (!info) return holder.remove();
      const st = await statusOf(info.pk);
      if (!st.following) return holder.remove(); // mute only exists for accounts I follow
      render(holder, sample, ctx, info.pk, st);
    } catch (e) {
      holder.remove();
    }
  }

  function render(holder, sample, ctx, pk, st) {
    const both = st.posts && st.stories;
    const items = [
      ['posts', st.posts ? T('unmutePosts') : T('mutePosts'), () => toggle(['posts'], !st.posts)],
      ['stories', st.stories ? T('unmuteStories') : T('muteStories'), () => toggle(['stories'], !st.stories)],
      ['both', both ? T('unmuteAll') : T('muteAll'), () => toggle(['posts', 'stories'], !both)],
    ];
    if (ctx.story) items.unshift(items.splice(1, 1)[0]); // in stories: stories first
    async function toggle(kinds, on) {
      const cancel = holder.nextElementSibling;
      try {
        for (const k of kinds) if (st[k] !== on) await setMute(pk, k, on);
        for (const k of kinds) st[k] = on;
        rememberMutes(ctx.user, st);
        toast((on ? T('mutedToast') : T('unmutedToast')) + ' @' + ctx.user);
      } catch (e) {
        toast(T('muteFailed'));
      }
      if (cancel && cancel.isConnected) cancel.click(); // close the menu
    }
    holder.replaceChildren(...items.map(([, label, run]) => {
      const b = sample.cloneNode(false); // same classes as a native row
      b.removeAttribute('tabindex');
      b.className += ' igx-mutebtn';
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(); });
      return b;
    }));
  }
})();
