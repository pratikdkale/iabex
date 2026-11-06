---
description: Run the dev server and check desktop and mobile layouts
---

1. Start `python3 dev_server.py` in the background (port 8000).
2. Use Playwright (or a browser) to load http://localhost:8000 at 1440×900 and at 390×844
   (iPhone). Take full-page screenshots and look at them.
3. Check: no horizontal scroll at 390 px; the menu button opens and closes the menu; the 3D
   board shows in the hero band on mobile and on the right on desktop; no console errors.
4. Open a product card, fill the modal and submit it, then confirm a new `.eml` file in
   `dev-outbox/`.
5. Report what's broken, with screenshots. Stop the server when done.
