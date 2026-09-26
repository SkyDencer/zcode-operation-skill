# Caching without frontmatter

This fixture is deliberately malformed. The file has no `---` delimited
frontmatter block, so the corpus validator cannot read a name, a description or
a domain from it. A real corpus harvested from a wiki or a blog post looks
exactly like this.

The name `broken-no-frontmatter` and the description below are written in the
body instead of in frontmatter, which is the usual mistake.
