# Following First (for Instagram) — notes for Claude

Formerly "Instagram Follow Lists+" (repo renamed to `ulquorium/following-first` in 1.12.0).
The idea: Instagram as a social network again — you decide what you see (the
Following feed, your own groups), not the algorithm. Sibling: Subscriptions
First for YouTube.

A personal Chrome extension (Manifest V3, no build step, plain JS/CSS) that
restyles and extends instagram.com. The owner is not a developer, so
features are requested as UI changes. Talk to them in Ukrainian. The
extension's UI is in **English, Ukrainian and Russian**: every new string
needs all three (keep them short — check widths, e.g. the 104px indicator).

## Files

| File | Runs | Purpose |
|---|---|---|
| `manifest.json` | — | MV3 manifest. Permissions: `storage`, `alarms`, `notifications`. Name/description from `_locales`. Two content scripts on `https://www.instagram.com/*`. |
| `i18n.js` | `document_start`, before `home.js` | `igxT(key, …args)` / `igxLocale()` for content scripts: en/uk/ru by Instagram's `<html lang>`. Shared with `content.js` (same content-script world). |
| `home.js` | `document_start` | Home page: Following feed by default, feed switcher under the logo, pinned right sidebar, centered column, smaller stories, bigger uncropped posts. |
| `sync-store.js` | `document_idle`, before `content.js` | `syncStore.read/write/onChange`: JSON values in `chrome.storage.sync`, split into ≤8 KB chunks. Shared verbatim with the YouTube extension. |
| `content.js` | `document_idle` | Followers/Following modal: size, groups, filters, "follows you" indicator, followers sync. |
| `activity.js` | `document_idle`, after `content.js` | Your activity → Interactions: big borderless grid, chips, "Saved" (own grid), tile buttons send / unlike / unsave, "Saved" in the left nav, one-shot post actions. |
| `styles.css` | with `content.js` | All styles for both scripts (injected on every Instagram page). |
| `background.js` | service worker | Update checks (version.json), badges ↑ / NEW, system notification. |
| `popup.html/.css/.js` | toolbar popup | Version, available update, "What's new" from `changelog.json`, Check button. Light/dark via `prefers-color-scheme`. |
| `changelog.json` | — | `[{ version, en: [], uk: [], ru: [] }]`, newest first. Source for popup, version.json notes and release notes. |
| `_locales/{en,uk,ru}/messages.json` | — | Popup / notification / manifest strings. `langCode` picks the notes language (not `getUILanguage()`). |
| `version.json` | repo root, not in the zip | What users' extensions read: `{ version, url, notes: {en,uk,ru} }`. Written only by the release script. |
| `scripts/release.mjs` | Node 18+, no deps | `--setup owner/repo`, `<X.Y.Z>` release (bump, check, zip, commit, tag), `--build [--store]`, `--notes`. |
| `.github/workflows/release.yml` | on tag `v*` | Builds the zip and creates the GitHub release with notes from the changelog. |

Bump `version` in `manifest.json` for every delivered change (semver-ish: patch
for fixes, minor for features). Current: see `manifest.json`. Release through
`scripts/release.mjs` (see README.uk.md, "Випуск нової версії"): add the changelog entry first.

## Features and how they work

### Followers / Following modal (`content.js`)
- **Detection:** any `div[role="dialog"]` containing a text input (search) and
  ≥2 profile links `a[href^="/"][role="link"]`. The URL does *not* change when
  the modal opens, so don't rely on `/followers/` paths. On detection the
  dialog gets `data-ig-tall` and a `_igx` state object.
- **Size:** full viewport height (CSS) and original width + `EXTRA_WIDTH`
  (288px, set inline by JS, capped at `100vw - 32px`). Instagram gives inner
  list containers fixed pixel widths, so every ancestor of a row up to the
  dialog is marked `data-igx-full` and forced to `width: 100%`.
- **Row anatomy:** `findRow()` takes the highest ancestor of a profile link
  that still holds only that one user (stopping at blocks that contain the
  search input or are taller than 100px — a search with a single result is
  "one user" all the way up to the dialog), descends single-child wrappers, and
  uses the row's **last** button as the action (Following / Follow /
  Remove). Buttons are `button` *or* `[role="button"]` (Followers rows use
  divs, and also have an inline "· Follow" next to the username and a story
  avatar that is a role=button — never pick the first button). Inserted
  before the action wrapper, in order: group chip (`.igx-chip`), mute group
  (`.igx-mute`), follows-you indicator (`.igx-fb`). Chip = "tag", indicator
  + Instagram's button = "follow group".
  Rows get `data-igx-row` (separator via `::after`), the name/bio block gets
  `data-igx-info` (truncation).
