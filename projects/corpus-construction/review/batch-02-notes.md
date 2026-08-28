# Batch 02 notes

30 items in, 13 kept, 17 dropped.

Same three-case rule as batch 01. See
[batch-01-notes.md](batch-01-notes.md); it is the standard for every batch.


## New distinctions this batch forced

- **An image of text that makes a statement is not a bare brand name.**
  `fi-10726` is a "Powered by MediaWiki" badge linking to mediawiki.org, and it
  is kept. The alt transcribes an image of text, and the sentence it makes is
  what the link is for. Compare `fi-0586`, "Lulu Logo" on a link to the site
  root, which tells a person nothing about where they will land.

- **The best and worst version of the same alt text, from the same
  organisation.** `fi-1627` ships `W3C homepage` on the W3C logo and is kept.
  `fi-1631` ships `W3C` on the same logo, on a TR document, and is dropped. The
  root README uses this exact pair as its example of poor and high quality, so
  the corpus now contains the real thing.

- **Redundant alt on a link that already has text.** `fi-1881` and `fi-1925`
  are Harvard's Instagram and TikTok links. Both contain a visible text label
  and an `aria-hidden` image that nonetheless carries `alt="Instagram"` and
  `alt="TikTok"`. The correct alt is empty, which is what `fi-1637` on w3.org
  does and why that one is kept. Dropped as weak, not wrong: nothing is
  misdescribed, it is just said twice.

- **Label in name.** `fi-1932` announces "Open Menu" from an `aria-label` while
  the visible text reads "Explore". Anyone driving the page by voice asks for
  what they can see and gets nothing. Dropped even though "Open Menu" would be
  good alt text in isolation.

- **A control that is hidden from everyone.** `fi-7285` is a BBC account link
  carrying both `hidden` and `aria-hidden="true"`. It should never have been
  collected: nothing about it reaches a screen reader. This is a harvest gap,
  not a judgment call. `harvest.mjs` honours `aria-hidden` on the image but not
  on the interactive ancestor. Worth fixing before the next harvest.


## Sub-types corrected

Seven of thirty, which is a high rate and all in the same two directions.

- To `linked-standalone-logo` from `standalone-navigational-link`: `fi-9447`,
  `fi-1628`. Wikis again, plus a portal origin that is not the domain root.
- To `standalone-navigational-link` from `linked-standalone-logo`: `fi-6912`,
  `fi-10742`, `fi-10751`. All three are icon links to an external destination
  whose href happens to be that other site's root, which is what
  `harvest.mjs`'s root test matches on.
- To `action-or-toggle-icon`: `fi-1396`, an `<a role="button">` hamburger.
- To `form-control-or-image-button`: `fi-2616`, the search submit button on
  usa.gov. The root README puts "an icon inside a `<button>` tag to trigger an
  on-screen action" in this sub-type when it submits a form or runs a search,
  and reserves `action-or-toggle-icon` for interface state such as expand,
  settings and delete. That reading is what I am applying, and it matters
  because `form-control-or-image-button` is the thinnest fillable sub-type.

The pattern in the first three groups is one bug with two faces: harvest
decides logo versus navigational link by comparing the href against the site
root, which mislabels every off-site root link and every wiki main page. Worth
recording in directive 00.
