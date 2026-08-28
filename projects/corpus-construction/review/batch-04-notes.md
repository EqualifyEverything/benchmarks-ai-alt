# Batch 04 notes

30 items in, 11 kept, 19 dropped.

Standing rules: [batch-01-notes.md](batch-01-notes.md), plus batch 02 and 03.


## A refinement to the brand-name rule, and one item it makes inconsistent

Three batches have dropped linked logos whose alt is the bare brand name. This
batch showed that the rule needs a distinction, because it was about to drop
alt text that is correct.

- A logo linking to **this site's own root**. The brand name is weak: the
  person already knows what site they are on, and what they need to hear is that
  the link goes home. Dropped here: `fi-1694` "Git", `fi-9773` "The Public
  Domain Review", `fi-2747` "Centers for Disease Control and Prevention".
- A logo linking to **another site's home page**. The brand name *is* the
  destination, so naming it is the right answer. Kept here: `fi-9630`
  "Congress.gov" on loc.gov, `fi-1723` "Kraken Tech" and `fi-1724` "PostHog" as
  Django sponsors, and the Wayfair family's store handover logos `fi-1428`,
  `fi-1461`, `fi-1499`.

The test is the destination, not the word. `fi-10183` links off-site to
archive.org and is still dropped, because its alt is "Internet Archive logo" and
the trailing "logo" describes the image.

This is a refinement, not a reversal, but it does make one earlier verdict
wrong: `fi-10709` in batch 01, `alt="Wikimedia Foundation"` on a link from
commons.wikimedia.org to wikimedia.org, is an off-site logo and would be kept
under this reading. It is already applied as `dropped` and
`tools/apply-review.mjs` refuses to re-review a decided item, by design. Noting
it here is the audit trail. It costs the corpus one item and does not put
anything bad in front of a person.


## Content images in controls, again

`fi-2070` is an Instagram photo in a link and `fi-2174` and `fi-2175` are
photographs inside play buttons. All dropped as not functional, following
`fi-9379` and `fi-1650`. `fi-2070` keeps `alt_quality: good`, because a photo
described as "Four UL students pet a dog during Mental Health Week" is good
informative alt text and the site did nothing wrong. The two Berkeley ones are
`weak`: inside a play button, joining "Play Video: " to a description of what
the still shows does not tell anyone what will play. One of them also carries an
`aria-labelledby` pointing at an id that does not exist on the page.


## The only outright wrong alt text so far

- `fi-2735`, CDC. `alt="Health Topics"` on a photo linking to Ebola travel
  guidance, with "Ebola Travel Updates" printed over it. It names a different
  destination than the one the link goes to.
- `fi-11227`, SourceForge. `alt="Icon"`. One word, no information, on a button
  that already carries its own text.

Three wrongs in 120 items reviewed. The common failure is not wrong alt text; it
is alt text that describes the picture, repeats adjacent text, or does not exist
at all.


## Verbose alt on a logo, second example

`fi-2746`, CDC: `Centers for Disease Control and Prevention. CDC twenty four
seven. Saving Lives, Protecting People`. It even spells out the stylised 24/7
mark phonetically. Same failure as `fi-2693` in batch 03, from a different
agency, and the two make a good pair for anyone arguing about brevity.


## Sub-types corrected

`fi-1428`, `fi-1461`, `fi-1499` to `linked-standalone-logo`. All three are the
Wayfair group's store-switching logos, whose href is a `handover.php` URL that
lands on the other store's home page, which harvest's root test cannot see.
Together with the wiki main pages and the locale home pages from earlier
batches, harvest's logo-versus-link test has now mislabelled items in every
batch. It is the single most useful fix for the next harvest.
