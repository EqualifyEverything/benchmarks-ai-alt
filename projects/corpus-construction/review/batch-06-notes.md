# Batch 06 notes

30 items in, 8 kept, 22 dropped.

Standing rules: [batch-01-notes.md](batch-01-notes.md), refined in batches 02
through 05.


## Avatars are content images

Four items, `fi-10825`, `fi-10826`, `fi-10915` and `fi-10993`, are Discourse
avatars used as links to the poster's profile. All dropped. An avatar is a
picture of the person the link leads to, which puts it with the book covers and
the news photographs rather than with the icons. None of them carries an alt
attribute either; the label lives on the link and mixes the username with
topic-list state, "Original Poster, Most Recent Poster".

Worth noting for the coverage report: those four plus three book covers, one
news photo, one infographic and one video thumbnail mean a third of this batch
went out as not functional. `harvest.mjs` cannot tell a photograph from a glyph,
so this is the review pass doing the job it exists for, not a fault in the
selection.


## Same page, both answers

`fi-2148` and `fi-2149` are the header and footer logos on one Berkeley page.
The header says `alt="UC Berkeley home"` and is kept. The footer says `alt="UC
Berkeley"` and is dropped. One word apart, and the whole criterion sits in that
word. This is the fifth site to supply its own pair, after W3C, Library of
Congress, SourceForge and Al Jazeera.


## Al Jazeera, and why the two logos went different ways

`fi-8097` in batch 05 was dropped and `fi-8114` here is kept, and both announce
"al jazeera, link to home page". The difference is where the text lives. In
`fi-8097` it is hidden text inside the link, so the control has its own text and
the correct alt for the graphic is empty; the site simply never wrote one. In
`fi-8114` it is an `aria-label` on the link itself, which is the site labelling
the control and the graphic in it. That is case 2 and case 3 of the batch 01
rule, working as intended on the same site.


## The best state-aware label so far

`fi-5555`, GOV.UK. `aria-label="Hide search menu"` on a toggle that is currently
expanded, with `data-text-for-hide` and `data-text-for-show` in the markup so the
label follows the state. Most toggles in this corpus name the action in one
direction and leave it there.


## Redundant alt in a different vocabulary

`fi-1765` and `fi-1766` on postgresql.org: download buttons reading "Linux" and
"macOS" with images alt'd "Linux Logo" and "Apple Logo". The second one repeats
the button text using a different word for the same thing, which is worse than
plain repetition, because a person hears "macOS Apple Logo" and has to work out
whether those are two things.


## Sub-type corrected

`fi-5557` to `form-control-or-image-button`, the GOV.UK search submit button.
Dropped on alt quality, but recorded correctly.
