# Corrections

Changes made to the corpus outside the loop, by a person rather than by
`tools/apply-verdicts.mjs` or `tools/second-pass.mjs`. Every one is recorded
here, with what changed and why, because a corpus whose edits cannot be
accounted for cannot be defended.

Out-of-band edits should be rare. The normal way to change an item is a review
verdict and another round.


## 2026-08-27: round 01 second passes withdrawn

Round 01 ran before [../directives/02-second-pass.md](../directives/02-second-pass.md)
existed. Every one of its 12 items carried a `pass-b` entry written by the
seeking agent in the same turn as `pass-a`, which is not an independent second
pass: the author had its own first answer in front of it, so agreement was
guaranteed and the two-pass requirement in directive 00 was satisfied only on
paper.

What changed:

- The `pass-b` entry was removed from all 12 items. Each now holds one pass and
  is waiting for a real second pass from the round 02 second-pass turn.
- The 3 items that round 01 accepted, fi-0002, fi-0006 and fi-0010, went back to
  `candidate`. They had been promoted partly on the strength of the withdrawn
  pass, so the promotion did not stand.
- The 5 `adjudication` values were cleared, because each resolved a disagreement
  with a pass that no longer exists. The text of every one was moved into the
  item's `notes` field, so the reasoning survives and can be reused when the
  real second pass arrives. In one case, fi-0008, the adjudication claimed pass
  B won while `gold_alt` held pass A's wording, which is a second reason not to
  keep it.

What did not change: no item was deleted, no `gold_alt`, rationale, markup or
provenance field was touched, and no round file in `../rounds/` was rewritten.
The round 01 seek log and review report still say what they said at the time,
which is the point of keeping them.

Effect on the counts: 0 accepted items, 3 candidates, 4 awaiting revision, 5
rejected, and 7 items waiting for a second pass.


## 2026-08-27: local image copies added to the 12 existing items

`image_file` and `image_sha256` were added to the schema, and the 12 existing
records predated them. Every record was backfilled with both fields set to
`null`, then `./run.sh --images` filled them in the ordinary way: 5 items now
link a copy in [images/](images/), and the other 7 have either no separate image
file, being an inline SVG or a sprite reference, or an image URL that no longer
serves the file.

No other field was touched, and no status changed. The 5 copies were fetched
from the `image_url` already recorded, and each record's hash was written by
`../tools/fetch-images.mjs`, not by hand.


## 2026-08-27: accessible names recorded for the 12 existing items

The corpus now only holds images whose control already has an accessible name;
see the collection constraints in
[../directives/00-corpus-goals.md](../directives/00-corpus-goals.md). That added
two required fields, `accessible_name` and `accessible_name_source`, and the 12
existing records predated them.

Each was backfilled by reading the recorded markup, which is verbatim, and
computing the name a screen reader would announce:

- 8 items are named by the image's own alt text: fi-0001, fi-0003, fi-0004,
  fi-0005, fi-0006, fi-0010, fi-0011 by `alt`, and the name is that alt value.
- fi-0002, fi-0007 and fi-0009 are named by the control's own visible text. In
  fi-0009 the image carries `aria-hidden="true"`, so its alt text contributes
  nothing and the link is named by the span inside it.
- fi-0008 and fi-0012 are named by an `aria-label`. In fi-0008 the label sits on
  the link and overrides the SVG's own `<title>`, which is why the recorded name
  is "Go to the GOV.UK homepage" rather than the "GOV.UK" in `observed_alt`.

No item had to be dropped: all 12 controls were already named. No other field was
touched and no status changed.
