# Batch 01 notes

30 items in, 10 kept, 20 dropped.

Kept: fi-1802, fi-4921, fi-9378, fi-1784, fi-5153, fi-1591, fi-1841, fi-5297,
fi-5375, fi-10750.


## The rule I applied, so later batches match

Three cases come up over and over, and the corpus is only coherent if they are
judged the same way every time.

1. `observed_alt` is a non-empty string. Judge that string. It is the
   description the site attached to the image, and it is what a model would be
   scored against.

2. `observed_alt` is `null` or `""` and the name comes from the control's own
   `aria-label` or `title`. Judge that text. The site did label the graphic, it
   just did it on the control, which is the normal and correct way to label an
   icon-only button. `fi-1802`, `fi-1591`, `fi-1841` and `fi-10750` are kept on
   this basis.

3. `accessible_name_source` is `control-text`, meaning the control has its own
   visible or visually hidden text and the icon beside it is decorative by
   context. Nobody wrote alternative text for the image, so there is no pair to
   confirm. Dropped: `fi-1800`, `fi-5774`, `fi-6349`, `fi-1639`, `fi-2615`.

   These are not badly built pages. `fi-1639` in particular is textbook: the
   SVG is `aria-hidden="true"` and the button carries a visually hidden "Play".
   It is dropped because a benchmark of image-to-alt has nothing to ask about
   an image whose correct alt is nothing.


## Why the drop rate is high

Twelve of the twenty drops are alt quality, and nine of those are the same
finding: a logo or wordmark that links somewhere, labelled with the bare brand
name. Both `directives/review.md` and the alt text criteria in the root
`README.md` call this weak rather than good, because for a link the destination
is what matters: `alt="W3C Logo"` is poor, `alt="W3C home"` is high quality.

This is worth flagging as a finding about the corpus rather than about the
batch. `linked-standalone-logo` is the largest sub-type in the selection, 61 of
250 items, and if the brand-name-only pattern holds at this rate then most of
that bucket will not survive. That is the honest answer, not a reason to soften
the standard: a reference corpus of functional images whose reference alt is
"Acme" would teach a model to name the picture.

Two drops were ambiguity rather than quality. `fi-5773` has an
`aria-label="home page"` on the link and `alt="AP Logo"` on the image inside
it, and `fi-0380` labels its chevron "AngleDown" inside a button labelled
"menu". In both there are two competing shipped descriptions and no single
reference. The directive says to judge conservatively when you cannot tell, so
they are dropped.

One drop was functionality, not alt: `fi-9379` is a book cover inside a link to
the book. The cover conveys what the book looks like, and the link's own text
carries the label, so it is an informative image in a link. Its `alt=""` is
correct, which is why `alt_quality` is `good` and the verdict is still `drop`.


## Sub-types corrected

- `fi-1590`, `fi-10607`, `fi-10679`: proposed `standalone-navigational-link`,
  corrected to `linked-standalone-logo`. All three are wordmarks linking to a
  main page. Harvest can only compare the href against the site root, and
  `/wiki/Main_Page` is not the root path, so it guesses wrong on every wiki.
  Worth noting in directive 00 if it recurs.
- `fi-1841`: proposed `standalone-navigational-link`, corrected to
  `action-or-toggle-icon`. It is an `<a href="/search">` but carries
  `aria-expanded="false"` and opens a panel.


## Two problems for a person to look at, not for me to fix here

- `functional-non-unicode-emoji` and `structural-break-or-reader-control` are
  still at zero. They can only be assigned by review, and nothing in this batch
  was either. If nine batches pass with none, that is a finding about the
  taxonomy.
- The corpus validation UI shows `observed_alt` and substitutes "(empty alt
  text)" when it is `null`. For every case 2 item above, a human validator will
  see "(empty alt text)" and never see the `aria-label` that is actually under
  review. The exported records carry `accessible_name` and
  `accessible_name_source` already, so this is a UI change in that project, not
  a corpus change.
