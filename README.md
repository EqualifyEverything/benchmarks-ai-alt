# An AI Benchmark for Alt Text Generation

A public evaluation framework for AI-generated alt text, starting with
functional images.

Current milestone: by August 27, develop an AI prompt to identify and collect
functional image assets online, building a library of examples for alt text
generation and benchmarking.


## Project requirements

Accessibility is the number one priority of this project. It applies to
everything in this repository, not only to the subject we are measuring. A
benchmark for accessible alt text cannot ship inaccessible documents or
inaccessible code.

### Everything is plain text

Every file in this repository is plain text, readable and editable in any text
editor, any terminal, and any screen reader without special software.

This means:

- Documents are Markdown (`.md`) or `.txt`. No Word, PDF, Google Docs, Notion
  exports, slide decks, or other binary or proprietary formats.
- Data is plain text: `.csv`, `.json`, `.jsonl`, `.yaml`. No spreadsheets, no
  database dumps, no binary serializations.
- Results and reports are plain text. If a chart would help, publish the
  underlying numbers as text first. Any visualization is generated from that
  text and is never the only representation of a finding.
- No screenshots or diagrams standing in for information. Nothing important
  exists only inside an image. Images of text are exactly the failure this
  project measures.
- No HTML, no embedded styling, and no ASCII art in documents.
- Prose is wrapped at roughly 80 columns so it reads cleanly unrendered.
- Headings are semantic and nested in order. Structure carries meaning, so it
  has to survive being read as raw text.
- Lists are preferred over tables. Where a table is genuinely the clearest
  form, keep it narrow enough to read unrendered.
- Only widely supported Markdown. Nothing that degrades into literal
  punctuation when rendered, and nothing that relies on a specific renderer.
- Link text describes its destination. No "click here", and no bare URL
  standing in for a description.
- Emoji and symbols appear only when they are the subject being discussed,
  never as decoration and never as the sole carrier of meaning.

The images in the benchmark corpus are the one exception, and only because they
are the artifacts under test. They never carry project documentation. Each one
is recorded in plain text: source URL, taxonomy category, surrounding context,
and gold standard alt text.

### Code follows the same rule

Any code in this repository, and any project built inside it:

- Reads and writes plain text formats.
- Produces output that is usable without a graphical interface.
- Stores configuration and prompts as plain text, reviewable in a diff.
- Ships accessible interfaces if it ships an interface at all: semantic HTML,
  keyboard operable, screen reader tested, and never reliant on color alone.

The working rules for this repository, for people and for AI coding agents
alike, live in [AGENTS.md](AGENTS.md).


## Projects

Each project lives in its own directory under [projects/](projects/), with its
own goal, directives, data, and README.

- [Corpus construction](projects/corpus-construction/). Build the corpus of
  functional images, page context, and gold standard alt text that the benchmark
  scores against. Two agents in a loop, a seeking agent and an adversarial
  reviewer, with a mechanical stop condition. Built and tested; no corpus
  records collected yet.

The [projects index](projects/README.md) says how to add another one.


## The opportunity

AI now writes most of the alt text on the internet. Almost no one is measuring
whether it is any good, not in a way that reflects what blind and low vision
users actually need. The benchmarks the AI industry uses for image description
were built for sighted-author reference captions, not for the contextual
judgment that defines good alt text in practice.


## What we are doing

Building the public evaluation framework for AI-generated alt text. It will sit
alongside the GAAD AI Model Accessibility Checker (AIMAC) and become the
reference point that procurement teams, model developers, and the accessibility
community use to talk about image description quality.

The benchmark is something model developers can compete on. The target
capability is zero-shot quality: how well a model produces useful alt text from
the kind of general, unspecified prompts real humans send, without expecting the
user to know what to ask for. This is a benchmark for models, not a
behavior-change tool for end users.


## Our approach

The core of the work is a deterministic heuristic for what good alt text is.
Without that, there is no benchmark.

We are starting with functional images, the cases with the clearest ground
truth, like a lightbulb icon that visually stands for "insight." Functional
images give us a tractable place to prove out the heuristic and the scoring
methodology before we extend the framework outward. The longer-term target is
contextual description complex enough to handle something like the illustrations
in a Winnie the Pooh book, but we are not trying to solve that first.

Gold standards will likely need to differ by context type, and the standards
themselves do double duty: they expose how alt text professionals actually make
their decisions, giving model developers material to learn from rather than only
a score to chase.

### The question in front of us

What corpus of functional images and alt text do we use to build the gold
standard the benchmark scores against?


## Who we are

- Blake Bertuccelli-Booth, UIC. Assistant Director of Digital Accessibility
  Engineering, leading AI Leaders across UIC, Louisiana Tech, and the
  University of Louisiana at Lafayette.
- Joe Devon, GAAD Foundation. Co-founder of Global Accessibility Awareness Day,
  and the team behind the GAAD AI Model Accessibility Checker (AIMAC).
