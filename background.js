// Update notifier. The extension is distributed through GitHub releases, so
// Chrome never updates it by itself: we only check a small public JSON file
// (version.json) and tell the user that a new version exists. Data only — no
// code is ever loaded from the network.
//
// Empty UPDATE_URL = update checks disabled (also used for a Web Store build).
const UPDATE_URL = 'https://raw.githubusercontent.com/ulquorium/following-first/main/version.json';
// e.g. 'https://raw.githubusercontent.com/<owner>/<repo>/main/version.json'

const ALARM = 'update-check';
const FIRST_CHECK_MIN = 1;
const CHECK_EVERY_MIN = 6 * 60;
const BADGE_UPDATE = { text: '↑', color: '#1e8e3e' };
const BADGE_NEW = { text: 'NEW', color: '#1a73e8' };

const t = (key, subs) => chrome.i18n.getMessage(key, subs);
const lang = () => t('langCode') || 'en';
const currentVersion = () => chrome.runtime.getManifest().version;

// Segment by segment, as numbers: 1.10.0 > 1.9.0.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function pickNotes(notes) {
  if (!notes || typeof notes !== 'object') return '';
  return notes[lang()] || notes.en || Object.values(notes)[0] || '';
}

// Only plain data is accepted from version.json.
function parseRemote(j) {
  if (!j || typeof j.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(j.version)) return null;
  if (typeof j.url !== 'string' || !/^https:\/\//.test(j.url)) return null;
  const notes = {};
  if (j.notes && typeof j.notes === 'object') {
    for (const [k, v] of Object.entries(j.notes)) if (typeof v === 'string') notes[k] = v.slice(0, 2000);
  }
  return { version: j.version, url: j.url, notes };
}

function scheduleChecks() {
  if (!UPDATE_URL) { chrome.alarms.clear(ALARM); return; }
  chrome.alarms.create(ALARM, { delayInMinutes: FIRST_CHECK_MIN, periodInMinutes: CHECK_EVERY_MIN });
}

async function updateBadge() {
  const { remote, seenVersion } = await chrome.storage.local.get(['remote', 'seenVersion']);
  let b = null;
  if (UPDATE_URL && remote && compareVersions(remote.version, currentVersion()) > 0) b = BADGE_UPDATE;
  else if (seenVersion && seenVersion !== currentVersion()) b = BADGE_NEW;
  await chrome.action.setBadgeText({ text: b ? b.text : '' });
  if (b) await chrome.action.setBadgeBackgroundColor({ color: b.color });
  if (b && chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

async function checkForUpdate() {
  if (!UPDATE_URL) return;
  let remote;
  try {
    const r = await fetch(UPDATE_URL + (UPDATE_URL.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    remote = parseRemote(await r.json());
  } catch (e) {
    return; // offline, DNS, bad JSON… try again next time
  }
  if (!remote) return;
  await chrome.storage.local.set({ remote, checkedAt: Date.now() });
  if (compareVersions(remote.version, currentVersion()) > 0) {
    const { notifiedVersion } = await chrome.storage.local.get('notifiedVersion');
    if (notifiedVersion !== remote.version) {
      await chrome.storage.local.set({ notifiedVersion: remote.version });
      try {
        await chrome.notifications.create('update-' + remote.version, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: t('notifTitle', [remote.version]),
          message: pickNotes(remote.notes) || t('notifDefault'),
          priority: 0,
        });
      } catch (e) { /* notifications blocked by the OS — the badge is still there */ }
    }
  }
  await updateBadge();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // After a fresh install there is nothing "new"; after an update the badge
  // shows NEW until the popup is opened (it stores seenVersion).
  // (Some reload paths report 'install' with old data still in storage, so
  // only a really fresh install — no seenVersion yet — counts as "seen".)
  const { seenVersion } = await chrome.storage.local.get('seenVersion');
  if (!seenVersion) {
    await chrome.storage.local.set({ seenVersion: reason === 'update' ? '0' : currentVersion() });
  }
  scheduleChecks();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleChecks();
  updateBadge();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) checkForUpdate();
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('update-')) return;
  chrome.notifications.clear(id);
  const { remote } = await chrome.storage.local.get('remote');
  if (remote && remote.url) chrome.tabs.create({ url: remote.url });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg === 'check-now') {
    checkForUpdate().finally(() => reply({ enabled: !!UPDATE_URL }));
    return true;
  }
  if (msg === 'refresh-badge') {
    updateBadge().finally(() => reply({ ok: true }));
    return true;
  }
  if (msg === 'status') {
    reply({ enabled: !!UPDATE_URL });
    return false;
  }
  return false;
});
