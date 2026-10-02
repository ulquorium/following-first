# Instagram Follow Lists+

Chrome-розширення для instagram.com: зручні списки підписників і підписок, охайніша головна.
Інтерфейс українською, англійською й російською (за мовою Instagram; вікно розширення — за мовою Chrome).

*English below.*

**Списки підписників / підписок**
- Вікно на всю висоту й ширше, з тонкими розділювачами.
- Власні групи для кожного контакту (за замовчуванням Друзі, Незнайомці, Магазини): створення, перейменування, колір, видалення.
- Фільтри за групами над списком — миттєво, без зайвих запитів до Instagram.
- Позначка «Стежить» / «Не стежить» біля кожного контакту (список підписників оновлюється не частіше разу на добу).
- Вимкнення дописів і сторіз акаунта у стрічці прямо зі списку.
- Кнопки «Стежити» / «Ви стежите» / «Видалити» однакової ширини — рядки не стрибають.

**Головна**
- За замовчуванням стрічка «Підписки». Вкладки замінені двома іконками під логотипом: Підписки й Алгоритмічна.
- Правий сайдбар притиснутий до краю, стрічка по центру.
- Кружечки сторіз у 1,5 раза менші — у рядок влазить більше.
- Працює з обома варіантами Instagram (вкладки або окрема сторінка «Підписки» без сторіз — тоді ряд сторіз додається).
- Більші дописи (600 px) з рамкою за пропорціями фото/відео — вертикальні більше не обрізаються.

## Встановлення
1. Завантаж zip з [останнього релізу](https://github.com/ulquorium/instagram-follow-lists/releases/latest) (розділ **Assets**) і розпакуй у постійну папку, наприклад `~/Extensions/instagram-follow-lists`.
2. Відкрий `chrome://extensions` і ввімкни **Режим розробника**.
3. **Завантажити розпаковане** → вибери цю папку.
4. Перезавантаж Instagram.

## Оновлення
Розширення раз на 6 годин перевіряє, чи вийшла нова версія. Якщо так — на іконці **↑** і системне сповіщення; клік відкриває сторінку релізу.
Розпакуй новий zip **поверх тієї ж папки** і натисни ↻ на картці розширення в `chrome://extensions`. Папку не міняй: з іншої папки Chrome вважає це новим розширенням, і групи не перенесуться.
Після оновлення на іконці **NEW**, доки не відкриєш вікно розширення («Що нового», уся історія змін, кнопка «Перевірити»).

## Приватність
Розширення нічого не збирає й нікуди не передає. Запити йдуть лише на Instagram (від твого імені, у темпі людини) і на GitHub за файлом `version.json`. Групи й налаштування зберігаються локально в браузері.

## Випуск нової версії (для автора)
Потрібні Node 18+ і git.

1. Додай нову версію **першим** записом у `changelog.json`, трьома мовами:
   ```json
   { "version": "1.11.0", "uk": ["…"], "en": ["…"], "ru": ["…"] }
   ```
2. На гілці `main`: `node scripts/release.mjs 1.11.0` — оновлює `version` у `manifest.json`, пише `version.json` (notes із changelog, посилання на реліз `v1.11.0`), перевіряє синтаксис `.js`/`.json` і паритет локалізацій, збирає `dist/instagram-follow-lists-1.11.0.zip` лише з файлів розширення, комітить і ставить тег `v1.11.0`. (`--no-git` — без коміту й тегу.)
3. `git push --follow-tags` — GitHub Action (`.github/workflows/release.yml`) збирає zip із тегу й створює реліз із текстом із changelog (~1 хв).
4. Протягом ~6 годин усі користувачі отримують сповіщення.

**Важливо:** `version.json` з новою версією не повинен потрапити в `main` раніше за реліз — тільки через скрипт і `git push --follow-tags`, щоб коміт і тег прийшли разом. Якщо Action упав — виправ і перезапусти його, або відкоти `version.json`.

Інші команди: `--build` (лише zip), `--build --store` (zip для Chrome Web Store з вимкненою перевіркою оновлень — магазин оновлює сам), `--notes 1.11.0` (текст релізу), `--setup owner/repo` (одноразово: прописати `UPDATE_URL`; для приватного репозиторію raw-посилання не працюють — `version.json` треба викласти деінде публічно).

### Перевірка сповіщень локально
1. Підніми локальний сервер із `version.json` з вищою версією і заголовком `Access-Control-Allow-Origin: *` (порт 8765).
2. Тимчасово `UPDATE_URL = 'http://localhost:8765/version.json'` у `background.js`, онови розширення, натисни «Перевірити» в popup → ↑, сповіщення, блок у popup.
3. Поверни `UPDATE_URL`.
4. NEW: відкрий popup, підвищ `version` у `manifest.json`, онови розширення → **NEW**; відкрий popup → зникає.

Для розробки з Claude — `CLAUDE.md` (архітектура, дані, правила, як тестувати на живій сторінці).

---

## English

Chrome extension for instagram.com: better Followers / Following lists and a tidier home page.

- Full-height, wider Followers / Following modal; personal groups with colors; instant group filters.
- "Follows" / "Not following" indicator; mute posts and stories right from the list.
- Home opens the Following feed; feed switcher under the logo; pinned right sidebar; smaller stories; bigger, uncropped posts.

**Install:** download the zip from the [latest release](https://github.com/ulquorium/instagram-follow-lists/releases/latest) (**Assets**), unzip into a permanent folder, `chrome://extensions` → Developer mode → **Load unpacked** → the folder.

**Update:** you get a **↑** badge and a notification when a new version is out. Unzip it over the same folder and click ↻ on the extension card. Keep the same folder, or your groups won't carry over.

**Privacy:** no data is collected or sent anywhere. Requests go only to Instagram (on your behalf, human-paced) and to GitHub for `version.json`. Groups and settings stay in your browser.

**Releasing:** add the changelog entry first, then `node scripts/release.mjs X.Y.Z` and `git push --follow-tags` (details above).

License: MIT.
