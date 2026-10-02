// Home page tweaks:
//  1. Open the "Following" feed instead of "For you" by default.
//  2. Hide Instagram's feed tabs; switch feeds from two icons under the logo.
//  3. Pin the right sidebar (suggestions, account, links) to the right edge.
//  4. Center the feed column; smaller story circles so more fit.
//  5. Bigger posts: wider, and the media frame follows the real aspect ratio
//     (no cropping of vertical posts), capped at the viewport height.
(() => {
  const POST_WIDTH = 600;      // px, Instagram default is 470
  const MEDIA_MAX_GAP = 40;    // media frame is at most (viewport height - this)
  const isHome = () => location.pathname === '/';
  const variant = () => new URLSearchParams(location.search).get('variant');
  const isBareHome = () => isHome() && !variant();

  if (isBareHome()) {
    location.replace('/?variant=following' + location.hash);
    return;
  }

  // ---------- helpers ----------
  let navCollapsed = null; // left nav width while collapsed (it overlays the page when expanded)
  const feedTabs = () => {
    const list = document.querySelector('main [role="tablist"]');
    const tabs = list ? list.querySelectorAll('[role="tab"]') : [];
    // DOM order: [0] For you, [1] Following
    return tabs.length === 2 ? { algo: tabs[0], following: tabs[1] } : null;
  };

  // Feed already rendered (posts or stories) but no tabs → "subpage" layout.
  const feedWithoutTabs = () => {
    const main = document.querySelector('main');
    return !!main && !main.querySelector('[role="tablist"]') && !!main.querySelector('article, ul li canvas');
  };

  function switchFeed(which) {
    const tabs = feedTabs();
    if (isHome() && tabs) tabs[which].click();
    else location.href = which === 'following' ? '/?variant=following' : '/?variant=home';
  }

  // ---------- 1. default feed on in-app navigation (logo / Home icon) ----------
  let pending = false;
  setInterval(() => {
    if (!isBareHome() || pending) return;
    pending = true;
    const started = Date.now();
    const tryTab = () => {
      if (!isBareHome()) { pending = false; return; }
      const tabs = feedTabs();
      if (tabs) {
        tabs.following.click();
        setTimeout(() => { pending = false; }, 1000);
      } else if (Date.now() - started > 4000 || feedWithoutTabs()) {
        // "subpage" layout: no tabs will ever appear, Following is its own URL.
        location.replace('/?variant=following');
      } else {
        setTimeout(tryTab, 200);
      }
    };
    tryTab();
  }, 400);

  // ---------- 2. feed switcher under the logo ----------
  const ICON_FOLLOWING = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.8 14.1c2.4.1 4.1 1.7 4.7 4.4"/></svg>';
  const ICON_ALGO = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z"/><path d="M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
  let switcher = null;
  let switcherPos = null; // measured with the nav collapsed

  function logoLink() {
    return [...document.querySelectorAll('a[href="/"][role="link"]')].find((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.left < 40 && r.top < 120;
    });
  }

  function ensureSwitcher() {
    const logo = logoLink();
    if (!logo && !switcherPos) { if (switcher) switcher.hidden = true; return; }
    if (!switcher) {
      switcher = document.createElement('div');
      switcher.className = 'igx-feednav';
      for (const [key, label, icon] of [['following', globalThis.igxT('feedFollowing'), ICON_FOLLOWING], ['algo', globalThis.igxT('feedAlgo'), ICON_ALGO]]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'igx-feedbtn';
        b.dataset.feed = key;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.innerHTML = icon;
        b.addEventListener('click', (e) => { e.preventDefault(); switchFeed(key); });
        switcher.append(b);
      }
    }
    if (!switcher.isConnected) document.body.append(switcher);
    switcher.hidden = false;
    // The nav expands on hover and the logo changes instantly (before the nav
    // visibly widens). Measure once while collapsed; re-measure on resize only.
    if (!switcherPos) {
      const nw = navWidth();
      navCollapsed = navCollapsed == null ? nw : Math.min(navCollapsed, nw);
      if (nw <= navCollapsed + 2) {
        const r = logo.getBoundingClientRect();
        switcherPos = { top: Math.round(r.bottom + 12) + 'px', left: Math.round(r.left + r.width / 2) + 'px' };
      }
    }
    if (switcherPos) {
      if (switcher.style.top !== switcherPos.top) switcher.style.top = switcherPos.top;
      if (switcher.style.left !== switcherPos.left) switcher.style.left = switcherPos.left;
    }
    updateActive();
  }

  function updateActive() {
    const v = isHome() ? variant() : null;
    for (const b of switcher.children) {
      const on = (b.dataset.feed === 'following' && v === 'following') || (b.dataset.feed === 'algo' && v === 'home');
      b.classList.toggle('igx-on', on);
    }
  }

  // ---------- 3 & 4. layout: sidebar, centered column, tabs, stories ----------
  function navWidth() {
    const link = [...document.querySelectorAll('a[href="/"][role="link"]')]
      .find((l) => l.getBoundingClientRect().top > 60);
    for (let e = link; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.left <= 1 && r.height >= innerHeight * 0.9) return Math.round(r.right);
    }
    return 72;
  }

  // The nav expands over the page on hover; center against its collapsed width.
  function setNavVar() {
    const nw = navWidth();
    navCollapsed = navCollapsed == null ? nw : Math.min(navCollapsed, nw);
    const v = navCollapsed + 'px';
    if (document.documentElement.style.getPropertyValue('--igx-nav') !== v) {
      document.documentElement.style.setProperty('--igx-nav', v);
    }
  }

  function findFeedRow() {
    const main = document.querySelector('main');
    if (!isHome() || !main) return null;
    for (const row of main.children) {
      if (row.children.length !== 2) continue;
      const side = row.children[1];
      if (!side.querySelector('a[href="/explore/people/"]')) continue;
      row.setAttribute('data-igx-feedrow', '');
      side.setAttribute('data-igx-rsb', '');
      return row;
    }
    return null;
  }

  function tweakColumn(col) {
    const inner = col.firstElementChild;
    if (!inner) return;
    for (const part of inner.children) {
      // Tabs block (fixed header + its 70px spacer): hidden, still clickable from JS.
      if (part.querySelector('[role="tablist"]')) part.setAttribute('data-igx-tabswrap', '');
    }
    // Stories tray: zoomed out; ancestors lose their fixed height.
    const ul = [...inner.querySelectorAll('ul')].find((u) => u.querySelector('li canvas'));
    if (ul) {
      let tray = ul.parentElement;
      while (tray && tray !== inner && tray.children.length < 2) tray = tray.parentElement;
      if (tray && tray !== inner && !tray.hasAttribute('data-igx-tray')) {
        tray.setAttribute('data-igx-tray', '');
        for (let e = tray.parentElement; e && e !== inner; e = e.parentElement) e.setAttribute('data-igx-autoh', '');
      }
    }
  }

  // ---------- layout versions ----------
  // Instagram ships (at least) two home layouts; both end up looking the same:
  //  'tabs'    — "For you" / "Following" tabs above the feed, stories on both.
  //  'subpage' — "/" is For you; "/?variant=following" is a separate page with
  //              a back arrow + title and NO stories tray. There we hide the
  //              title and render our own tray (.igx-stories).
  function findSubpageHeader(col) {
    if (variant() !== 'following' || col.querySelector('[role="tablist"]')) return null;
    const link = [...col.querySelectorAll('a[href="/"]')].find((a) => !a.closest('article, .igx-stories'));
    if (!link) return null;
    let part = link;
    while (part.parentElement && part.parentElement !== col && !part.parentElement.querySelector('article')) part = part.parentElement;
    return part.parentElement && part.parentElement !== col ? part : null;
  }

  // ---------- stories tray for the 'subpage' layout ----------
  // One request per page view (GET /api/v1/feed/reels_tray/), re-used for
  // TRAY_MAX_AGE; refreshed when the tab becomes visible again.
  const TRAY_MAX_AGE = 2 * 60 * 1000;
  const ICON_CHEV = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  let trayEl = null;
  let trayData = null; // { ts, items: [{ user, pic, seen, besties }] }
  let trayLoading = false;
  let trayFailed = 0;

  async function loadTray() {
    if (trayLoading || (trayData && Date.now() - trayData.ts < TRAY_MAX_AGE) || Date.now() - trayFailed < 60000) return;
    trayLoading = true;
    try {
      const r = await fetch('/api/v1/feed/reels_tray/', {
        credentials: 'include',
        headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const items = (j.tray || [])
        .filter((t) => t.user && t.user.username && !t.muted)
        .map((t) => ({
          user: t.user.username,
          pic: t.user.profile_pic_url || '',
          seen: (t.seen || 0) >= (t.latest_reel_media || 0),
          besties: (t.latest_besties_reel_media || 0) > (t.seen || 0),
        }));
      // Like Instagram: unseen first, ranked order kept inside each part.
      trayData = { ts: Date.now(), items: [...items.filter((i) => !i.seen), ...items.filter((i) => i.seen)] };
      renderTray();
    } catch (err) {
      trayFailed = Date.now();
      if (trayEl && !trayData) trayEl.hidden = true;
    } finally {
      trayLoading = false;
    }
  }

  function makeTray() {
    const t = document.createElement('div');
    t.className = 'igx-stories';
    t.innerHTML = '<div class="igx-st-scroll"></div>'
      + '<button type="button" class="igx-st-arrow igx-st-prev" aria-label="' + globalThis.igxT('prev') + '">' + ICON_CHEV + '</button>'
      + '<button type="button" class="igx-st-arrow igx-st-next" aria-label="' + globalThis.igxT('next') + '">' + ICON_CHEV + '</button>';
    const sc = t.firstElementChild;
    const arrows = () => {
      t.classList.toggle('igx-st-canprev', sc.scrollLeft > 2);
      t.classList.toggle('igx-st-cannext', sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 2);
    };
    sc.addEventListener('scroll', arrows, { passive: true });
    t._arrows = arrows;
    for (const [cls, dir] of [['.igx-st-prev', -1], ['.igx-st-next', 1]]) {
      t.querySelector(cls).addEventListener('click', (e) => {
        e.preventDefault();
        sc.scrollBy({ left: dir * Math.max(120, sc.clientWidth - 120), behavior: 'smooth' });
      });
    }
    return t;
  }

  function renderTray() {
    if (!trayEl || !trayData) return;
    trayEl.hidden = false;
    const sc = trayEl.firstElementChild;
    sc.replaceChildren(...trayData.items.map((it) => {
      const a = document.createElement('a');
      a.className = 'igx-st' + (it.seen ? ' igx-st-seen' : '') + (it.besties ? ' igx-st-besties' : '');
      a.href = '/stories/' + encodeURIComponent(it.user) + '/';
      a.title = it.user;
      const ring = document.createElement('span');
      ring.className = 'igx-st-ring';
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      if (it.pic) img.src = it.pic;
      ring.append(img);
      const name = document.createElement('span');
      name.className = 'igx-st-name';
      name.textContent = it.user;
      a.append(ring, name);
      return a;
    }));
    if (!trayData.items.length) trayEl.hidden = true;
    requestAnimationFrame(trayEl._arrows);
  }

  // Put our tray at the top of the column (full column width, like Instagram's).
  function ensureTray(head, col) {
    let content = head.parentElement; // holds header + posts
    let host = content.parentElement;
    while (host && host !== col && host.getBoundingClientRect().width <= content.getBoundingClientRect().width + 1) {
      content = host;
      host = host.parentElement;
    }
    if (!host) return;
    if (!trayEl) {
      trayEl = makeTray();
      if (trayData) renderTray();
    }
    if (trayEl.parentElement !== host || trayEl.nextElementSibling !== content) {
      host.insertBefore(trayEl, content);
      trayEl._arrows();
    }
    loadTray();
  }

  function dropTray() {
    if (trayEl && trayEl.isConnected) trayEl.remove();
  }

  // ---------- 5. posts ----------
  function mediaRatio(article) {
    for (const m of article.querySelectorAll('video, img')) {
      if (m.getBoundingClientRect().width < 200) continue; // avatars, icons
      if (m.tagName === 'VIDEO' && m.videoWidth) return m.videoHeight / m.videoWidth;
      if (m.tagName === 'IMG' && m.naturalWidth) return m.naturalHeight / m.naturalWidth;
    }
    return null;
  }

  function tweakPost(article, col, postW) {
    // Let every wrapper between the article and the posts column take the new width.
    if (!article.hasAttribute('data-igx-post')) {
      article.setAttribute('data-igx-post', '');
      for (let e = article; e && e.parentElement !== col.firstElementChild; e = e.parentElement) {
        if (e.getBoundingClientRect().width < postW - 20) e.setAttribute('data-igx-pw', '');
      }
    }
    // Media frame: Instagram fixes it with a px padding-bottom (4:5). Follow the real ratio.
    let box = article._igxBox;
    if (!box || !box.isConnected) {
      box = [...article.querySelectorAll('div')].find((d) => parseFloat(getComputedStyle(d).paddingBottom) > 100);
      article._igxBox = box || null;
    }
    if (!box) return;
    const ratio = mediaRatio(article);
    if (!ratio) return;
    const maxH = innerHeight - MEDIA_MAX_GAP;
    const wanted = Math.round((postW - 2) * ratio);
    const h = Math.min(wanted, maxH);
    const v = h + 'px';
    if (box.style.getPropertyValue('padding-bottom') !== v) box.style.setProperty('padding-bottom', v, 'important');
    box.toggleAttribute('data-igx-contain', wanted > maxH);
  }

  function tweakPosts(row) {
    const col = row.children[0];
    if (!col || !col.firstElementChild) return;
    const postW = Math.min(POST_WIDTH, Math.floor(col.getBoundingClientRect().width));
    const v = postW + 'px';
    if (document.documentElement.style.getPropertyValue('--igx-post-w') !== v) {
      document.documentElement.style.setProperty('--igx-post-w', v);
    }
    row.querySelectorAll('article').forEach((a) => tweakPost(a, col, postW));
  }

  // ---------- main loop ----------
  function run() {
    queued = false;
    ensureSwitcher();
    const row = findFeedRow();
    document.documentElement.toggleAttribute('data-igx-home', !!row);
    if (!row) { dropTray(); return; }
    setNavVar();
    const col = row.children[0];
    tweakColumn(col);
    const head = findSubpageHeader(col);
    document.documentElement.setAttribute('data-igx-layout', head ? 'subpage' : 'tabs');
    if (head) {
      if (!head.hasAttribute('data-igx-subhead')) head.setAttribute('data-igx-subhead', '');
      ensureTray(head, col);
    } else dropTray();
    tweakPosts(row);
  }

  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  // Media dimensions become known only after loading.
  document.addEventListener('loadedmetadata', schedule, true);
  document.addEventListener('load', schedule, true);
  // Instagram fires 'resize' when the nav expands on hover; only reset the
  // measurements when the window size really changed.
  let lastSize = innerWidth + 'x' + innerHeight;
  window.addEventListener('resize', () => {
    const size = innerWidth + 'x' + innerHeight;
    if (size !== lastSize) { lastSize = size; navCollapsed = null; switcherPos = null; }
    schedule();
  });
  window.addEventListener('popstate', schedule);
  // Back from a story (or another tab): refresh the seen state of our tray.
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pageshow', schedule);
  setInterval(() => { if (switcher) ensureSwitcher(); }, 500); // URL changes without DOM mutations
})();
