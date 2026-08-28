# Batch 08 notes

30 items in, 3 kept, 27 dropped. The thinnest batch by a wide margin, and worth
explaining rather than leaving as a number.

Standing rules: [batch-01-notes.md](batch-01-notes.md), refined in batches 02
through 07.


## Why only three

The batch is almost entirely one thing. Twelve items are news or story cards:
lithub, Chicago Tribune, Louisiana, Berkeley, Washington, CDC. Two more are
Census teasers where the link's own text is the headline and the whole blurb.
Five are duplicates of templates already decided: two Coursera mega menus, one
Coursera search button, one Al Jazeera live link, two Berkeley play-video
buttons. Two are MediaWiki default titles. That leaves very little to keep.

This is what the tail of a selection looks like. `select.mjs` filled the
per-sub-type and per-sector quotas first from the widest domains it had, so the
last forty items are the ones the caps pushed to the back: extra pages of sites
already represented, and the templates that repeat across those pages.


## Duplicates are now the second largest drop reason

Five this batch, against two in batch 07. All five carry `alt_quality: good`,
because the sites got them right and the corpus already holds the item.

- `fi-8115`, Al Jazeera live link, duplicate of `fi-8098`. Same href, same
  `aria-label`, different icon colour class. The colour class is why the SVG
  bytes differ and `select.mjs` did not catch it.
- `fi-2533`, Coursera search button, the third copy after `fi-2297` kept and
  `fi-2453` dropped.
- `fi-2162` and `fi-2163`, Berkeley play-video buttons, duplicates of `fi-2157`
  kept in this batch.

`select.mjs` deduplicates on the `image_sha256` and `element_role` pair. That
catches byte-identical icons and misses everything a build tool touches:
generated `id` attributes, per-instance colour classes, cache-busting query
strings. The fix for the next harvest is to dedupe on a normalised form of
`element_html` as well: strip attribute values that look generated, then hash
what is left. That would have caught all five of these before a human ever saw
them.


## MediaWiki links every image to its own file page

`fi-11323` is a warning icon inline in the Manual:FAQ text. It is informative,
not functional, and nobody authored a control around it. MediaWiki wraps every
image in a link to its file description page, so `harvest.mjs` finds an
interactive ancestor and proposes the item.

Two other MediaWiki items, `fi-11304` and `fi-11308`, are genuine icon links,
dropped for a different reason: the only text is the platform's default `title`,
`"Special:MyLanguage/Manual:Extensions"`. It does name the destination, in a
sense, but it names it as a system path with two namespace prefixes. `weak`
rather than `wrong`, because the information is there and only the expression
fails.

Together these mean the wiki domains in this corpus produce a high proportion of
platform artefacts. Worth a note in the coverage report next harvest.


## The alt is right and the link is wrong

Six items this batch are photographs whose alt describes the photograph
accurately and is also the link's only accessible name, while the headline sits
in the link's `title` attribute: `fi-2087`, `fi-8719`, `fi-8753`, and the CDC
card `fi-2753`. A person hears a caption where they needed a destination.

This is a real accessibility defect, and it is not one this corpus can score,
because the failure is in the pairing rather than in the alt text. Recording it
here because it turned up four times in thirty items and will keep turning up:
it is what a content management system does when the same field feeds both the
`alt` and the card.


## The one contrast worth keeping

`fi-4897` and `fi-4910` are both X icons on census.gov, and they were kept
together on purpose. `fi-4897` is in the footer, titled `"X (Twitter)"`, and goes
to the bureau's account. `fi-4910` is a share control on an article, labelled
`"Share on Twitter"`, and posts the current page. Visually identical, different
jobs, and the site labelled each for its job. That is the criteria's "action over
description" demonstrated within one site.


## Sub-types corrected

- `fi-2533` to `form-control-or-image-button`
- `fi-4882` to `linked-standalone-logo`
- `fi-2157`, `fi-2162`, `fi-2163` to `action-or-toggle-icon`
- `fi-5356` to `linked-complex-graphic-or-image-map`, the fifth item in that
  sub-type. A fire potential map linking to the outlooks that explain it, so
  informative and functional at once, which is what the sub-type is for. Dropped
  on alt quality: the alt says "Click for", which is a mouse instruction.
