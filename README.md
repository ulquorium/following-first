# Instagram Follow Lists+

Chrome extension for instagram.com. Interface in English, Ukrainian and Russian — the language follows Instagram's interface (the toolbar popup follows Chrome's language).

**Followers / Following lists**
- Full-height, wider modal with subtle separators.
- Personal groups for each contact (Friends, Strangers, Shops by default); create, rename, recolor and delete them.
- Group filters above the list (instant, no extra requests to Instagram).
- "Follows" / "Not following" indicator next to each contact (your followers list is refreshed at most once a day).
- Mute controls for posts and stories right in the list: see and change whether an account appears in your feed.
- Follow / Following / Remove buttons have one width, so rows don't jump when you (un)follow.

**Home page**
- Opens the Following feed by default. Feed tabs are replaced by two icons under the Instagram logo: Following and Algorithmic.
- Right sidebar pinned to the right edge; feed column centered.
- Story circles 1.5× smaller, so more fit in a row.
- Works with both Instagram layouts: when Following is a separate page (with a back arrow and no stories), the title is hidden and the stories row is added back, so it looks the same as the tabs version.
- Bigger posts (600px wide) with the frame following the photo/video proportions — vertical posts are no longer cropped.

**Updates**
- The extension checks a small `version.json` file every 6 hours. When a new version is out you get a **↑** badge on the icon and a system notification; clicking it opens the release page.
- After you update, the icon shows **NEW** until you open the popup. The popup shows the version, what's new, the full changelog and a **Check** button.

## Install
1. Download the zip from the latest GitHub release and unzip it into a folder.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select that folder.
4. Reload Instagram.

## Update
Unzip the new release **over the same folder** (replace the files), then click ↻ on the extension card in `chrome://extensions`. Always keep the same folder: loading the extension from a different folder creates a new extension, and your groups won't carry over.

## Setting up update notifications (one time)
1. Create a **public** GitHub repository and push this folder to its `main` branch.
   `version.json` is read from `raw.githubusercontent.com`, which works only for public repositories. For a private repository put `version.json` somewhere public instead (a separate public repo, a gist, or GitHub Pages) and set `UPDATE_URL` to that address by hand.
2. Run `node scripts/release.mjs --setup <owner>/<repo>` — it writes `UPDATE_URL` at the top of `background.js` and fixes the link in `version.json`. Commit and push.

While `UPDATE_URL` is empty, update checks are off (the popup says so).

## Releasing a new version
Requires Node 18+ and git; no other tools.

1. Add the new version as the **first** entry of `changelog.json`, in all three languages:
   ```json
   { "version": "1.11.0", "en": ["…"], "uk": ["…"], "ru": ["…"] }
   ```
2. On the `main` branch, run `node scripts/release.mjs 1.11.0`. It
   - sets `version` in `manifest.json` and writes `version.json` (notes from the changelog, link to the `v1.11.0` release page);
   - checks the syntax of every `.js` and `.json` file, that all `_locales` have the same keys and every changelog entry has all three languages;
   - builds `dist/instagram-follow-lists-1.11.0.zip` with only the extension files;
   - commits everything and creates the tag `v1.11.0`.
   (`--no-git` skips the commit and the tag.)
3. `git push --follow-tags`. The GitHub Action (`.github/workflows/release.yml`) builds the zip again from the tag and creates the release with the changelog text.
4. Within ~6 hours every user gets the notification.

**Important:** never push a `version.json` with a new version to `main` on its own — only through the release script and `git push --follow-tags`, so the commit and the tag arrive together. The link in `version.json` points to the release page of that exact tag; it starts working as soon as the Action finishes (about a minute).

### Chrome Web Store build
If the extension ever goes to the Web Store, the store updates it itself. Build the store zip with update checks switched off:
```
node scripts/release.mjs --build --store
```
(`UPDATE_URL` is blanked only inside `dist/…-store.zip`.)

## Testing update notifications locally
1. Serve a `version.json` with a higher version and the header `Access-Control-Allow-Origin: *`, e.g. a tiny Node server on port 8765.
2. Temporarily set `UPDATE_URL = 'http://localhost:8765/version.json'`, reload the extension, wait a minute (or press **Check** in the popup): the ↑ badge, the notification and the update block in the popup appear.
3. Put `UPDATE_URL` back.
4. NEW badge: open the popup once, raise `version` in `manifest.json`, reload the extension → **NEW**; open the popup → it disappears.

## License
MIT — see `LICENSE`.

## Extending with Claude
See `CLAUDE.md` — architecture, data model, conventions and how to test changes on the live page.
