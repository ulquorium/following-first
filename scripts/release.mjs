#!/usr/bin/env node
// Release helper. No dependencies — plain Node 18+.
//
//   node scripts/release.mjs 1.11.0          full release: bump versions, check, zip, commit, tag
//   node scripts/release.mjs 1.11.0 --no-git same, without the commit and the tag
//   node scripts/release.mjs --build         only build dist/<name>-<version>.zip (used by CI)
//   node scripts/release.mjs --build --store Web Store build: update checks switched off
//   node scripts/release.mjs --notes 1.11.0  print release notes (markdown) from changelog.json
//   node scripts/release.mjs --setup owner/repo   one-time: point UPDATE_URL and version.json at a GitHub repo
//
// Before a release add the new version as the FIRST entry of changelog.json
// (en / uk / ru). Then run this script and `git push --follow-tags`.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The only line that differs between the extensions (the script is shared).
const ZIP_NAME = 'instagram-follow-lists';
const LANGS = ['en', 'uk', 'ru'];
// What goes into the zip: the extension itself, nothing else.
const EXCLUDE_DIRS = new Set(['scripts', 'dist', 'docs', 'store', '.github', '.git', 'node_modules']);
const EXCLUDE_FILES = new Set(['version.json', 'package.json', 'package-lock.json']);
const INCLUDE_EXT = new Set(['.js', '.css', '.html', '.json', '.png', '.svg']);

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const positional = args.filter((a) => !a.startsWith('--'));

const fail = (msg) => { console.error('\n✖ ' + msg + '\n'); process.exit(1); };
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const writeJson = (p, v) => writeFileSync(join(ROOT, p), JSON.stringify(v, null, 2) + '\n');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ---------- files ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const rel = relative(ROOT, p).split(sep).join('/');
    if (statSync(p).isDirectory()) {
      if (!EXCLUDE_DIRS.has(name)) walk(p, out);
    } else if (!(dir === ROOT && EXCLUDE_FILES.has(name)) && INCLUDE_EXT.has(extname(name))) {
      out.push(rel);
    }
  }
  return out.sort();
}

function checkSyntax(files) {
  for (const f of files) {
    if (f.endsWith('.js')) {
      try {
        execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' });
      } catch (e) {
        fail('Syntax error in ' + f + ':\n' + String(e.stderr || e.message));
      }
    }
    if (f.endsWith('.json')) {
      try { readJson(f); } catch (e) { fail('Invalid JSON in ' + f + ': ' + e.message); }
    }
  }
  console.log('✓ syntax OK (' + files.length + ' files)');
}

// Every locale must have the same message keys, every changelog entry all languages.
function checkLocales() {
  const dirs = readdirSync(join(ROOT, '_locales'));
  const keys = Object.fromEntries(dirs.map((d) => [d, Object.keys(readJson('_locales/' + d + '/messages.json')).sort()]));
  const all = [...new Set(Object.values(keys).flat())];
  for (const d of dirs) {
    const miss = all.filter((k) => !keys[d].includes(k));
    if (miss.length) fail('_locales/' + d + '/messages.json is missing: ' + miss.join(', '));
  }
  for (const e of readJson('changelog.json')) {
    const miss = LANGS.filter((l) => !Array.isArray(e[l]) || !e[l].length);
    if (miss.length) fail('changelog.json entry ' + e.version + ' has no text for: ' + miss.join(', '));
  }
  console.log('✓ locales OK (' + dirs.join(', ') + ')');
}

// ---------- minimal zip writer (deflate, no dependencies) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries /* [{ name, data: Buffer }] */) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function build({ store }) {
  const version = readJson('manifest.json').version;
  const files = walk(ROOT);
  checkSyntax(files);
  checkLocales();
  const entries = files.map((f) => {
    let data = readFileSync(join(ROOT, f));
    if (store && f === 'background.js') {
      // Web Store updates itself — no own update notifications there.
      const src = data.toString('utf8');
      const off = src.replace(/^const UPDATE_URL = .*$/m, "const UPDATE_URL = '';");
      if (off === src && !/^const UPDATE_URL = '';$/m.test(src)) fail('UPDATE_URL line not found in background.js');
      data = Buffer.from(off, 'utf8');
    }
    return { name: f, data };
  });
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const out = join('dist', ZIP_NAME + '-' + version + (store ? '-store' : '') + '.zip');
  writeFileSync(join(ROOT, out), makeZip(entries));
  console.log('✓ built ' + out + ' (' + entries.length + ' files)');
  return out;
}

// ---------- release notes ----------
function notesFor(entry) {
  const notes = {};
  for (const l of LANGS) if (Array.isArray(entry[l])) notes[l] = entry[l].map((s) => '• ' + s).join('\n');
  return notes;
}