- Ben Ogilvie, ArcTouch, GAAD Foundation and A11yNYC. Accessible custom
  software development and the largest community conversation in the field.
- Yumeng Ma, University of Washington. CSE PhD student. Designed PACE, Prompt
  Accessibility Controlled Evaluation, a benchmarking testbed for controlled
  evaluation of accessibility in LLM-generated HTML form components. The
  current paper is under submission at ACM ASSETS.
- Caroline Desrosiers, Scribely. Founder and CEO of the professional alt text
  and audio description service, and lead on the initiative to add alt text and
  extended description properties to the IPTC Photo Metadata Standard.
- Michael Fu, University of Illinois Chicago. Digital Accessibility Specialist.


## Functional images

A functional image is one used to initiate actions by the user or reader. Not
aesthetic.

Functional images differ from informative images in intent:

- Primary intent: represent a system function, state, or utility, or initiate an
  action or navigation jump.
- Core question for alt text: what function, tool, state, or destination does
  this visual represent?
- Alt text goal: label the outcome, purpose, destination, or state, for example
  "Search" or "W3C home".
- Impact if missing: UI and state failure. Screen readers announce raw URLs or
  file names, or omit critical system state, such as missing that a server is
  "Offline".
- Effect of surrounding text: a redundancy filter. If adjacent text already
  names the state, function, or action, the image becomes decorative (`alt=""`)
  to prevent repeating the text.
- Context goal: prevent broken interactions.

There are two core sub-types:

1. Interactive controls, nested inside `<a>`, `<button>`, `<input>`, or custom
   controls.
2. Representational glyphs, embedded in UI to signal status, system tools, or
   format indicators, such as warning icons and online status dots.


## Image taxonomy

These are the types of functional images we support.

### Category 1: Navigational links and logos

Moving the user to a new document, domain, or root location.

- Linked standalone logos
  - Purpose: directs users back to the root homepage or portal origin.
  - Example: a linked logo in a website header that redirects users to the
    homepage.
- Standalone navigational links
  - Purpose: navigates the user to a specific document, sub-page, or external
    destination.
  - Example: a graphic or icon with no adjacent text, serving as the sole way
    to navigate to a new page or document.

### Category 2: Action controls and interface toggles

Triggering state changes, submitting data, or executing page actions.

- Standalone form controls and image buttons
  - Purpose: triggers a form submission, search query, or system command.
  - Example: an image used as a submit button (`<input type="image">`), or an
    icon inside a `<button>` tag to trigger an on-screen action.
- Action and toggle icons
  - Purpose: represents interface actions, or toggles interactive application
    states such as expand and collapse, settings, delete, or edit.
  - Example: small functional glyphs representing abstract actions inside an
    app or document interface, such as a gear for settings or a trash can for
    delete.

### Category 3: Custom interactive elements

- Functional non-Unicode emojis
  - Purpose: triggers an action or link.
  - Example: emojis rendered as images instead of Unicode text that serve some
    basic function. Non-Unicode emojis that are informative or artistic are not
    categorized as functional images.

### Category 4: Multi-region functional graphics

- Linked complex graphics and image maps
  - Purpose: divides a single complex visual into distinct interactive regions,
    each pointing to a unique action or destination.
  - Example: large visual maps or diagrams containing clickable interactive
    areas (`<area>`) that trigger a specific link.

### Category 5: Structural and layout controls

- Structural breaks and reader controls
  - Purpose: manage document flow, convey thematic pacing, or provide reading
    mechanics.
  - Example: non-artistic graphics or elements that create a meaningful pause
    for readers in a digital book.


## Criteria for good functional image alt text

The W3C states that for functional images, the visual components of the graphic
are irrelevant to a screen reader user. Quality is defined by communicating
intent and context.

- Action over description
  - Poor: `alt="Magnifying glass"`
  - High quality: `alt="Search"`
- Destination over label
  - Poor: `alt="W3C Logo"`, when linked
  - High quality: `alt="W3C home"`
- Context aware
  - Poor: `alt="Printer icon"`
  - High quality: `alt="Print this page"`

### Brevity and character limits

WebAIM suggests keeping functional alt text remarkably brief, often under 100 to
125 characters. Because functional images appear frequently in navigation menus
and interactive toolbars, verbose descriptions cause cognitive fatigue for
assistive technology users.

### Eliminating redundancy

- No redundant starters. Quality alt text never begins with "Link to..." or
  "Button for...". Screen readers automatically announce the HTML element type,
  for example "Link, Search" or "Button, Submit". Adding those words manually
  creates tedious phrasing.
- Handling redundant adjacent text. The W3C Alt Decision Tree states that if a
  functional image sits directly next to a text link that fulfills the same
  action, such as a cart icon beside the words "View Cart" inside the same
  link, the image is redundant. Quality alt text in this scenario is an empty
  alt attribute (`alt=""`) so the screen reader does not read the same
  destination twice.

