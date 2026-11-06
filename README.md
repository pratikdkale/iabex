# IABEX Technologies — website

Single-page site for [iabex.net](https://iabex.net). Plain HTML, CSS and JavaScript with a
three.js 3D hero. There's no build step.

## Preview locally

```bash
python3 dev_server.py
# open http://localhost:8000
```

Form submissions are saved to `dev-outbox/` as `.eml` files instead of being emailed.

## Deploy (cPanel / shared PHP hosting)

1. Fill in `api/config.php`: recipients, plus the SMTP host, user and password of a mailbox on
   the domain (for example website@iabex.net). If you leave SMTP empty, PHP `mail()` is used.
2. Upload everything **except** `dev_server.py`, `dev-outbox/`, `CLAUDE.md`, `README.md` and `.claude/`
   to `public_html/`.
3. Send a test enquiry from the live site.

## Working on it with Claude Code

Open this folder in Claude Code. `CLAUDE.md` describes the structure, design rules and
checks. Custom commands:

- `/add-product`: add a catalogue product card
- `/fill-placeholder`: replace a `[placeholder]` with real content
- `/preview`: start the dev server and check desktop and mobile layouts
