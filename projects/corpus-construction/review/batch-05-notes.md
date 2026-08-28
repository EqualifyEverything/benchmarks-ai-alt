# Batch 05 notes

30 items in, 10 kept, 20 dropped.

Standing rules: [batch-01-notes.md](batch-01-notes.md), refined in batches 02,
03 and 04. The off-site logo distinction from
[batch-04-notes.md](batch-04-notes.md) applies here to `fi-11266`, Debian's logo
on lists.debian.org linking to debian.org.


## aria-hidden decides the ambiguity cases

Batch 01 dropped `fi-5773` and batch 03 dropped `fi-1663` because a control and
the graphic inside it carried two different descriptions and there was no single
reference. `fi-7920` and `fi-7957`, both ProPublica, look the same at first: the
button has an `aria-label` and the SVG has a `<title>`. The difference is that
the SVG sits inside `<span aria-hidden="true">`, so its title is announced to
nobody. One reference, unambiguous, kept.

Worth knowing for the human stage: `observed_alt` on `fi-7920` records the SVG
title "Menu" even though nothing announces it, because that field reports what
the graphic carries. The `accessible_name`, "Open navigation menu", is the one
under review.


## An aria-label that only repeats the button's visible text

Four items this batch: `fi-2182`, `fi-2191`, `fi-2296`, and `fi-11133` in batch
03. The pattern is a button with its own visible text, an icon beside it, and an
`aria-label` that restates the text. Nothing was written for the icon, so there
is no image and alt pair, and these go the same way as the plain `control-text`
cases. They are not defects: `fi-2191`'s "Open quick links" contains the visible
"Quick Links", so voice control still works.


## The first item in two empty sub-types, and how it got there

`fi-10804` on savannah.gnu.org is a back-to-top arrow, and it is now the
corpus's only `structural-break-or-reader-control`. The root README defines that
sub-type as reading mechanics and document flow, and returning a reader to the
top of a long document is exactly that. It is a judgment call, made explicit
here so the human stage can overturn it: `harvest.mjs` cannot propose this
sub-type at all, so every item in it will arrive this way.

`functional-non-unicode-emoji` is still at zero after 150 items.


## Where the icon and content-image line falls

Kept as functional glyphs with a correct empty alt: `fi-1705` and `fi-1706`,
Font Awesome book and video icons beside their own headings.

Dropped as not functional: `fi-10185` and `fi-10239`, onboarding illustrations
on Open Library cards, also with correct empty alt. An illustration of a person
reading is a picture that decorates a card; a book glyph stands for the thing
the link leads to. Both are `alt_quality: good` because the sites got them
right. Also dropped: `fi-4890`, `fi-4891` and `fi-4903`, YouTube thumbnails
inside census.gov carousel tabs, which fail twice over, as content images and as
controls labelled only "Slide 1" and "Slide 2".


## Two more wrongs

- `fi-1712`, kernel.org documentation. `alt="Logo"` on a logo whose href is
  `#`. Nothing works about it.
- `fi-10160`, Poetry Foundation. `alt="Poetry June2026 cover CMYK"`: a colour
  space, a file naming convention, and the wrong month, on a cover the site
  labels "July/August 2026" elsewhere in the same link.


## Same site, both answers, again

SourceForge ships `alt="SourceForge logo"` on one template (`fi-11113`,
dropped) and `title="home"` on the other (`fi-11207`, kept). W3C did the same in
batches 02 and 03, and Library of Congress in batch 03. Three sites now supply
their own before-and-after pair, which is more persuasive than any two sites
compared to each other.