### Dual-purpose imagery, functional and informative

Certain visual elements, such as icons, buttons, or logos, extend beyond simple
utility. When the visual style or content of an image adds significant meaning,
it should be re-classified as both functional and informative. Consider a
promotional banner on an eCommerce site: while its primary function is to link
to a specific landing page, it often conveys essential details through embedded
text or by showcasing a curated product selection.

### When emojis become functional images

Emojis are fundamentally different from standard images (`<img>`). They are
rendered as digital text typography governed by the Unicode Consortium. Because
screen readers automatically read the literal Unicode dictionary string, for
example the laptop emoji is read aloud as "laptop computer", emojis used on the
web can be triaged into three strict categories.

- Actionable emojis, functional
  - Use: when the emoji indicates a specific action and the default Unicode
    description may not apply.
  - Standard implementation: wrap the emoji character in a `<span>`, declare
    its role as an image, and inject the functional text string using
    `aria-label`.
- Contextual emojis, not functional, informative or artistic
  - Use: when the native Unicode description does not accurately match
    contextual use or authorial intent, such as using the high voltage emoji to
    mean "fast" when it reads as "high voltage".
  - Standard implementation: same as above.
- Decorative emojis, not functional, but we need to define why
  - Use: when the emoji adds zero contextual or functional value to the
    interface, such as stars or sparkles for visual emphasis.
  - Standard implementation: wrap the emoji character in a `<span>` and
    explicitly mask it from assistive technology using `aria-hidden="true"`.

### Potential questions to ask

Does the alt text:

- Communicate the image's purpose or intended action, rather than simply
  describing visual elements?
- Provide equivalent information needed by users who cannot see the image?
- Include relevant context while avoiding unnecessary or overly detailed
  descriptions?
- Identify important states, labels, or relationships when the image supports
  navigation, interaction, or decision-making?
- Avoid introducing assumptions, subjective interpretations, or information
  that is not supported by the image?


## Additional resources

- [WAI Functional Images Tutorial](https://www.w3.org/WAI/tutorials/images/functional/)
- [WAI Alt Text Decision Tree](https://www.w3.org/WAI/tutorials/images/decision-tree/).
  At some point it would be interesting to consider how each image type works,
  or does not work, in a logical decision tree. That would be a good exercise
  for mapping complexity.


## Reference: main types of images

Context for where functional images sit relative to everything else we may
eventually cover.

- Informative images
  - Definition: images whose primary purpose is to convey information,
    concepts, or meaning through their visual content, typically pictures,
    photos, and illustrations.
  - Examples: photos, illustrations, conceptual graphics, meaningful icons used
    non-functionally.
  - Key question: what information does the image convey?
  - Guidance: the text alternative should be at least a short description
    conveying the essential information presented by the image.
- Functional images
  - Definition: images whose primary purpose is to perform an action or provide
    navigation.
  - Examples: linked images, buttons, action icons, toggle controls, linked
    logos, functional emojis.
  - Key question: what does activating the image do?
  - Guidance: the text alternative should describe the functionality of the
    link or button rather than the visual image, such as a printer icon
    representing the print function.
- Decorative images
  - Definition: images that provide visual presentation but do not contribute
    meaningful information or functionality.
  - Examples: decorative flourishes, background graphics, ornamental icons,
    decorative emojis.
  - Key question: should this image have no text alternative?
  - Guidance: provide a null text alternative (`alt=""`) when the only purpose
    of an image is visual decoration.
- Text images
  - Definition: images whose primary meaningful content is text rendered as
    part of the image.
  - Examples: posters, flyers, screenshots containing essential text, quote
    graphics.
  - Key question: what text must be made available to the user?
  - Guidance: if the image is not a logo, avoid text in images. Where images of
    text are used, the text alternative should contain the same words as in the
    image.
- Complex images
  - Definition: images that communicate substantial information through
    relationships, data, structure, or multiple visual components that cannot
    be adequately represented by a short description.
  - Examples: charts, graphs, diagrams, infographics, technical illustrations,
    scientific figures.
  - Key question: what complete information or relationships must be conveyed?
  - Guidance: provide a complete text equivalent of the data or information
    provided in the image.
- Image groups
  - Definition: multiple graphical elements that collectively convey a single
    piece of information or meaning.
  - Examples: step-by-step illustrations, multiple photos forming one example,
    composite graphics.
  - Key question: what does the group communicate as a whole?
  - Guidance: the text alternative for one image should convey the information
    for the entire group.
- Image maps
  - Definition: a single graphical element containing multiple independently
    interactive regions.
  - Examples: interactive maps, seating charts, campus maps, floor plans with
    clickable regions.
  - Key question: what is the overall context, and what does each interactive
    region do?
  - Guidance: the text alternative should provide an overall context for the
    set of links, and each individually clickable area should have alternative
    text describing the purpose or destination of the link.


## License

[MIT](LICENSE). The copyright holder is TBD while the collaboration is being
formalized.
