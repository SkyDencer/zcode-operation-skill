---
name: testing-nested-deep
description: A deeply nested skill used to verify that the scanner traverses directories correctly and finds SKILL.md files at any depth within the source tree.
keywords:
  - nested
  - deep
  - traversal
  - scanner
  - verification
domains:
  - testing
---

## Instructions

This is a deeply nested fixture for scanner testing.

1. Verify scanner finds deeply nested SKILL.md files.
2. Check that frontmatter is parsed correctly at depth.
3. Ensure sourcePath points to the correct absolute path.
4. Confirm name is extracted from frontmatter accurately.
5. Validate that content body is captured fully.
6. Test that keywords array is preserved from source.
7. Test that domains array is preserved from source.
8. Ensure no truncation occurs at arbitrary depths.
9. Verify deterministic sort order is maintained globally.
10. Check that all metadata fields are populated correctly.
11. Run scanner with maxDepth limit to verify cutoff behavior.
12. Confirm normal-nested paths do not trigger traversal alerts.
13. Ensure the file is readable with standard UTF-8 encoding.
14. Verify content length exceeds minimum token threshold.
15. Confirm no hidden characters are introduced during parse.
