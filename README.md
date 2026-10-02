# Instagram Follow Lists+

A Chrome extension that makes instagram.com on desktop easier to manage: a proper
Followers / Following list with your own groups, and a calmer home page that opens
the feed of people you actually follow.

*Українською: [README.uk.md](README.uk.md).*

## Why

Instagram's desktop site shows your followers in a tiny pop-up, gives you no way to
sort people into groups, doesn't tell you who follows you back, and hides the
Following feed behind the algorithmic one. This extension fixes that without any
account, server or tracking — everything happens in your browser.

## Features

**Followers / Following lists**
- Full-height, wider list window with clean separators.
- Your own groups for every contact (Friends, Strangers, Shops by default) — create, rename, recolor, delete.
- Group filters above the list: instant, no extra requests to Instagram.
- "Follows" / "Not following" indicator next to every contact (your followers list is refreshed at most once a day).
- Mute posts and stories of an account right from the list.
- Follow / Following / Remove buttons have the same width, so rows don't jump when you (un)follow.

**Home page**
- Opens the **Following** feed by default; two icons under the Instagram logo switch between Following and Algorithmic.
- Right sidebar pinned to the edge, feed column centered.
- Smaller story circles, so more fit in a row.
- Bigger posts (600 px) whose frame follows the photo/video proportions — vertical posts are no longer cropped.
- Works with both Instagram layouts (feed tabs, or a separate Following page without stories — the stories row is added back).

**Languages:** English, Ukrainian, Russian — follows Instagram's language (the extension popup follows Chrome's).

## Install

The extension is not in the Chrome Web Store; it is installed from a GitHub release.

1. Open the [latest release](https://github.com/ulquorium/instagram-follow-lists/releases/latest) and download
   `instagram-follow-lists-X.Y.Z.zip` under **Assets**.
2. Unzip it into a folder you will keep, e.g. `~/Extensions/instagram-follow-lists`.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and select that folder.
5. Reload instagram.com.

Works in Chrome and other Chromium browsers (Edge, Brave, Arc, Opera).

## Updates

Every 6 hours the extension checks whether a new version is out. If so, you get a **↑**
badge on its icon and a system notification; clicking it opens the release page.

To update: download the new zip, unzip it **over the same folder** (replace the files),
then click ↻ on the extension card in `chrome://extensions`. Keeping the same folder is simplest
(don't remove the extension to update — use ↻).

After an update the icon shows **NEW** until you open the popup, which shows the version,
what's new, the full changelog and a **Check now** button.

## Your data across computers

Groups and tags are saved to your Chrome account (`chrome.storage.sync`) and appear automatically on
every computer where you are signed in to Chrome with sync on — Settings → You and Google →
Sync → make sure **Extensions** is included. They also survive turning the extension off and on,
updates, and moving its folder (the extension has a fixed ID).

On a new computer, install the extension and give Chrome a minute to bring your groups and tags before
changing anything. If Chrome sync is off, everything still works, just on this computer only.

## Privacy

- No data is collected or sent anywhere. No analytics, no accounts, no servers of our own.
  (Chrome's own sync carries your settings between your computers, if you have it on.)
- Requests go only to instagram.com (on your behalf, human-paced, to read your follower lists
  and mute status) and to GitHub to read a small `version.json` file with the latest version number.
- Groups and settings are stored in your browser and, if Chrome sync is on, in your Chrome account.
- No remote code: the extension only runs the files you installed.

## Permissions

| Permission | Why |
|---|---|
| Access to `www.instagram.com` | The extension works on Instagram pages. |
| `storage` | Keeps your groups, tags and cached lists, and syncs groups and tags through your Chrome account. |
| `alarms` | Schedules the update check every 6 hours. |
| `notifications` | Tells you a new version is out. |

## For developers

Plain JavaScript and CSS, Manifest V3, no build step. Architecture and conventions: [`CLAUDE.md`](CLAUDE.md).
Release process (changelog → `node scripts/release.mjs X.Y.Z` → `git push --follow-tags`):
[README.uk.md](README.uk.md#випуск-нової-версії-для-автора).

## License

[MIT](LICENSE)