- **Spacing rule:** 12px between info → chip → mute group → indicator →
  Following button. The action button (any of Follow / Following / Remove)
  is forced to 104px so rows don't jump on (un)follow.
  Instagram's button wrapper already has 12px on its left, so `.igx-fb` has
  only a left margin. Indicator is 104×32px, radius 8px, same as the
  Following button, but stroke instead of fill.
- **Groups:** user-defined (create / rename / recolor / delete) in the manage
  panel (gear icon in the filter bar, or "Manage groups…" in a chip menu).
  Deleting a group untags its members (two-click confirm).
- **Filters:** pill bar above the list. "All" = Instagram's native list with
  its normal lazy loading. A group pill hides the native list and its loaders
  (siblings after our list get `data-igx-hide`) and renders `.igx-list` from
  saved data only — **zero network requests**. The modal's search input also
  filters the group list locally. "All" shows the list total, taken from the
  profile link that opened the modal (capture-phase click on
  `a[href$="/followers/"|"/following/"]`, `countFromLink`: `[title]` digits or
  the displayed number like "12.5K"; used if the dialog appears within 10 s).
  Opened any other way → no number.
- **Follows-you indicator:** "Follows" (primary text) / "Not following"
  (≈45% white, softer stroke) / "—" or "Checking…" before data exists.
  Based on the owner's full followers list (see Sync).

- **Mute group:** two 32px icon toggles — posts (picture icon) and stories
  (ring icon). Normal icon = shown in my feed, crossed + dimmed = muted.
  Hidden (`visibility`) for accounts I don't follow. Status comes from
  `GET /api/v1/friendships/show/{pk}/` (`muting` = posts,
  `is_muting_reel` = stories) — there is no bulk endpoint on web
  (`show_many` returns HTML; the Muted accounts settings page doesn't load a
  list). So: an `IntersectionObserver` queues only rows on screen, one
  request at a time with 1.5–2.5 s gaps, 60 s back-off on errors, results
  cached for 7 days in `mutes`. Icons stay clickable while their status is
  still loading: a click fetches that one status immediately (skipping the
  queue) and then flips it. Toggling: `POST /api/v1/friendships/
  {mute|unmute}_posts_or_story_from_follow/` with
  `target_posts_author_id=pk` or `target_reel_author_id=pk`, headers
  `x-csrftoken` (cookie `csrftoken`), `x-ig-app-id`, form content type;
  success = `{"status":"ok"}`. Verified live on one account (mute + revert).

### Followers / following sync (`runSync` in `content.js`)
- Endpoint: `GET /api/v1/friendships/{ds_user_id}/followers/?count=50&max_id=…`
  with headers `x-ig-app-id: 936619743392459`, `x-requested-with: XMLHttpRequest`,
  `credentials: 'include'`. User id comes from the `ds_user_id` cookie.
  Returns ~19 users per page regardless of `count`.
- Also syncs my **following** list the same way (`/following/`) into
  `following.users` = `{ username: pk }` — needed for mute (pk) and ~475
  accounts ≈ 25 requests. Both lists refresh at most once a day.
- Pace: 1.5–3.5 s random delay between pages; stops on any non-200 and keeps
  old data. Runs automatically when a follow modal opens and data is older
  than 24h. The ↻ button (`refreshEverything`) re-fetches both lists and clears
  all cached mute statuses, so visible rows reload them.
  Its tooltip (`data-tip` → CSS `::after`, shown instantly) shows the last
  successful update (`lastSync = { ts, manual }`, date + manual/auto) and
  the list counts. A `syncLock` timestamp in storage stops
  parallel syncs across tabs.
- **Rate-limit caution:** keep request volume low and human-paced. Never add
  per-user requests (e.g. `friendships/show/{id}`) in loops. Prefer data
  already in the DOM or in storage.

