# WebSearch MistByte — FAQ (v1.1)

This FAQ documents:
- WebUI panel settings (Text Generation WebUI extension)
- All configuration files (short 1-line description per option)
- Known limitations
- Troubleshooting
- Why results may look inconsistent

> Note: Output quality depends heavily on the LLM used for query rewrite / snippet ranking / summarization.

---

## 0) Components / Flow

**Components**
- **WebUI extension**: detects trigger, optionally rewrites query with LLM, optionally ranks candidates, requests a pack from the searcher.
- **Searcher service**: performs search, fetch/extraction, pack rendering and caching.
- **Backends**: SearXNG (recommended), DuckDuckGo Instant (fallback).
- **Fetch engine**: local extractor or Jina Reader.

**Full mode flow**
1) (optional) LLM rewrites user text into a search query (`query_mode=llm_query`)
2) Search backend returns candidates
3) (optional) LLM ranks candidates (`snippet_rank_enabled=true`)
4) Searcher fetches/extracts top N pages (budgeted)
5) Searcher builds `CONTEXT_PACK`
6) LLM answers using only that pack (`full_handling=llm_pack`)

---

# 1) WebUI Panel Settings (GUI)

The GUI edits `llm_web_search.json`. Use it for quick tuning without touching files.

## Enable web search
Enables/disables the extension.
- JSON: `enable`

## Trigger prefix
The trigger prefix (shown as `???` in the UI) activates web search for that message.

## Trigger anywhere (not only at start)
If enabled, the trigger can appear anywhere in the prompt; otherwise it must be at the start.
- JSON: `trigger_anywhere`

## Query mode
Controls how the search query is produced.
- `llm_query`: LLM rewrites user request into a concise query (best targeting, model-dependent).
- `user_text`: use user text directly as the query (most deterministic; good for weak models / exact technical queries).
- JSON: `query_mode`

## Backend
Which backend to use for web search.
- `searxng` (recommended), `duckduckgo` (fallback).
- JSON: `backend`

## Search mode
Controls how deep the pipeline goes.
- `simple`: search snippets only (fast).
- `full`: search + optional rank + fetch/extract pages + build `CONTEXT_PACK` (best quality).
- JSON: `search_mode`

## Full handling
Controls how results are provided to the LLM in `full` mode.
- `llm_pack`: strict `CONTEXT_PACK` (recommended).
- `inject`: inject results into the prompt directly (useful for debugging / very weak models).
- JSON: `full_handling`

## Fetch engine (full mode)
Selects extraction engine for fetched pages in `full` mode.
- `local`: direct fetch + local extraction.
- `jina`: Jina Reader extractor (`https://r.jina.ai/<URL>`).
- JSON: `fetch_engine`

## LLM query until newline
If enabled, LLM rewrite output is truncated at the first newline.
- JSON: `llm_query_until_newline`

## Max query chars
Hard limit for the final query string sent to the search backend (applies to both user_text and llm_query).
- JSON: `max_query_chars`

## LLM query max user chars
Limits how many characters from the user’s post-trigger text are included in the LLM rewrite call (only when query_mode=llm_query).
- JSON: `llm_query_max_user_chars`

## Apply & Save
Writes GUI settings to `llm_web_search.json`.

## Clear fetch cache
Clears the searcher extraction cache (useful if you suspect stale cached extracts).
- (Searcher-side cache, not WebUI browser cache)

---

# 2) Configuration Files

## 2.1 `llm_web_search.json` (WebUI extension)

This file defines how the extension triggers and orchestrates search.

### Core
- `enable` — Enable/disable the extension.
- `trigger_anywhere` — Allow trigger prefix anywhere in the prompt.
- `query_mode` — `llm_query` (rewrite) or `user_text` (no rewrite).
- `backend` — Preferred backend (`searxng` / `duckduckgo`).
- `search_mode` — `simple` (snippets) or `full` (fetch/extract + pack).
- `full_handling` — `llm_pack` (strict pack) or `inject` (prompt injection).

