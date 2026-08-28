# Projects

Each subdirectory here is one project in the benchmark effort. A project owns a
question, its directives, its data, and its own README. Projects are meant to be
runnable by a person, or by an AI agent in any harness that can read and write
plain text files. No project depends on a particular agent or vendor.

Every project follows the repository requirements in
[../AGENTS.md](../AGENTS.md): plain text only, accessibility first.


## Current projects

- [corpus-construction](corpus-construction/). Build the corpus of images, page
  context, and the alt text the sites themselves shipped, which is what the
  benchmark scores against. Starting with functional images. Status: active,
  first full run complete. 524 pages crawled, 11,334 candidates found, 250
  selected, 250 reviewed, 78 passed to human validation.
- [corpus-validation](corpus-validation/). A static, keyboard-accessible tool
  for confirming the pairs by hand. A pair is only a reference once a person has
  accepted it. Status: active, holding the 78 items exported by the first run.


## Adding a project

- Create a directory named for the question it answers, in lowercase with
  hyphens.
- Give it a `README.md` stating the goal, the acceptance criteria, how to run
  it, and its current status.
- Put agent directives in a `directives/` subdirectory, numbered in the order
  they run.
- Keep data in plain text, in the project directory, next to the directives
  that produced it.
- Add the project to the list above, and to the Projects section of the
  repository [README.md](../README.md).