### Home page (`home.js`)
- **Default feed:** bare `/` → `location.replace('/?variant=following')`
  at document_start. In-app navigation to `/` (logo/Home) is caught by a
  400ms URL poll that clicks the Following tab (or, in the 'subpage' layout,
  `location.replace`s as soon as the feed renders without tabs —
  `feedWithoutTabs()`). `?variant=home` (user chose the algorithmic feed) is
  left alone. Closing a story viewer also lands on bare `/` (SPA).
- **Two Instagram layouts** (`<html data-igx-layout>`), same result for both:
  - `tabs`: "For you" / "Following" tabs above the feed, native stories tray
    on both feeds.
  - `subpage`: `/` is For you (native tray); `/?variant=following` is its own
    page with a back arrow + title (`a[href="/"]` inside the column) and **no
    stories**. SPA navigation via `history.pushState` + `popstate` does not
    route, so switching feeds is a full page load. `findSubpageHeader()` marks
    the title block `data-igx-subhead` (hidden) and `ensureTray()` inserts our
    own `.igx-stories` tray at the top of the column (first ancestor wider
    than the posts block, bounded by the column). Data: one
    `GET /api/v1/feed/reels_tray/` per page view (reused 2 min, refreshed on
    `visibilitychange`/`pageshow`), muted reels dropped, unseen first
    (ranked order kept). Rings: gradient = unseen, grey = seen, green = close
    friends. Sized to match the zoomed native tray (60px items, 69.5px pitch,
    ~50px avatar, 11px labels, 24px gap to posts); arrows scroll the row.
    Items are plain links to `/stories/{user}/` (full load; Instagram shows
    its "View as …?" prompt first — native tray clicks can't be reproduced
    from a content script).
- **Feed switcher:** Instagram's tabs block (fixed header + 70px spacer) is
  marked `data-igx-tabswrap` and hidden, but kept in the DOM — switching
  clicks those hidden tabs (`feedTabs()`: DOM order `[0] For you,
  [1] Following`). Our replacement is `.igx-feednav`: two plain 40px icon
  buttons, no border or background (people = Following, sparkles =
  Algorithmic), fixed under the Instagram logo in the left nav; the active
  one is primary-text colored, the other muted (from `?variant=`). Off the
  home page a click navigates to `/?variant=…`. Its position is measured
  **once** while the nav is collapsed (`switcherPos`): on hover the logo
  shrinks instantly, before the nav visibly widens. Instagram also fires
  `resize` on nav hover without the window changing — measurements reset
  only when `innerWidth × innerHeight` really changes.
- **Right sidebar:** `main > row` with 2 children where the 2nd contains
  `a[href="/explore/people/"]` (language-independent). Sidebar gets
  `data-igx-rsb` (fixed to the right edge, 383px wide, full height),
  the row gets `data-igx-feedrow`, `<html>` gets `data-igx-home` (all home
  CSS is scoped to it, so nothing applies on narrow layouts without the
  sidebar).
- **Centered column:** row padding = collapsed left-nav width + 24px on the
  left, 383 + 24px on the right; column `max-width: 930px`. The left nav
  expands on hover (72 → ~238px) and overlays the page: center against the
  **minimum** nav width ever measured (reset on resize), otherwise the feed
  jumps on hover.
- **Stories:** the tray (first ancestor of the story `ul` with ≥2 children,
  `data-igx-tray`) gets `zoom: 0.667` + `height: 124px` (Instagram's tray
  height; visually ≈83px). Instagram measures the wider zoomed box and
  renders more circles itself. Ancestors up to the column get
  `data-igx-autoh` (height auto). Labels are counter-scaled (17px → ≈11px).
  Don't let the tray stretch to its parent — zoom then doesn't shrink it.
- **Posts:** `POST_WIDTH` (600px, Instagram: 470) via `--igx-post-w`, capped by
  the column width. Wrappers between each `article` and the posts column
  narrower than that get `data-igx-pw`; inline widths
  `calc(-2px + min(470px, 100vw))` are overridden by an attribute selector.
  The media frame is a div with a **px** `padding-bottom` (4:5 = 585px);
  `tweakPost()` sets it to `width × (natural height / width)` of the first
  media (video `videoWidth/Height`, img `naturalWidth/Height`), capped at
  `innerHeight - 40`. When capped the frame gets `data-igx-contain`
  (`object-fit: contain`). Media sizes are known only after load, so
  `load`/`loadedmetadata` are listened to in the capture phase.
  Carousels work: Instagram positions slides from the measured width.
  The feed is virtualized; items are measured by Instagram, taller items
  are fine.

