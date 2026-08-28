# Batch 09 notes

The last batch: 10 items in, 2 kept, 8 dropped.

Standing rules: [batch-01-notes.md](batch-01-notes.md), refined in batches 02
through 08.


## Two genuine wrongs, both on weather.gov

These are the clearest defects in the whole review, and both are the same
mistake made twice on one site.

- `fi-5507`. The link goes to `/safety/flood`, the image file is `Flood.png`, the
  visible label beside it reads "Flood", and the alt reads "Wildfire". Somebody
  copied the wildfire block and changed everything except the alt attribute.
- `fi-5515`. The link goes to the publication brochures page, the visible label
  reads "Brochures", the image file is `brochures_ic.png`, and the alt reads
  "Cooperative Observers", a different NWS programme.

In both cases a sighted person sees the correct label and a person listening
hears a different topic. Neither is a matter of taste, which is what makes them
useful: they are the only items in 250 where the alt text states something that
is not true. Both are dropped, because only `good` reaches human review, but they
are the best argument in the corpus for why the shipped alt cannot be trusted
without confirmation.


## The Edinburgh card pattern

Five items, `fi-2229`, `fi-2230`, `fi-2240`, `fi-2241` and `fi-2250`, are all
Drupal cards on ed.ac.uk. The link wraps the picture and nothing else. The
heading and blurb are siblings outside it. So the link's accessible name is
whatever the photograph's alt says, and the photographs are scenery, portraits
and aerial views described as scenery, portraits and aerial views.

Every one of those alt strings is a reasonable description of its image. Not one
of them says where the link goes. This is the "alt is right and the link is
wrong" family from [batch-08-notes.md](batch-08-notes.md), and it is the single
most common failure across the whole review: the CMS puts the picture in the link
and the words next to it.


## Kept

- `fi-5541`, an NWS Facebook icon whose alt names whose account and which
  service. The fourth item of that exact shape after `fi-10291`, `fi-10292` and
  `fi-4897`, and kept rather than dropped as a duplicate because it is a
  different site with a different destination.
- `fi-5620`, the App Store badge on nps.gov. The alt transcribes the words
  printed on the badge, and those words are "Download on the App Store", which
  names the action and the destination at once. An image of text where
  transcribing it was the right answer, alongside `fi-10726` from batch 02.


## Sub-type corrected

`fi-5591` to `linked-standalone-logo`, the Government of Canada signature.
`harvest.mjs` proposed `standalone-navigational-link` because the href is
`/content/canadasite/en.html` rather than `/`. That is the root-comparison bug
again, and it has now mislabelled items in all nine batches.
