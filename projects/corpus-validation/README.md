# Accessibility Image Validator

A lightweight, accessible tool for reviewing image/alt text pairs in the
benchmarks-ai-alt corpus. Runs as a static site on GitHub Pages or any
local HTTP server.

## How it works

1. Start a session.
2. For each image, you see the image and the text under review.
3. Click Accept or Reject.
4. Provide a written reason (required for both).
5. End the session at any time; you are not required to finish all items.
6. Download results as JSON and submit them as a GitHub issue.

## What "the text under review" means

Not every functional image carries its own alt attribute. A search button often
puts the text in an aria-label on the button, and a logo inside a link whose
own text already names the site correctly carries alt="". So the tool shows the
accessible name, which is the text a screen reader actually announces, and says
which attribute it came from.

The image's own alt attribute is shown separately under Context, with two
distinct cases spelled out rather than collapsed together:

- (no alt attribute on the image), which is usually a defect
- (alt="", deliberately empty), which is correct when the surrounding link or
  button already carries the text

Of the 78 items in the first corpus, 36 have no usable alt attribute on the
image itself, so this distinction is most of the corpus rather than an edge
case.

## Running locally

From this directory:

```
python3 -m http.server 8000
```

Then open http://localhost:8000 in a browser.

## Accessibility

- Skip link for keyboard users
- Semantic HTML with proper landmarks, headings, labels, and fieldsets
- ARIA live regions announce progress changes to screen readers
- Progress bar uses role="progressbar" with aria-valuenow
- All interactive elements reachable and operable by keyboard
- Focus management: textarea receives focus when reason panel opens
- Color contrast meets WCAG AA (4.5:1 minimum for text)
- Respects prefers-reduced-motion
- No information conveyed by color alone

## File structure

- index.html: page markup
- css/style.css: styles
- js/main.js: application logic
- functional-images.jsonl: corpus data (copy from corpus-construction)

## Submitting results

When you end a session, use "Download Results (JSON)" to save your file.
Then click "Submit as GitHub Issue" to open a pre-filled issue template.
Paste or attach the JSON in the issue body.

## Data format

The downloaded JSON contains:

- session_id: unique identifier for the session
- timestamp: when the session ended
- corpus_size: total items in the corpus
- reviewed: how many items you evaluated
- accepted: count of accepted items
- rejected: count of rejected items
- results: array of individual evaluations with id, status, reason,
  and timestamp