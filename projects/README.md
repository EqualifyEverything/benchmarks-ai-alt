# Projects

Each subdirectory here is one project in the benchmark effort. A project owns a
question, its directives, its data, and its own README. Projects are meant to be
runnable by a person or by an AI agent in a harness such as Claude Code.

Every project follows the repository requirements in
[../CLAUDE.md](../CLAUDE.md): plain text only, accessibility first.


## Current projects

- [corpus-construction](corpus-construction/). Build the corpus of images, page
  context, and gold standard alt text that the benchmark scores against.
  Starting with functional images. Status: active, no corpus records collected
  yet.


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
