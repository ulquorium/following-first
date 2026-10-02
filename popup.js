(() => {
  const t = (key, subs) => chrome.i18n.getMessage(key, subs);
  const lang = t('langCode') || 'en';
  const version = chrome.runtime.getManifest().version;
  const $ = (id) => document.getElementById(id);
  let changelog = [];

  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  $('version').textContent = t('versionLabel', [version]);

  function compareVersions(a, b) {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  const fmtDate = (ts) => new Date(ts).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const itemsOf = (entry) => (entry && (entry[lang] || entry.en)) || [];

  function list(items) {
    const ul = document.createElement('ul');
    for (const s of items) {
      const li = document.createElement('li');
      li.textContent = s;
      ul.append(li);
    }
    return ul;
  }

  // "What's new": the entry of the installed version; full history on demand.
  function renderChangelog() {
    const cur = changelog.find((e) => e.version === version) || changelog[0];
    const items = itemsOf(cur);
    $('current-notes').replaceChildren(items.length ? list(items) : Object.assign(document.createElement('div'), { className: 'muted', textContent: t('noNotes') }));
    const hist = $('history');
    hist.replaceChildren();
    for (const e of changelog) {
      if (e === cur) continue;
      hist.append(Object.assign(document.createElement('div'), { className: 'ver', textContent: e.version }), list(itemsOf(e)));
    }
    $('history-toggle').hidden = changelog.length < 2;
  }

  $('history-toggle').addEventListener('click', () => {
    const h = $('history');
    h.hidden = !h.hidden;
    $('history-toggle').textContent = t(h.hidden ? 'fullHistory' : 'hideHistory');
  });

  async function renderStatus(enabled) {
    const { remote, checkedAt } = await chrome.storage.local.get(['remote', 'checkedAt']);
    const newer = enabled && remote && compareVersions(remote.version, version) > 0;
    $('update').hidden = !newer;
    if (newer) {
      $('update-title').textContent = t('updateAvailable', [remote.version]);
      const n = remote.notes || {};
      $('update-notes').textContent = n[lang] || n.en || '';
      $('update-link').href = remote.url;
    }
    $('check').hidden = !enabled;
    $('checked').textContent = !enabled ? t('checksOff')
      : checkedAt ? t('checkedAt', [fmtDate(checkedAt)]) : t('neverChecked');
  }

  $('check').addEventListener('click', async () => {
    const b = $('check');
    b.disabled = true;
    b.textContent = t('checking');
    const res = await chrome.runtime.sendMessage('check-now').catch(() => null);
    await renderStatus(!!(res && res.enabled));
    b.disabled = false;
    b.textContent = t('checkNow');
  });

  (async () => {
    // Opening the popup = the user has seen this version → clears the NEW badge.
    await chrome.storage.local.set({ seenVersion: version });
    chrome.runtime.sendMessage('refresh-badge').catch(() => {});
    const status = await chrome.runtime.sendMessage('status').catch(() => null);
    await renderStatus(!!(status && status.enabled));
    try {
      changelog = await (await fetch(chrome.runtime.getURL('changelog.json'))).json();
    } catch (e) {
      changelog = [];
    }
    renderChangelog();
  })();
})();