### Rewrite (only if `query_mode=llm_query`)
- `llm_query_until_newline` — Stop reading rewrite output at the first newline.
- `llm_query_max_words` — Word cap for rewritten query.
- `llm_query_max_chars` — Character cap for rewritten query.
- `llm_query_max_user_chars` — Max chars of the user message passed into rewrite prompt.
- `rewrite_max_tokens` — Token budget for rewrite completion.
- `timeout_rewrite_s` — Max seconds allowed for rewrite step.

### Ranking (candidate selection)
- `snippet_rank_enabled` — Enable LLM-based candidate ranking.
- `snippet_rank_top_k` — Rank only top K candidates from the backend.
- `snippet_rank_pick_n_simple` — Pick N candidates in `simple` mode (if used).
- `snippet_rank_pick_n_full` — Pick N candidates in `full` mode (for extraction).
- `snippet_rank_pick_n` — Optional override for pick count (if not null).
- `timeout_rank_s` — Max seconds allowed for ranking step.

### Fetch/extract + pack
- `fetch_engine` — Preferred extractor (`local` / `jina`) for full mode.
- `timeout_pack_s` — Max seconds allowed to build the pack.
- `timeout_search_full_s` — Max seconds allowed for the whole full pipeline.

### Debug
- `verbose` — Print extra logs (useful for diagnosing ranking/extraction mismatches).

---

## 2.2 `searcher.yaml` (Searcher service)

This file controls the backend service that actually performs search and extraction.

### Network
- `service.listen.tcp.host` — Bind address for the HTTP service.
- `service.listen.tcp.port` — TCP port for the HTTP service.
- `service.listen.unix_socket` — Optional UNIX socket endpoint (unused now - for future use).

### Fetch / extraction
- `service.fetch.engine` — Default extractor engine (`local` or `jina`).
- `service.fetch.headers.user_agent` — User-Agent for outbound fetches.
- `service.fetch.headers.accept` — Accept header for outbound fetches.
- `service.fetch.headers.accept_language` — Accept-Language for outbound fetches.
- `service.fetch.proxy.socks_url` — Optional SOCKS proxy for fetch/extraction (recommended `socks5h://`).
- `service.fetch.jina.base_url` — Jina Reader base URL.
- `service.fetch.jina.api_key` — Optional API key for higher Jina limits.

### Timeouts
- `service.timeouts_ms.search` — Backend search request timeout.
- `service.timeouts_ms.fetch` — Per-page fetch/extraction timeout.

### Limits / budgets
- `service.limits.max_results` — Maximum number of candidates returned by backends.
- `service.limits.max_snippet_chars` — Per-candidate snippet character cap.
- `service.limits.max_context_chars` — Total character cap for the final rendered pack.
- `service.limits.max_fetch_pages` — Maximum pages to fetch/extract in full mode.
- `service.limits.max_download_bytes_per_page` — Max downloaded bytes per page.
- `service.limits.max_extract_chars_per_page` — Max extracted chars per page (raw extraction).
- `service.limits.allowed_content_types` — Allowed content types for fetch/extraction.
- `service.limits.max_redirects` — Redirect limit for fetch.
- `service.limits.max_render_content_chars_per_item` — Cap extracted text included per item in pack output.

### Cache
- `service.cache.enabled` — Enable extracted-text cache.
- `service.cache.dir` — Cache directory (relative to service working dir).
- `service.cache.ttl_s` — Cache TTL (seconds).
- `service.cache.sweep_interval_s` — How often to sweep TTL-expired entries.

### Backends
- `backends.order` — Priority order of backends.
- `backends.searxng.enabled` — Enable SearXNG backend.
- `backends.searxng.base_url` — SearXNG API base URL.
- `backends.duckduckgo.enabled` — Enable DuckDuckGo backend.
- `backends.duckduckgo.mode` — DuckDuckGo mode (e.g. `instant`).
- `backends.duckduckgo.region` — Optional region for DDG.
- `backends.duckduckgo.safesearch` — Optional safe search for DDG.

