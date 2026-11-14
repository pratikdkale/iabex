# IABEX Technologies — website

Single-page marketing site for IABEX Technologies Pvt. Ltd. (Pune), an embedded-electronics
design & manufacturing company. Tagline: **"It's all about ElectroniX"**.

Static HTML/CSS/vanilla JS — **no framework, no build step, no npm**. Deployed to shared
PHP hosting (cPanel) by uploading the folder as-is. Keep it that way unless asked.

**Temporarily hosted on GitHub Pages** (repo `pratikdkale/iabex`, branch `main`):
`.github/workflows/pages.yml` publishes only `index.html`, `assets/`, `favicon.ico`,
`robots.txt`, `sitemap.xml`. Pages can't run PHP, so `<meta name="form-endpoint">` in
`index.html` routes forms and chat enquiries to FormSubmit (`submitData` in `main.js`);
job applications post natively (FormSubmit's AJAX can't take files) and return via
`?sent=application`. On localhost forms still hit `api/send.php`. **Moving back to cPanel:
delete that meta tag.**

## Run locally

```bash
python3 dev_server.py          # http://localhost:8000  (emulates api/send.php)
```

`dev_server.py` serves the site and saves every form submission as an `.eml` file in
`dev-outbox/` instead of emailing — use it to test the forms. `php -S localhost:8000`
also works if PHP is installed (then `api/send.php` runs for real and tries to send mail).

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole page. Sections in order: header → hero (3D) → clients → `#about` → `#capabilities` → `#products` → `#process` → `#industries` → `#recognition` → `#work` (case studies) → `#quality` → `#facility` → `#careers` → `#faq` → `#contact` → `#testimonials` → footer. Plus the floating chat assistant (`[data-chat]`) and one `<dialog data-modal>`. |
| `assets/css/styles.css` | All styles. Design tokens in `:root` at the top; one block per section; **all breakpoints in the RESPONSIVE section at the bottom** (1100 / 960 / 640 px). |
| `assets/js/main.js` | Menu, active-nav, scroll reveal, marquee, product filter, modal, AJAX forms. |
| `assets/js/hero3d.js` | three.js PCB scene in the hero. |
| `assets/js/chat.js` | Rule-based chat assistant (no AI service). Reads products, roles, industries, FAQ, clients and section text from the page; calculators; IST office hours; in-chat enquiry → `api/send.php`. |
| `assets/vendor/three.min.js` | three.js **r149** (global `THREE` build). Do not upgrade past r149 without porting — r150+ dropped `build/three.min.js` and uses ES modules. |
| `api/send.php` | Mailer for every form (JSON `{ok, message}`). |
| `api/config.php` | SMTP + recipients. **Contains the SMTP password once filled in — never commit real credentials**; `.htaccess` blocks web access to it. |
| `dev_server.py` | Local server + fake mailer. |
| `assets/img/…` | `brand/` logos & icons, `products/` (24 catalogue images, white backgrounds), `capabilities/`, `facility/`, `clients/` logos. All `.webp`. |

## Design system (keep it consistent)

- **Logo red `#E31E25` is the anchor.** Use `--red` for large accents (dots, rules, the
  "X" in headlines), `--red-btn` for button backgrounds, `--red-ink` for small red text on
  cream (the raw logo red fails 4.5:1 contrast at small sizes).
- Warm supporting colours: `--amber #F2A541`, `--copper #B86B3C`. Grounds: `--cream`,
  `--paper` (cards), `--sand` (alternate sections), `--dark` espresso `#1C1410`.
- Section rhythm alternates cream → sand → dark. Don't put two dark sections back to back.
- **Card grids are uniform** — all cards in a grid share one background and border
  (`--paper` + `--line-2`). Don't colour individual cards differently; emphasis comes from
  the red kicker text and the short red rule on top of each card body.
- Fonts (Google Fonts): Bricolage Grotesque (display/headings), Inter (body),
  JetBrains Mono (eyebrows, codes, labels).
- Section header pattern: `.eyebrow` → `.h2` → optional `.lead`, or `.section-head` for a
  heading with a side paragraph.
- Icons: inline stroke SVG; shared ones live in the `<svg>` sprite at the top of `<body>`
  (`<use href="#i-arrow"/>`). No emoji, no icon fonts.
