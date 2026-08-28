# Batch 03 notes

30 items in, 11 kept, 19 dropped.

The rule is in [batch-01-notes.md](batch-01-notes.md) and the extra
distinctions in [batch-02-notes.md](batch-02-notes.md). Both hold here.


## The line I had to draw: icon or content image

Three items in this batch are pictures inside a control, with a correct empty
alt, and one is an icon in the same shape. They cannot all go the same way, so
the line is this: a glyph, a logo or a UI icon is a functional image; a
photograph, a book cover or a video still is a content image that happens to sit
inside a link.

- Dropped as not functional: `fi-1650`, a video thumbnail in a disclosure
  summary, and `fi-2691`, a regulations cover photo in a link. Both have the
  right empty alt. Both are `alt_quality: good` and `verdict: drop`, which is
  the combination that says the site did nothing wrong and the item still does
  not belong in this corpus.
- Kept: `fi-10771`, a generic component icon with an empty alt beside the link
  text "Core". Same mechanics, but the graphic stands for a thing in the
  interface.

`fi-9379` in batch 01, a book cover, went the same way as `fi-1650`.


## Over-description is a distinct failure from bare brand naming

`fi-2693` is the clearest example the corpus has of alt text that fails by
saying too much: `Section508.gov Home; GSA Starmark Flag logo with text:
Section508.gov Buy. Build. Be Accessible.` The first two words are exactly
right. Everything after the semicolon describes the artwork and transcribes the
tagline, which the W3C position quoted in the root README calls irrelevant to a
screen reader user. Dropped as weak, and worth keeping in the record as the
opposite pole from `fi-1631`'s bare `W3C`.


## Hidden is not aria-hidden

`fi-7285` in batch 02 was dropped partly because the control carried `hidden`
and `aria-hidden="true"` together. `fi-1662`, the Node.js theme toggle, carries
`hidden` alone, and is kept. The distinction: `hidden` alone is a progressive
enhancement gate, removed by the same script that makes the toggle work, and a
theme toggle without script has nothing to toggle. `aria-hidden` on top of it
means the control stays excluded from assistive technology even once it is
displayed.


## Two more good keeps worth naming

- `fi-1065`, IKEA. `alt=""` on the image and `aria-label="IKEA Home"` on the
  link. Brand plus destination, and nothing said twice.
- `fi-10789`, bugs.python.org. `alt="homepage"` on the Python logo. Four
  letters shorter than the brand name and infinitely more useful, which is the
  whole argument of the criteria in one item.


## Sub-types corrected

- `fi-1065` to `linked-standalone-logo`. The href is the locale home page, which
  is the root a person means, but not the bare domain, so harvest's root test
  missed it. That is now the same finding three batches running.
- `fi-2707` to `form-control-or-image-button`, a search submit button, following
  `fi-2616` in batch 02.
- `fi-9573` to `action-or-toggle-icon`. Its href is a fragment and script posts
  the page to Facebook, so it is not a navigational link at all. That is also
  why its alt is dropped: a person hears "Facebook" and expects to be taken
  there rather than to publish something.
