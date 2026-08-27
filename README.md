# An AI Benchmark for Alt Text Generation

A public evaluation framework for AI-generated alt text, starting with **functional images**.

**Current milestone:** By August 27, develop an AI prompt to identify and collect functional image assets online, building a library of examples for alt text generation and benchmarking.

## The opportunity

AI now writes most of the alt text on the internet. Almost no one is measuring whether it is any good — not in a way that reflects what blind and low vision users actually need. The benchmarks the AI industry uses for image description were built for sighted-author reference captions, not for the contextual judgment that defines good alt text in practice.

## What we are doing

Building the public evaluation framework for AI-generated alt text. It will sit alongside [AIMAC](https://gaad.foundation/) and become the reference point that procurement teams, model developers, and the accessibility community use to talk about image description quality.

The benchmark is something model developers can compete on. The target capability is **zero-shot quality**: how well a model produces useful alt text from the kind of general, unspecified prompts real humans send, without expecting the user to know what to ask for. This is a benchmark for models, not a behavior-change tool for end users.

## Our approach

The core of the work is a **deterministic heuristic for what good alt text is**. Without that, there is no benchmark.

We are starting with functional images — the cases with the clearest ground truth, like a lightbulb icon that visually stands for "insight." Functional images give us a tractable place to prove out the heuristic and the scoring methodology before we extend the framework outward. The longer-term target is contextual description complex enough to handle something like the illustrations in a Winnie the Pooh book, but we are not trying to solve that first.

Gold standards will likely need to differ by context type, and the standards themselves do double duty: they expose how alt text professionals actually make their decisions, giving model developers material to learn from rather than only a score to chase.

### The question in front of us

What corpus of functional images and alt text do we use to build the gold standard the benchmark scores against?

## Who we are

| Person | Affiliation and role |
| --- | --- |
| **Blake Bertuccelli-Booth** | UIC — Assistant Director of Digital Accessibility Engineering, leading AI Leaders across UIC, Louisiana Tech, and the University of Louisiana at Lafayette |
| **Joe Devon** | GAAD Foundation — co-founder of Global Accessibility Awareness Day, and the team behind the GAAD AI Model Accessibility Checker (AIMAC) |
| **Ben Ogilvie** | ArcTouch, GAAD Foundation and A11yNYC — accessible custom software development and the largest community conversation in the field |
| **Yumeng Ma** | CSE PhD student, University of Washington — designed PACE (Prompt Accessibility Controlled Evaluation), a benchmarking testbed for controlled evaluation of accessibility in LLM-generated HTML form components (current paper under submission at ACM ASSETS) |
| **Caroline Desrosiers** | Scribely — Founder & CEO of the professional alt text and audio description service, and lead on the initiative to add alt text and extended description properties to the IPTC Photo Metadata Standard |
| **Michael Fu** | University of Illinois Chicago — Digital Accessibility Specialist |

---

# Functional images

A **functional image** is one used to initiate actions by the user or reader. Not aesthetic.

## Image taxonomy

These are the types of functional images we support.

### Category 1: Navigational links and logos

Moving the user to a new document, domain, or root location.

- **Linked standalone logos** — Directs users back to the root homepage or portal origin. *Example:* a linked logo in a website header that redirects users to the homepage.
- **Standalone navigational links** — Navigates the user to a specific document, sub-page, or external destination. *Example:* a graphic or icon with no adjacent text, serving as the sole way to navigate to a new page or doc.

### Category 2: Action controls and interface toggles

Triggering state changes, submitting data, or executing page actions.

- **Standalone form controls and image buttons** — Triggers a form submission, search query, or system command. *Example:* an image used as a submit button (`<input type="image">`) or an icon inside a `<button>` tag.
- **Action/toggle icons** — Represents interface actions or toggles interactive application states (expand/collapse, settings, delete, edit). *Example:* small functional glyphs representing abstract actions inside an app or doc interface, such as a gear for settings or a trash can for delete.

### Category 3: Custom interactive elements

- **Functional non-Unicode emojis** — Triggers an action or link. *Example:* emojis rendered as images instead of Unicode text that serve some basic function. Non-Unicode emojis that are informative or artistic are not categorized as functional images.

### Category 4: Multi-region functional graphics

- **Linked complex graphics / image maps** — Divides a single complex visual into distinct interactive regions, each pointing to a unique action or destination. *Example:* large visual maps or diagrams containing clickable interactive areas (`<area>`) that trigger a specific link.

### Category 5: Structural and layout controls

- **Structural breaks and reader controls** — Manage document flow, convey thematic pacing, or provide reading mechanics. *Example:* non-artistic graphics or elements that create a meaningful pause for readers in a digital book.

## Criteria for good functional image alt text

The W3C states that for functional images, the visual components of the graphic are irrelevant to a screen reader user. Quality is defined by communicating **intent and context**.

| Quality metric | Poor implementation | High-quality standard |
| --- | --- | --- |
| Action over description | `alt="Magnifying glass"` | `alt="Search"` |
| Destination over label | `alt="W3C Logo"` (when linked) | `alt="W3C home"` |
| Context aware | `alt="Printer icon"` | `alt="Print this page"` |

| Aspect | Functional images |
| --- | --- |
| **Primary intent** | Represent a system function, state, or utility, or initiate an action / navigation jump. |
| **Core question for alt text** | "What function, tool, state, or destination does this visual represent?" |
| **Alt text goal** | Label the outcome, purpose, destination, or state (e.g. "Search", "W3C home"). |
| **Impact if missing** | UI / state failure: screen readers announce raw URLs or file names, or omit critical system state (e.g. missing that a server is "Offline"). |
| **Two core sub-types** | 1. **Interactive controls** — nested inside `<a>`, `<button>`, `<input>`, or custom controls. 2. **Representational glyphs** — embedded in UI to signal status, system tools, or format indicators (warning icons, online status dots). |
| **Effect of surrounding text** | Redundancy filter: if adjacent text already names the state, function, or action, the image becomes decorative (`alt=""`) to prevent repeating the text. |
| **Context goal** | Prevent broken interactions. |

### Brevity and character limits

WebAIM suggests keeping functional alt text remarkably brief — often under 100–125 characters. Because functional images appear frequently in navigation menus and interactive toolbars, verbose descriptions cause cognitive fatigue for assistive technology users.

### Eliminating redundancy

- **No redundant starters.** Quality alt text never begins with "Link to…" or "Button for…". Screen readers automatically announce the HTML element type ("Link, Search" or "Button, Submit"). Adding those words manually creates tedious phrasing.
- **Handling redundant adjacent text.** The W3C Alt Decision Tree states that if a functional image sits directly next to a text link fulfilling the same action (a cart icon next to the words "View Cart" inside the same link), the image is redundant. Quality alt text in this scenario is an empty alt attribute (`alt=""`) so the screen reader doesn't read the same destination twice.

### Dual-purpose imagery (functional and informative)

Some visual elements — icons, buttons, logos — extend beyond simple utility. When the visual style or content of an image adds significant meaning, it should be re-classified as both functional and informative. Consider a promotional banner on an eCommerce site: while its primary function is to link to a landing page, it often conveys essential details through embedded text or by showcasing a curated product selection.

### When emojis become functional images

Emojis are fundamentally different from standard images (`<img>`). They are rendered as digital text typography governed by the Unicode Consortium. Because screen readers automatically read the literal Unicode dictionary string (💻 is read aloud as "laptop computer"), emojis used on the web can be triaged into three categories:

1. **Actionable emojis (functional)** — the emoji indicates a specific action and the default Unicode description may not apply. *Implementation:* wrap the emoji character in a `<span>`, declare its role as an image, and inject the functional text string using `aria-label`.
2. **Contextual emojis (not functional — informative or artistic)** — the native Unicode description does not accurately match contextual use or authorial intent (using ⚡ to mean "fast", but it reads as "high voltage"). *Implementation:* same as above.
3. **Decorative emojis (not functional, but we need to define why)** — the emoji adds zero contextual or functional value to the interface (stars or sparkles for visual emphasis). *Implementation:* wrap the emoji character in a `<span>` and explicitly mask it from assistive technology with `aria-hidden="true"`.

### Potential questions to ask

Does the alt text:

- Communicate the image's purpose or intended action, rather than simply describing visual elements?
- Provide equivalent information needed by users who cannot see the image?
- Include relevant context while avoiding unnecessary or overly detailed descriptions?
- Identify important states, labels, or relationships when the image supports navigation, interaction, or decision-making?
- Avoid introducing assumptions, subjective interpretations, or information that is not supported by the image?

## Additional resources

- [WAI Functional Images Tutorial](https://www.w3.org/WAI/tutorials/images/functional/)
- [WAI Alt Text Decision Tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) — at some point it would be interesting to consider how each image type works (or doesn't work!) in a logical decision tree. A good exercise for mapping complexity.

---

# Reference: main types of images

Context for where functional images sit relative to everything else we may eventually cover.

- **Informative images** — Graphically represent concepts and information; typically pictures, photos, and illustrations. The text alternative should be at least a short description conveying the essential information presented by the image.
- **Decorative images** — Provide a null text alternative (`alt=""`) when the only purpose of an image is visual decoration rather than conveying information important to understanding the page.
- **Functional images** — The text alternative of an image used as a link or button should describe the functionality of the link or button rather than the visual image (a printer icon representing the print function, a button to submit a form).
- **Images of text** — Readable text is sometimes presented within an image. If the image is not a logo, avoid text in images. If images of text are used, the text alternative should contain the same words as in the image.
- **Complex images such as graphs and diagrams** — To convey data or detailed information, provide a complete text equivalent of the data or information provided in the image.
- **Groups of images** — If multiple images convey a single piece of information, the text alternative for one image should convey the information for the entire group.
- **Image maps** — The text alternative for an image containing multiple clickable areas should provide an overall context for the set of links. Each individually clickable area should also have alternative text describing the purpose or destination of the link.

| Category | Definition | Examples | Key question for writing alt text |
| --- | --- | --- | --- |
| **Informative images** | Images whose primary purpose is to convey information, concepts, or meaning through their visual content. | Photos; illustrations; conceptual graphics; meaningful icons used non-functionally | What information does the image convey? |
| **Functional images** | Images whose primary purpose is to perform an action or provide navigation. | Linked images; buttons; action icons; toggle controls; linked logos; functional emojis | What does activating the image do? |
| **Decorative images** | Images that provide visual presentation but do not contribute meaningful information or functionality. | Decorative flourishes; background graphics; ornamental icons; decorative emojis | Should this image have no text alternative? |
| **Text images** | Images whose primary meaningful content is text rendered as part of the image. | Posters; flyers; screenshots containing essential text; quote graphics | What text must be made available to the user? |
| **Complex images** | Images that communicate substantial information through relationships, data, structure, or multiple visual components that cannot be adequately represented by a short description. | Charts; graphs; diagrams; infographics; technical illustrations; scientific figures | What complete information or relationships must be conveyed? |
| **Image groups** | Multiple graphical elements that collectively convey a single piece of information or meaning. | Step-by-step illustrations; multiple photos forming one example; composite graphics | What does the group communicate as a whole? |
| **Image maps** | A single graphical element containing multiple independently interactive regions. | Interactive maps; seating charts; campus maps; floor plans with clickable regions | What is the overall context, and what does each interactive region do? |

---

## License

[MIT](LICENSE). Copyright holder is TBD while the collaboration is being formalized.
