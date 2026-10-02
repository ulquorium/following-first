// Settings that follow the user: JSON values in chrome.storage.sync (synced by
// Chrome between the user's computers when Chrome sync is on; otherwise it
// behaves like local storage). Shared verbatim with the sibling extension.
//
// chrome.storage.sync allows 8 KB per item and 100 KB in total, so a value is
// stored as a JSON string split into chunks:
//   "<name>"   = { n: <chunks>, len: <json length> }
//   "<name>.0" … "<name>.<n-1>" = string pieces
// All pieces are written in one set() call. A value that doesn't fit is removed
// from sync, so an outdated synced copy never wins over local data.
//
//   await syncStore.read(name)        → value, or undefined
//   await syncStore.write(name, value) → true / false (not stored)
//   syncStore.onChange(name, cb)      → cb(value) when it changes on another tab or computer
globalThis.syncStore = globalThis.syncStore || (() => {
  const area = chrome.storage.sync;
  const PIECE = 1800; // chars; worst case (escaped / 3-byte UTF-8) stays under 8 KB per item
  const echoes = new Map(); // name → Set of JSON strings we wrote ourselves
  const last = new Map();   // name → JSON this page last read, wrote or received

  const chunkKeys = (all, name) => Object.keys(all).filter((k) => k.startsWith(name + '.') && /^\d+$/.test(k.slice(name.length + 1)));

  function assemble(all, name) {
    const meta = all[name];
    if (!meta || typeof meta.n !== 'number') return undefined;
    let json = '';
    for (let i = 0; i < meta.n; i++) {
      const piece = all[name + '.' + i];
      if (typeof piece !== 'string') return undefined; // other pieces still arriving
      json += piece;
    }
    if (json.length !== meta.len) return undefined;
    try { return { json, value: JSON.parse(json) }; } catch (e) { return undefined; }
  }

  async function read(name) {
    try {
      const r = assemble(await area.get(null), name);
      if (r) last.set(name, r.json);
      return r ? r.value : undefined;
    } catch (e) {
      return undefined;
    }
  }

  async function remove(name) {
    try {
      const all = await area.get(null);
      const keys = chunkKeys(all, name);
      if (all[name]) keys.push(name);
      if (keys.length) await area.remove(keys);
    } catch (e) { /* ignore */ }
  }

  async function write(name, value) {
    const json = JSON.stringify(value);
    const items = { [name]: { n: Math.ceil(json.length / PIECE), len: json.length } };
    for (let i = 0; i * PIECE < json.length; i++) items[name + '.' + i] = json.slice(i * PIECE, (i + 1) * PIECE);
    if (!echoes.has(name)) echoes.set(name, new Set());
    echoes.get(name).add(json);
    last.set(name, json);
    try {
      await area.set(items);
      const stale = chunkKeys(await area.get(null), name).filter((k) => !(k in items));
      if (stale.length) await area.remove(stale);
      return true;
    } catch (e) {
      // Quota exceeded or sync unavailable: drop the synced copy, local data stays the truth.
      echoes.get(name).delete(json);
      await remove(name);
      return false;
    }
  }

  function onChange(name, cb) {
    chrome.storage.onChanged.addListener(async (ch, areaName) => {
      if (areaName !== 'sync') return;
      if (!Object.keys(ch).some((k) => k === name || k.startsWith(name + '.'))) return;
      let r;
      try { r = assemble(await area.get(null), name); } catch (e) { return; }
      if (!r || r.json === last.get(name)) return;
      const mine = echoes.get(name);
      if (mine && mine.has(r.json)) { mine.delete(r.json); return; } // our own older write coming back
      last.set(name, r.json);
      cb(r.value);
    });
  }

  return { read, write, onChange };
})();
