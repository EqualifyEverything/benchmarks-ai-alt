# Seed lists

One plain text file per sector. The file name, without `.txt`, is the `sector`
recorded on every item harvested from those URLs. `tools/harvest.mjs` reads every
`.txt` file here, or one of them with `--sector NAME`.

Format: one http or https URL per line. Blank lines are ignored, and everything
from a `#` to the end of a line is a comment.

    # a comment on its own line
    https://example.gov/           # or after a URL

The harvester follows same-host links from each seed, up to `--follow N` per page
and `--pages N` per host, so a section index makes a better seed than a deep
page. It never leaves the host it started on.

Adding coverage is the normal way to grow the corpus: add URLs, harvest, archive,
select. `./run.sh --status` says which sectors and sub-types are short.

Two things to keep in mind when adding URLs:

- `robots.txt` is honoured, and some hosts refuse crawlers outright. That is not
  a failure. A refused host yields nothing, the harvester says so, and the URL is
  worth leaving in the file as a record that it was tried.
- Pages that render their interface in JavaScript yield nothing, because the
  harvester reads the HTML as served. Prefer server-rendered pages. This is why
  `webapp.txt` leans on issue trackers, wikis and forums.

Nothing behind a login, a paywall, or a consent wall belongs here.