### Search page (`tweakSearch` in `home.js`)
- `/explore/search/…` (`<html data-igx-search>`): the search field spans the
  whole content column, sits 12px lower and is `position: sticky` (white /
  `--ig-primary-background` band) so it never scrolls away — on the explore
  grid and on the results list. The "For you / Not personalized" tabs
  (`[role="tablist"]` block) get `data-igx-searchtabs` → hidden; Instagram's
  default selection stays.
- Two DOM layouts. Explore: column > [search row, tabs block, grid]. Results
  (after typing): one block > [back arrow + field row, tabs, results].
  `data-igx-searchbar` = highest ancestor of `main input[type="text"]` that
  doesn't contain the tablist and is ≤200px tall. Wrappers between field and
  bar get `data-igx-sfull` = `w` (lone wrapper → width 100%, margins 0; the
  explore field is 816px centered by margins) or `f` (next to the back arrow →
  flex-grow). Stale marks are removed each run (right after typing the tabs
  render a frame later, so the first guess can be too high).
- Verified live (2026-10): explore field 264→1721px (was 816px), y 24→36,
  sticky at y=12 while scrolling; results layout full width, tabs hidden.

### Likes & Saved (`activity.js`)
- `/your_activity/interactions/*` (`<html data-igx-act>`): the 935px bordered
  box (`data-igx-actbox`) → 1280px, no border; the "Your activity" sidebar
  (`data-igx-actside`) and the Reviews tab (`data-igx-hidden`) hidden; tabs
  (`[role="tablist"]`, `data-igx-acttabs`) styled as chips, our **Saved** chip
  prepended (order: Saved, Likes, Comments, Reposts, Story replies). Likes
  tiles 3:4 via CSS on the Bloks `div[style*="aspect-ratio"]` (Instagram
  re-measures rows itself) and 4 columns: the rows list gets
  `data-igx-likelist` → display: grid (4 cols), rows and row wrappers
  `display: contents` (lazy loading unaffected).
- **Saved** (`#igx-saved`, `<html data-igx-saved>`): native panel
  (`data-igx-actpanel`) hidden; our `.igx-saved` = collections row
  (`.igx-colls`) + 4-column JS masonry (`.igx-mcol`, a tile goes to the
  shortest column; ratio = original h/w of the post or its first carousel
  item, clamped 0.5–1.9). Data: `GET /api/v1/feed/saved/posts/?max_id=` and
  `/api/v1/feed/collection/{id}/posts/` (both work on web; `feed/liked/` and
  `collections/list/` do NOT). Collection **names** exist only on the native
  `/USER/saved/` page: `maybeHarvestHere()` reads its links
  (`/USER/saved/slug/ID/`) into `igxCollections` (storage.local, 24h); if the
  cache is missing or empty, a background-tab job opens that page (once per
  browser session; an empty result from a background tab is never cached —
  the page may not have rendered). Tiles in "All posts"
  show their collection names (`saved_collection_ids`).
- **Likes tiles are Bloks** (`[role="button"][aria-label*="@"]`): no post id or
  link in the DOM, a click navigates (SPA) to `/p/CODE` and can't be cancelled
  (blocking pushState still renders the post), posts can't be iframed
  (`X-Frame-Options: DENY`).
