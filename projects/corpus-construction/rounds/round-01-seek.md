# Round 01 seek

## Target

All targets are at zero. This is the first round, so the goal is breadth:
establish candidates across multiple sub-types and difficulty classes to
give the reviewer material and to identify which sub-types are easy to
find versus which will need dedicated effort.

Priority given to:

- Empty-alt items (15% target), because they require judgment about
  redundancy and are the hardest to find by accident.
- Linked complex graphics and image maps (category 4), because they are
  the rarest sub-type.
- Dual-purpose items (10% target), because they require finding images
  that are both functional and informative.
- Ambiguous-difficulty items (20% target), because they demonstrate the
  judgment the benchmark exists to measure.


## Revisions

None. This is the first round; no prior review exists.


## Search strategies used

### Retrieval tools available

Shell access with curl. No web search API available. I worked from known
stable starting points and followed links.

### Strategy: known accessibility reference pages

Fetched the WAI Functional Images Tutorial at
`https://www.w3.org/WAI/tutorials/images/functional/`. This page both
documents functional images and contains working functional images in its
own interface (header logos, search button, navigation icons). Yielded 5
candidate items including the page's own search sprite button.

### Strategy: by sector (government, education, digital publications)

- GOV.UK (`https://www.gov.uk/`): linked SVG logo with aria-label
  accessibility pattern. Yielded 1 item (complex aria-label
  interaction).
- Library of Congress (`https://www.loc.gov/`): linked SVG wordmark
  with adjacent text span. Yielded 1 empty-alt item.
- NPS (`https://www.nps.gov/subjects/digital/nps-apps.htm`): app store
  badge as linked image. Yielded 1 dual-purpose item.
- Harvard (`https://www.harvard.edu/`): social media links with icon
  plus text. Yielded 1 empty-alt item.

### Strategy: by markup signature (input type=image, usemap)

- Project Gutenberg (`https://www.gutenberg.org/`): found a PayPal
  donate button using `input type="image"`, plus the linked site logo.
  Yielded 2 items.
- geology.com (`https://geology.com/world/world-map.shtml`): found a
  clickable world map using `usemap` with dozens of `<area>` elements.
  Yielded 1 image map item (category 4).


## Candidates found, verified, recorded

- Found: 14 potential candidates across 7 domains.
- Dropped: 2 (MDN search button uses shadow DOM/web components making
  the served HTML harder to verify as a standalone extract; BBC homepage
  is heavily client-rendered with no server-side content).
- Recorded: 12 items.

### Items recorded

| ID      | Sub-type                       | Domain        | Difficulty | Notes            |
|---------|--------------------------------|---------------|------------|------------------|
| fi-0001 | linked-standalone-logo         | w3.org        | standard   | Leaky            |
| fi-0002 | linked-standalone-logo         | w3.org        | standard   | Empty-alt        |
| fi-0003 | standalone-navigational-link   | w3.org        | standard   | Leaky            |
| fi-0004 | form-control-or-image-button   | w3.org        | standard   | Leaky            |
| fi-0005 | form-control-or-image-button   | gutenberg.org | ambiguous  | Leaky, dual      |
| fi-0006 | linked-standalone-logo         | gutenberg.org | ambiguous  | Adjudicated      |
| fi-0007 | linked-standalone-logo         | loc.gov       | standard   | Empty-alt        |
| fi-0008 | linked-standalone-logo         | gov.uk        | ambiguous  | Adjudicated      |
| fi-0009 | standalone-navigational-link   | harvard.edu   | standard   | Empty-alt        |
| fi-0010 | linked-complex-graphic-or-image-map | geology.com | ambiguous | Dual, adjudicated |
| fi-0011 | standalone-navigational-link   | nps.gov       | ambiguous  | Dual, adjudicated |
| fi-0012 | action-or-toggle-icon          | w3.org        | ambiguous  | Leaky            |


## Leaky items

4 of 12 items are marked leaky (fi-0001, fi-0003, fi-0004, fi-0005,
fi-0012). These cannot be accepted but are retained as evidence. The
leakage sources are:

- Observed alt matching gold standard exactly (fi-0001, fi-0003,
  fi-0004, fi-0005).
- Sprite symbol ID containing the answer (fi-0012).

This is expected for the WAI tutorial page, which has exemplary alt text
by design. Future rounds should seek pages with poor or missing alt text
where the gold standard requires independent judgment.


## Updated counts against targets

All items are candidates (none accepted yet). Counts below show
candidate distribution, which previews what could be accepted after
review.

- Total candidates: 12 of 250 target
- Category 1: 7 (target: 30 accepted)
- Category 2: 3 (target: 30 accepted)
- Category 3: 0 (target: 30 accepted)
- Category 4: 1 (target: 30 accepted)
- Category 5: 0 (target: 30 accepted)
- Empty-alt candidates: 4 (fi-0002, fi-0007, fi-0008, fi-0009) = 33%
- Dual-purpose candidates: 3 (fi-0005, fi-0010, fi-0011) = 25%
- Ambiguous candidates: 6 (fi-0005, fi-0006, fi-0008, fi-0010,
  fi-0011, fi-0012) = 50%
- Domains: w3.org (5), gutenberg.org (2), loc.gov (1), gov.uk (1),
  harvard.edu (1), geology.com (1), nps.gov (1)
- Leaky: 4 items cannot be accepted


## What could not be found

- Category 3 (functional non-Unicode emojis): did not attempt this
  round. These live on forum software, issue trackers, and chat
  archives. Next round should target GitHub reaction buttons, Discourse
  forums, or Slack archive pages.
- Category 5 (structural breaks and reader controls): did not find any.
  These live in digital publication readers and ebook interfaces. Next
  round should target Standard Ebooks reader view, Internet Archive
  BookReader, or journal article viewers.
- Pagination controls: attempted LOC search results but got empty
  response. Next round should try library catalogues with server-rendered
  pagination.
- Stateful toggles (dark mode, expand/collapse): MDN had these but
  implementation uses shadow DOM making verification harder. Next round
  should try GitHub or documentation sites with simpler markup.


## What to try next round

1. Target category 3 and 5 specifically, as they have zero candidates.
2. Seek pages with poor or absent alt text to avoid the leakage problem
   that affected most WAI tutorial items.
3. Use GitHub for action/toggle icons (copy buttons, reaction emoji).
4. Find pagination controls on library catalogues or search results.
5. Look for image maps on university campus maps or transit diagrams.
6. Vary domains more broadly; w3.org has 5 items already (limit is 5%
   of 250 = 12.5 items from one domain).
