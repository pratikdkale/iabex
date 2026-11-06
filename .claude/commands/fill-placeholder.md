---
description: Replace bracketed placeholders with real client content
argument-hint: [section id or topic, e.g. "case studies" or "#quality"]
---

Fill placeholders in `index.html` for: $ARGUMENTS

1. Search `index.html` for `[` placeholders and `TODO(client)` comments in that section.
   If no section was given, list every remaining placeholder grouped by section and ask
   which ones to fill.
2. Ask for any real content you don't have. Never invent figures, certifications, client
   names or outcomes.
3. Replace the text and remove the `placeholder` class and the `TODO(client)` comment once
   it's real. Put images in the right `assets/img/` subfolder as `.webp`.
4. For the map, use a Google Maps embed `<iframe loading="lazy">` inside `.map`.
5. Keep the design rules in CLAUDE.md, including uniform cards and tokens only.