function markdownNotes(version) {
  const entry = readJson('changelog.json').find((e) => e.version === version);
  if (!entry) fail('No changelog.json entry for ' + version);
  const titles = { en: 'English', uk: 'Українська', ru: 'Русский' };
  return LANGS.filter((l) => entry[l]).map((l) => '### ' + titles[l] + '\n' + entry[l].map((s) => '- ' + s).join('\n')).join('\n\n')
    + '\n\n**Install / update:** unzip over the extension folder, then click ↻ (Reload) in `chrome://extensions`.\n';
}

function githubRepo() {
  try {
    const url = git('remote', 'get-url', 'origin');
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
    return m ? m[1] + '/' + m[2] : null;
  } catch (e) {
    return null;
  }
}

// ---------- main ----------
if (flag('--notes')) {
  process.stdout.write(markdownNotes((positional[0] || '').replace(/^v/, '')));
  process.exit(0);
}

if (flag('--setup')) {
  const repo = positional[0] || '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('Usage: node scripts/release.mjs --setup owner/repo');
  const url = 'https://raw.githubusercontent.com/' + repo + '/main/version.json';
  const src = readFileSync(join(ROOT, 'background.js'), 'utf8');
  const out = src.replace(/^const UPDATE_URL = .*$/m, "const UPDATE_URL = '" + url + "';");
  if (out === src && !src.includes(url)) fail('UPDATE_URL line not found in background.js');
  writeFileSync(join(ROOT, 'background.js'), out);
  let v;
  if (existsSync(join(ROOT, 'version.json'))) {
    v = readJson('version.json');
  } else {
    const version = readJson('manifest.json').version;
    const entry = readJson('changelog.json').find((e) => e.version === version);
    v = { version, url: '', notes: entry ? notesFor(entry) : {} };
  }
  v.url = 'https://github.com/' + repo + '/releases/tag/v' + v.version;
  writeJson('version.json', v);
  console.log('✓ UPDATE_URL = ' + url + '\n✓ version.json url = ' + v.url);
  process.exit(0);
}

if (flag('--build')) {
  build({ store: flag('--store') });
  process.exit(0);
}

const version = (positional[0] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail('Usage: node scripts/release.mjs <X.Y.Z> [--no-git]');

const manifest = readJson('manifest.json');
if (compareVersions(version, manifest.version) <= 0) fail(version + ' is not newer than the current ' + manifest.version);

const changelog = readJson('changelog.json');
if (!changelog[0] || changelog[0].version !== version) {
  fail('Add an entry for ' + version + ' as the FIRST item of changelog.json (en / uk / ru) first.');
}
const missing = LANGS.filter((l) => !Array.isArray(changelog[0][l]) || !changelog[0][l].length);
if (missing.length) fail('changelog.json entry ' + version + ' has no text for: ' + missing.join(', '));

const useGit = !flag('--no-git');
const repo = githubRepo();
if (useGit) {
  try { git('rev-parse', '--is-inside-work-tree'); } catch (e) { fail('Not a git repository (use --no-git to skip commit/tag).'); }
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('Release from the main branch (version.json is read from main).');
  if (git('tag', '-l', 'v' + version)) fail('Tag v' + version + ' already exists.');
}

// Release page of exactly this version (the tag exists from the first push,
// so the link never points to an older release).
const oldVersionJson = existsSync(join(ROOT, 'version.json')) ? readJson('version.json') : null;
const base = repo ? 'https://github.com/' + repo
  : oldVersionJson && (oldVersionJson.url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+/) || [])[0];
if (!base) fail('Cannot find the GitHub repository: add a GitHub "origin" remote.');

manifest.version = version;
writeJson('manifest.json', manifest);
writeJson('version.json', { version, url: base + '/releases/tag/v' + version, notes: notesFor(changelog[0]) });
console.log('✓ manifest.json and version.json → ' + version);

const bg = readFileSync(join(ROOT, 'background.js'), 'utf8');
if (/^const UPDATE_URL = '';$/m.test(bg)) {
  console.warn('⚠ UPDATE_URL in background.js is empty — users will NOT be notified.\n  Set it to ' +
    (repo ? 'https://raw.githubusercontent.com/' + repo + '/main/version.json' : 'the raw URL of version.json'));
}

build({ store: false });

if (useGit) {
  git('add', '-A');
  git('commit', '-m', 'Release v' + version);
  git('tag', '-a', 'v' + version, '-m', 'v' + version);
  console.log('✓ committed and tagged v' + version);
  console.log('\nNext: git push --follow-tags\n');
}
