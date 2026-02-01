# Changelog

## [v1.1.0] - 2026-01-XX
### Added
- Time anchor in LLM query rewrite prompt (reference datetime).
- Improved ranking/summarization prompt policies for present-time questions.

### Fixed
- Critical bug: extracted pages now align with ranked/picked items (ranker no longer meaningless).
- Snippet rank JSON parsing now accepts array format reliably (prevents fallback in some models).

### Changed
- Ranking policy: deprioritize archived/frozen sources for "current/latest" questions.
- Ranking policy: avoid non-question-language sources (e.g. Chinese if no Chinese in question) unless no alternatives.
- Default rewrite budgets increased (rewrite_max_tokens / timeout_rewrite_s) to prevent truncated `<think>` outputs.

### Notes
- Output quality strongly depends on the LLM used for rewrite/rank/summarize.
- Present-time questions remain the hardest category and benefit from official/primary sources.
