# Local image copies

One copy of every image the corpus records, so an item stays scoreable after the
page it came from changes. Written by `../../tools/fetch-images.mjs` and by
nothing else.

- One file per item, named after the item: `fi-0007.png`, `fi-0012.svg`. The
  extension comes from what the server said it served, checked against the
  bytes.
- The item's record links to it in `image_file`, as a path relative to the
  project directory, and records the file's SHA-256 in `image_sha256`.
- An item whose implementation has no separate image file, an inline `<svg>` or
  an icon font glyph, has no copy here. Its markup is in the record, which is the
  whole image in that case.
- Rejected items are not archived. They are kept as evidence about what does not
  belong in the corpus, and will never be scored.

These files are the one exception to the plain text requirement in
[../../../../AGENTS.md](../../../../AGENTS.md): they are the artifacts under
test, never carriers of documentation. Everything said *about* an image lives in
the corpus record as text.

Add or refresh copies, and check the ones already here against their recorded
hashes:

    node ../../tools/fetch-images.mjs
    node ../../tools/fetch-images.mjs --verify

`./run.sh` does both every round, and `./run.sh --images` does them on their own.
A copy that no longer matches its hash stops the loop: the item was reviewed
against those bytes, so a score taken from different ones means nothing. Restore
it from git, or refetch it and record what happened in
[../corrections.md](../corrections.md).

Why keep the bytes at all, when the record has the URL:

- Link rot is certain. A page redesign or a deleted file makes an item
  unscoreable, and by then nobody can tell whether the gold standard was right.
- A score has to be defensible to someone who disputes it. That means showing
  them the image the model was given, not a URL that now serves something else.
- Re-running the benchmark should not depend on hundreds of third-party servers
  being up, or on hitting them again.

This is a working archive, not a republication. The corpus cites every image by
URL and records provenance for each one; the copies exist so the benchmark can be
re-run and audited.