### Render
- `render.include_rank` — Include backend rank/position in rendered pack.
- `render.include_source` — Include engine/source metadata in pack.
- `render.include_snippet` — Include snippet text in pack.
- `render.trim_strategy` — **Reserved (currently not used by code).** See "Trim behavior" below.

---

## 2.3 `searxng/settings.yml` (SearXNG)

This file configures your local SearXNG instance.

- `general.instance_name` — Display name for your local SearXNG.
- `general.debug` — SearXNG debug logs.
- `server.secret_key` — Secret key for SearXNG (installer typically generates).
- `server.limiter` — Enable rate limiter (requires Redis/Valkey setup).
- `server.bind_address` / `server.port` — Container listen address/port (host binding is handled outside).
- `search.safe_search` — Safe search level.
- `search.default_lang` — Default language for results (important for quality).
- `search.formats` — Output formats (`html`, `json`).
- `outgoing.request_timeout` — Outgoing request timeout.
- `outgoing.socks5` (or proxy section) — Outgoing proxy configuration (recommended when you use tunneling).
- `outgoing.enable_http2` — Disable HTTP/2 if proxies/DNS cause issues.
- `engines[]` — Enable/disable individual engines (bing, yandex, wikipedia, etc.).

---

# 3) Trim behavior (what is actually implemented)

Although config contains `render.trim_strategy`, the current implementation behaves deterministically:

1) **Snippets are capped** per item using `service.limits.max_snippet_chars`.
2) **Extracted content is capped** per item using `service.limits.max_render_content_chars_per_item`.
3) If the final pack still exceeds `service.limits.max_context_chars`, the renderer **drops tail items (removes items from the end)** until it fits.

`render.trim_strategy` is currently **reserved** (present in config/examples, not applied by code).

---

# 4) Why search results may be inconsistent

Even with correct code, inconsistencies can happen due to:

- **Backend variability**: search engines change results over time/region.
- **Model dependence**: weak models may rewrite/rank incorrectly.
- **Present-time questions**: "current/latest/now" require time-aware selection and official sources.
- **Extraction failures**: paywalls, bot protection, JS-heavy pages, timeouts.
- **Cache effects**: cached extracts may be stale until TTL expires.

---

# 5) Known limitations

- No headless browser (JS-heavy sites may extract poorly).
- Paywalled sites may return incomplete content or fail extraction.
- Present-time facts require good sources and model discipline.
- Accuracy depends on the LLM strength (rewrite/rank/summarize).

---

# 6) Troubleshooting

## 6.1 No results / backend errors
- Verify SearXNG is running and reachable at `backends.searxng.base_url`.
- Verify proxy settings (SOCKS down breaks outgoing traffic).

## 6.2 Full mode is slow
- Reduce `max_fetch_pages`, download limits, extract limits, or increase timeouts.
- Prefer `fetch_engine=jina` for difficult pages.

## 6.3 Ranking looks good but answer is wrong
- Inspect the final `CONTEXT_PACK` (is the needed source actually extracted?).
- Increase fetch timeouts or extract budget if extraction is truncated.
- Temporarily enable `verbose=true` to see intermediate artifacts.

## 6.4 Outdated answers for "now/current"
- Prefer official sources and time-anchored sources.
- Deprioritize archived/frozen pages for present-time facts.
- Use a stronger model for ranking/summarization if possible.

---

# 7) Best practices

- Use `full` + `llm_pack` for factual discipline.
- Keep `snippet_rank_enabled=true` when your model is strong enough.
- For weak models, consider `query_mode=user_text` to avoid hallucinated rewrite.
- Enable caching for speed and stability, but clear cache if you suspect staleness.
