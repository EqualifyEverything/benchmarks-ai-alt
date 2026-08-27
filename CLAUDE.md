# Working in this repository

This repository is the public benchmark for AI-generated alt text. See
[README.md](README.md) for what the project is and what it measures.

Accessibility is the number one priority here, and it applies to our own
artifacts, not only to the thing we are measuring. Two hard requirements govern
every change.


## 1. Everything is plain text

Every file added to this repository must be plain text, readable and editable in
any text editor, any terminal, and any screen reader without special software.

- Documents: Markdown (`.md`) or `.txt` only. Never commit Word, PDF, slide
  decks, Notion or Google Docs exports, or any other binary or proprietary
  document format.
- Data: `.csv`, `.json`, `.jsonl`, or `.yaml`. Never spreadsheets, database
  dumps, or binary serializations.
- Results: plain text first. Publish the numbers as text; a visualization is
  generated from that text and is never the only representation of a finding.
- Never put information only in an image. No screenshots or diagrams standing
  in for content that belongs in text.
- No HTML, no embedded styling, no ASCII art in documents.
- Wrap prose at roughly 80 columns.
- Use semantic headings, nested in order, with no levels skipped.
- Prefer lists to tables. If a table is genuinely clearest, keep it narrow
  enough to read unrendered.
- Use only widely supported Markdown. Do not use syntax that degrades into
  literal punctuation when rendered, such as definition lists (`term` followed
  by `: definition`), which GitHub does not support.
- Write link text that describes the destination. No "click here", no bare URL
  used as a description.
- Use emoji and symbols only when they are the subject under discussion, never
  as decoration and never as the sole carrier of meaning.

The one exception is the benchmark corpus itself: the images under test. They
are artifacts, never carriers of documentation, and each is recorded in plain
text with its source URL, taxonomy category, surrounding context, and gold
standard alt text.


## 2. Code is held to the same standard

- Read and write plain text formats.
- Make output usable without a graphical interface. A terminal and a screen
  reader are the baseline, not a fallback.
- Store configuration and prompts as plain text so they are reviewable in a
  diff.
- If code ships an interface, it must be accessible: semantic HTML, keyboard
  operable, screen reader tested, never reliant on color alone. Every image an
  interface renders needs correct alt text, judged by the same criteria this
  benchmark scores.
- Do not add a dependency whose only purpose is producing a binary artifact
  where text would do.


## Before you commit

Check that new and changed files satisfy both requirements above. If a change
seems to need a non-text format, say so and ask rather than committing it.
