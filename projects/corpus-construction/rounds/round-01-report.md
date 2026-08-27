# Round 01 adversarial review report


## Summary

Reviewed all 12 candidate items. Verdicts:

- Accepted: 3 (fi-0002, fi-0006, fi-0010)
- Revise: 4 (fi-0007, fi-0008, fi-0009, fi-0011)
- Reject: 5 (fi-0001, fi-0003, fi-0004, fi-0005, fi-0012)

Accept rate: 25 percent. Reject rate: 42 percent. Revise rate: 33 percent.

The low accept rate is expected and appropriate for a first round. Five
items are rejected for leakage, which the seeking agent itself flagged.
Four items need minor corrections to recorded metadata.


## Per-item verdicts

- fi-0001: reject. LEAKAGE. Observed alt matches gold exactly.
- fi-0002: accept. CLEAN. Verified empty-alt pattern with adjacent text.
- fi-0003: reject. LEAKAGE. Observed alt matches gold exactly.
- fi-0004: reject. LEAKAGE. File name and observed alt both reveal gold.
- fi-0005: reject. LEAKAGE. Observed alt matches gold exactly.
- fi-0006: accept. CLEAN. Non-leaky logo link with sound adjudication.
- fi-0007: revise. CONTEXT-INACCURATE. SVG path data truncated in
  element_html.
- fi-0008: revise. CONTEXT-INACCURATE. Anchor attribute and SVG content
  omitted from element_html.
- fi-0009: revise. CONTEXT-INACCURATE. observed_alt_verdict says
  "empty-appropriate" but the alt attribute is "Instagram" (non-empty).
- fi-0010: accept. CLEAN. Image map with verified usemap markup.
- fi-0011: revise. CONTEXT-INACCURATE. observed_alt_verdict says
  "correct" but gold standard says observed is underspecified.
- fi-0012: reject. LEAKAGE. Sprite symbol ID and aria-label expose the
  answer.


## Provenance verification

Every page URL was retrieved via curl. Results:

- w3.org/WAI/tutorials/images/functional/ : resolved, markup confirmed
  for fi-0001 through fi-0004 and fi-0012.
- gutenberg.org : resolved, markup confirmed for fi-0005 and fi-0006.
- loc.gov : resolved, markup confirmed structurally but element_html in
  fi-0007 is abbreviated.
- gov.uk : resolved, markup confirmed structurally but element_html in
  fi-0008 omits attributes and SVG body.
- harvard.edu : resolved, markup confirmed for fi-0009.
- geology.com/world/world-map.shtml : resolved, markup confirmed for
  fi-0010.
- nps.gov/subjects/digital/nps-apps.htm : resolved, markup confirmed
  for fi-0011.

All image URLs are embedded in the served HTML and resolve as referenced.


## Progress against targets

All counts below are accepted items only (3 accepted this round).

### Coverage

- Total accepted: 3 of 250
- Category 1: 2 (fi-0002, fi-0006) of 30
- Category 2: 0 of 30
- Category 3: 0 of 30
- Category 4: 1 (fi-0010) of 30
- Category 5: 0 of 30

### Sub-type

- linked-standalone-logo: 1 (fi-0006)
- standalone-navigational-link: 0
- form-control-or-image-button: 0
- action-or-toggle-icon: 0
- functional-non-unicode-emoji: 0
- linked-complex-graphic-or-image-map: 1 (fi-0010)
- structural-break-or-reader-control: 0

### Difficulty and discrimination

- Empty-alt share: 1 item (fi-0002), 33 percent of accepted (target:
  15 percent). Met locally but sample is tiny.
- Dual-purpose share: 1 item (fi-0010), 33 percent of accepted (target:
  10 percent). Met locally but sample is tiny.
- Ambiguous share: 2 items (fi-0006, fi-0010), 67 percent of accepted
  (target: 20 percent). Met locally but sample is tiny.

### Source diversity

- Domains represented in accepted items: w3.org (1), gutenberg.org (1),
  geology.com (1). Three domains across 3 items. No concentration
  problem yet.
- Domains per sub-type: linked-standalone-logo has 1, linked-complex-
  graphic-or-image-map has 1. Far below 8 target.


## Corpus-level findings

### Finding 1: heavy reliance on WAI tutorial page (blocking)

Five of 12 candidates came from the WAI functional images tutorial. All
five from this page are either leaky (observed alt matches gold) or have
element_html problems (fi-0012 leaks via sprite ID). This page is a
teaching resource with exemplary alt text by design, making it
structurally unsuited for benchmark items. The seeking agent should not
draw further items from pages whose primary purpose is demonstrating
correct alt text, because those pages will always leak.

### Finding 2: no category 2, 3, or 5 items accepted (blocking)

Zero accepted items in categories 2 (action controls), 3 (functional
emojis), or 5 (structural controls). The only category 2 candidates
(fi-0004, fi-0005, fi-0012) are all rejected for leakage. Category 3
and 5 have zero candidates at all. The corpus cannot meet its targets
without substantial new collection in these areas.

### Finding 3: element_html verbatim requirement not met for inline SVG
items (non-blocking, fixable)

Items fi-0007 and fi-0008 abbreviate large SVG content. This is
understandable given SVG size but violates the schema requirement. The
seeking agent needs a policy: either include the full SVG (which may be
several KB) or propose a schema amendment for inline-svg implementations.
This is non-blocking because the items are marked revise and fixable.

### Finding 4: observed_alt_verdict inconsistencies (non-blocking,
fixable)

Two items (fi-0009, fi-0011) have observed_alt_verdict values that
contradict either the recorded observed_alt value or the gold standard
reasoning. Both are fixable with a single field change.

### Finding 5: no items from pages with poor or absent alt text
(blocking)

All accepted items come from pages with at least reasonable alt text.
The benchmark's value depends on items where the site's own alt is
wrong, forcing the gold standard to demonstrate independent judgment.
If all gold standards either match observed alt (leaky) or differ only
slightly (weak discrimination), the corpus cannot measure model
capability. Future rounds must prioritize pages with bad or missing alt.


## Repeating findings

None. This is the first review round.


## Accept rate commentary

Accept rate of 25 percent is appropriate for a first round with known
leaky items. The seeking agent already flagged the leakage on 5 items,
so the rejections are not surprising. The revisions are minor metadata
corrections. The three accepts survived thorough provenance checking and
gold standard evaluation.


## Blocking corpus-level findings this round

1. Heavy reliance on WAI tutorial page (new this round).
2. No category 2, 3, or 5 items accepted (new this round).
3. No items from pages with poor or absent alt text (new this round).


STATUS: new-blocking-findings=yes