- No gradient washes behind content, no left-border accent cards.

## Content rules from the client

- **Products show no specifications.** Cards carry only image, code (P-01…), family and
  name. Specs, pricing and lead time are shared *after* an enquiry — clicking a card opens
  the modal (`kind="product"`). Don't add spec lists back.
- The old site had separate `products.html` / `careers.html`; this redesign is a
  **single page** on purpose. New content goes in as a section with an `id`, linked from
  the nav if it's top-level.
- Contact details (source of truth): info@iabex.net · +91 76666 90113 ·
  S.No. 131/2A 24, behind Church, Rajyog Society, Warje, Pune 411058 ·
  Mon–Sat 9:30–6:30. They appear in the contact section, footer, JSON-LD in `<head>`,
  `main.js` error text and `CONTACT` in `chat.js` — update all of them together.

## Placeholders still to fill

Search for `[` in `index.html` (and `TODO(client)` comments): capability figures
(SMT capacity, PCB layers, turnaround, batch sizes), three case studies, certification
badges, test process, equipment list, facility video, extra industry vertical, NDA and
warranty FAQ answers, reply-time promise, map embed, GSTIN/CIN, WhatsApp number check.
Placeholder text uses `.placeholder` (copper ink) so it's easy to spot.

## How things work

- **Product filter**: tabs use `data-filter="<family>"`; cards use
  `data-family="industrial|process|solar|spm"`. Counts are computed in JS. Footer links
  with `data-filter-link` also set the filter.
- **Modal**: one `<dialog>`; `openModal(kind, data)` in `main.js` sets copy from `COPY`.
  Elements with `data-only="product catalogue apply"` are shown *and enabled* only for
  those kinds (disabled fields aren't validated or submitted). Triggers:
  product cards, `[data-open-modal="project|catalogue|apply"]` with `data-title`. Every
  "Discuss a project / custom build" CTA opens `project` (links keep `href="#contact"` as the
  no-JS fallback). `window.IABEX.openModal` / `filterProducts` are exposed for `chat.js`.
- **Forms** post `FormData` to `api/send.php` with a hidden `type`:
  - `enquiry` → requires `name`, `email`, `message`; optional `product`, `interest`,
    `quantity`, `company`, `phone`.
  - `application` → requires `role`, `name`, `email`, `phone`, `location`,
    `qualification`, `experience`, `notice`, `consent`, file `resume` (pdf/doc/docx ≤ 5 MB);
    optional `employer`, `current_ctc`, `expected_ctc`, `skills`, `linkedin`, `cover`.
  - Honeypot field `website` must stay empty and hidden.
  If you add a field, add it to `send.php` (`$rows`) **and** `dev_server.py` `REQUIRED`
  if it's required.
- **Chat assistant**: intents live in `INTENTS` in `chat.js` (`kw` strong keywords/phrases,
  `weak` supporting words, `run` returns a message). Product search, family lists, roles,
  testimonials and FAQ come from the DOM, so new product cards/roles need no chat changes;
  add need-words for a new product to `NEED`. It must never quote specs or prices (same rule
  as product cards). In-chat enquiries post `type=enquiry` with `interest` inferred.
- **Scroll reveal**: `.reveal` is only hidden under `html.js` (set inline in `<head>`); a
  2.5 s failsafe shows everything if `main.js` never starts. Bump the `?v=` on CSS/JS links
  when you change them.
- **3D hero**: `hero3d.js` renders to `[data-hero-canvas]`. Above 960 px the board is
  offset right; at ≤960 px it's framed inside `[data-hero-band]` (a spacer between the
  copy and the stats) using `camera.setViewOffset`. Falls back to the static dark hero
  (`.no-webgl`) if WebGL is unavailable; respects `prefers-reduced-motion`.

## Checks before you finish a change

1. `python3 dev_server.py` and open the page at **1440 px and 390 px** wide — no
   horizontal scroll on mobile, menu opens/closes, hero board visible and not under text.
2. Click a product card, submit the modal, confirm a new file in `dev-outbox/`.
3. Browser console has no errors.
4. Keep text contrast ≥ 4.5:1 (use the `--*-ink` tokens for small coloured text) and
   touch targets ≥ 44 px.
5. `php -l api/send.php` if you touched PHP.