- Tile actions:
  - **Send** → `sessionStorage.igxPostAction` + open the post → `runPending()`
    presses Share (paper-plane path `M13.973 20.046`) → native Share dialog.
  - **Unsave** (saved tiles) → tile greys out (`.igx-veil`), a background-tab
    job (`bg-open` in background.js, `#igx-job=ID&a=unsave`) presses the filled
    bookmark (path `M20 22a.999`) and reports via `storage.local igxJob_ID`,
    then `bg-close`. Failure → veil removed + toast.
  - **Collections** (saved tiles, when collections are known) → popover
    `.igx-cpop` with a checkbox per collection (from `saved_collection_ids`)
    + Done. Diff → `POST /api/v1/collections/{id}/edit/` with
    `added_media_ids` / `removed_media_ids` = `["<pk>"]` (+ csrf), expects
    `{"status":"ok"}`; badge updated; leaving the collection being viewed →
    "Moved" veil. **No ticks = unsave** (owner's rule). Endpoint is the
    private-API one, NOT verified on web (couldn't test on the account);
    failure → toast, nothing changes. The native web "Add from saved" picker
    opened empty, so it's no fallback.
  - **Unlike** (likes tiles) → in place through Instagram's Select mode, found
    by colour: blue "Select" above the grid → tick the tile (re-found by its
    aria-label) → red "Unlike" in the bottom bar → red button of a confirm
    dialog if one appears. Liked heart on a post = first action button, red
    `rgb(255, 48, 64)`. `/api/v1/web/likes/{pk}/(un)like/` returns 404.
- "Saved" nav item: a clone of the `a[href="/explore/"]` item with the native
  svg attributes (class sets the colour), Instagram's bookmark outline /
  filled when active, bold label; rebuilt when the native item changes shape
  (labels exist only while the nav is expanded).
- Tile buttons: white round buttons; send = paper plane, unlike = red filled
  heart, unsave = filled bookmark (they show the current state; click removes).
- **Left nav never expands**: `lockNav()` finds the panel with the inline
  `width:` (72 ↔ 238px) and a window capture listener swallows mouse/pointer
  over/out/enter/leave/move inside it, so Instagram never widens it or renders
  labels. CSS `:hover` highlights still work (same for our Saved item).
- **Post page** (`tweakPostPage`, `<html data-igx-post>`, standalone `/p/…`
  only — skipped when the share button is inside an `<article>`, i.e. feed or
  modal): `main > wrap > [post block (--x-maxWidth 815px) > box (1px border) >
  media + comments 335px], line, "More posts from …"`. The post block gets
  `--igx-post-max` = media width for the window height (media h/w ratio kept)
  + comments width, max 1600px, height = window − 2 × space above (centred);
  the box border is removed; everything after the
  post is folded behind `.igx-moretoggle` ("More from this account").
- Verified live: layout, chips, masonry + paging, collections (harvest, covers,
  switching), Send (Share dialog opens; nothing sent). Unlike / unsave and the
  background-tab job were not run on the account (owner tests them).

- Footer links (Meta · About · Blog …) hidden everywhere: `footer:has(a[href*="about.meta.com"])`.

## Storage (`chrome.storage.local`)

```
groups:    [{ id, label, color }]              // default: friends/strangers/shops
tags:      { [username]: groupId }
people:    { [username]: { name, pic } }       // only tagged users; pic URLs expire → letter fallback
followers: { uid, ts, users: [username] }      // ignored if uid ≠ current ds_user_id
following: { uid, ts, users: { username: pk } } // accounts I follow
mutes:     { [username]: { posts, stories, ts } } // feed mute status, 7-day cache
lastSync:  { ts, manual }                     // last successful lists update
syncLock:  timestamp                           // transient
```
`groups` and `tags` are **also** in `chrome.storage.sync` (via `sync-store.js`,
keys `groups`, `groups.0…`, `tags`, `tags.0…`): Chrome syncs them between the
owner's computers when Chrome sync (Extensions) is on. On load the synced copy
wins and is mirrored into local; with no synced copy yet, local data is
uploaded. Writes go to local immediately and to sync debounced (1.5 s);
changes from other computers arrive via `syncStore.onChange` → `store.set`.
A value too big for sync (100 KB total, ~3,700 tags) is removed from sync
rather than left stale. Everything else is a cache and stays local.
`manifest.json` has a fixed `key`, so the extension ID
(`cilfjcmgnljkdmhpdaigcnfmbmaacicm`) is the same in any folder and on any
computer — required for sync and for keeping local data when the folder
moves. The private key is not kept (not needed for unpacked installs); the
`--store` build strips `key`. Group edits use a debounced save plus an echo filter
(`groupEchoes`) so `storage.onChanged` doesn't overwrite text mid-typing.
Always look groups up by id (`groupById`) — objects get replaced on every
storage change.

## Conventions

- Prefix everything: classes `igx-*`, attributes `data-igx-*`.
- Use Instagram theme variables (`--ig-primary-text`, `--ig-secondary-text`,
  `--ig-stroke`, `--ig-elevated-separator`, `--ig-hover-overlay`, …). They are
  `r, g, b` triplets → `rgb(var(--ig-primary-text))`. Light theme =
  `html.__fb-light-mode`, dark = `html.__fb-dark-mode`.
- Instagram's class names are obfuscated and change — never select by them.
  Anchor on roles, hrefs, element relationships and measured geometry.
- React re-renders often: all DOM tweaks go through a `MutationObserver` +
  `requestAnimationFrame` scheduler and must be idempotent.
- Popovers are appended inside the dialog (Instagram's focus trap blocks
  inputs outside it) and excluded from the modal stretch rules via
  `:not(.igx-pop)`. Escape closes a popover without closing the modal.
- Keep selectors/text language-independent: Instagram may be in any language
  (the owner's accounts use English and Ukrainian). Never match Instagram's
  own button texts; `rowInfo()` skips text inside buttons/svg instead.
- Content-script strings go through `igxT()` (`i18n.js`); popup/background
  strings through `chrome.i18n` (`_locales`).

## Update notifier (`background.js`)
- `UPDATE_URL` at the top; empty = off (popup shows "not set up"). Set with
  `node scripts/release.mjs --setup owner/repo` (raw.githubusercontent.com,
  public repo only; CORS `*`, so no host permissions).
- Alarm `update-check`: first after 1 min, then every 6 h; created in
  `onInstalled` and `onStartup`. Fetch with `?t=` + `cache: 'no-store'`,
  errors ignored. Only data is read (`parseRemote` validates version/url/notes).
- Storage: `remote`, `checkedAt`, `notifiedVersion` (notify once per version),
  `seenVersion` (written by the popup on open). Badge: ↑ green if remote is
  newer (numeric segment compare), else NEW blue if `seenVersion` ≠ current.
  A fresh install (no `seenVersion`) stores the current version; an update
  from a version without it stores '0' → NEW.
- Messages: `'check-now'` (async, replies `{enabled}`), `'refresh-badge'`,
  `'status'`.
- Tested in Playwright (headless Chromium, `--load-extension`) with a local
  CORS server: alarm → ↑ + notification; popup Check; NEW after relaunch with
  a higher manifest version, cleared by opening the popup.
  `chrome.runtime.reload()` in that setup disables the extension — relaunch
  the browser instead.

## Shared with the YouTube extension
`background.js`, `popup.html`, `popup.js`, `sync-store.js`, `scripts/release.mjs` and
`.github/workflows/release.yml` are **identical** in this repo and in
`ulquorium/subscriptions-first` (sibling folder `../subscriptions-first`). Only
`UPDATE_URL` (background.js), `ZIP_NAME` (release.mjs) and the palette in
`popup.css` differ; `_locales` have the same keys. Change them in both.

## Testing on the live page (no install needed)

The owner's Chrome tab is available through Claude in Chrome. Instagram's CSP
blocks `eval` from page scripts but allows `blob:` scripts, so:

1. Build a bundle: CSS injected into a `<style id="cc-tall-modal">` +
   a `chrome.storage` shim (`local` **and** `sync` areas — `sync-store.js` must be in the bundle before `content.js`; backed by `sessionStorage['__igxMem']` so data
   survives reloads, fires `onChanged` listeners) + the script under test.
2. In the page, append a hidden `<input type="file">` whose `change` handler
   loads the file via `script.src = URL.createObjectURL(file)`.
3. Upload the bundle with the file-upload tool, then open the modal / page.
4. If the extension is also installed in that Chrome, its own instance runs
   too (e.g. two `.igx-feednav`); hide or ignore the installed one's
   elements when measuring. Guard the loader so it runs only once.
5. Verify with measurements (`getBoundingClientRect`) and screenshots, not
   only by eye. Reload the page to remove injected code; clear
   `sessionStorage.__igxMem` when done.

Note: `home.js` redirects bare `/` — navigate to `/?variant=following` before
injecting it. Test posts with several aspect ratios and a carousel (click
its Next arrow and measure slide offsets). Opening the Following modal: click the "N following" link in
the profile header.

## Ideas discussed but not built
- Export/import of groups to a file (backup independent of Chrome sync).
- On/off switches per tweak in the toolbar popup.
- Hiding other Instagram blocks (Reels, suggestions, etc.).
