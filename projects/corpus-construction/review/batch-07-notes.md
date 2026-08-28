# Batch 07 notes

30 items in, 10 kept, 20 dropped.

Standing rules: [batch-01-notes.md](batch-01-notes.md), refined in batches 02
through 06.


## A new reason to drop: template duplicates

Two items are dropped with `alt_quality: good`, which up to now has only meant
"correct alt on an image that is not functional". Here it means something else:
the item is fine and the corpus already has it.

- `fi-2453`, a Coursera search submit button, is the same template and the same
  label as `fi-2297`, kept in batch 05.
- `fi-11238`, a SourceForge newsletter link, is the same template and the same
  label as `fi-11123`, kept in this batch.

`select.mjs` deduplicates on `image_sha256` and `element_role`, and these
slipped through because both sites' SVGs embed a generated `id` that differs per
render, so the bytes differ while the picture does not. Two per page is the cap,
and these are one per page on different pages of one site. Recording the drop
here rather than quietly keeping both, because a human reviewer's time is the
scarce resource this pipeline spends.

The lithub.com story cards are the same problem in the other direction: five
items, `fi-10373`, `fi-10425`, `fi-10448`, `fi-10493` and `fi-10516`, all
photographs with the headline repeated as alt, from five different category
pages. All dropped as not functional anyway, so no duplicate rule was needed.
One site supplying a sixth of the batch is the domain cap in `select.mjs` doing
less work than it looks like it is doing: five percent of the corpus is twelve
items, and this site is under that.


## Nouns naming an area

`fi-8775` and `fi-8777` on wired.com are a hamburger announced as "Menu" and an
account icon announced as "Account". Both dropped. It is common practice and
nobody would be confused by the hamburger, but the criteria are explicit that
the alt text should name the action, and "Account" in particular could be a
sign-in, a panel, or a page. This is the conservative reading the directive asks
for, and it is the closest call in the batch. If the human stage disagrees with
anything here, it will be this.


## More sites with both answers

- National Park Service. `fi-5598`, the header arrowhead, has an empty alt
  because the link's text reads "National Park Service": kept. `fi-5601`, the
  footer lockup, spells the agency and department out in the alt on a link to the
  same root: dropped.
- Trac. `fi-11276` puts "TracDownload" in the alt and "Download Trac" in the
  title attribute, which is the better text in the field that gets announced
  second, if at all.


## The thin sub-types

`form-control-or-image-button` gained a correction on `fi-2453`, though the item
is dropped. `structural-break-or-reader-control` gained nothing this batch, and
`functional-non-unicode-emoji` is still empty after 210 items. Two batches left,
and I now expect both to finish at or near zero. That is a finding about the
taxonomy: emoji-as-image controls and reader-mechanics graphics exist, but not on
the front pages of the kind of sites this seed list crawls.
