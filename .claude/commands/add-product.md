---
description: Add a product card to the catalogue grid
argument-hint: <product name> <family: industrial|process|solar|spm> [image path]
---

Add a new catalogue product to `index.html`: $ARGUMENTS

1. If an image was given, convert it to `.webp` (max 800 px wide, white background kept) and
   save it in `assets/img/products/<kebab-name>.webp`. If none was given, ask for one.
2. Copy an existing `<button class="product">` in the same family block inside
   `[data-products]`. Set `data-family`, `data-product`, `data-code`, the image `src`, the
   family label and the name.
3. Codes are sequential (`P-01`…). Put the new product at the end of its family and
   renumber the codes after it so they stay in order.
4. **Don't add specs or prices.** The client only wants details shared after an enquiry.
5. Check: tab counts update (they're computed in JS), and clicking the card opens the
   modal with the right title and code.
