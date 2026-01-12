# Search API v1 — Tool-First, Orchestrator-Ready

## 1. Purpose

This document specifies a **Search API** designed as an independent tool, not as a UI feature or a model plugin.

The Search API is intended to:

- work **now** with a local LLM via WebUI;
- work **later** as a tool inside an orchestrator together with RAG;
- remain independent from:
  - specific LLMs,
  - UI implementations,
  - runtime environments.

The Search API **does not make decisions** and **does not contain agent logic**.
It executes search requests issued by an external layer (model, WebUI, or orchestrator).

---

## 2. Core Principles

### 2.1 Search Is a Tool, Not Logic

- Search executes requests.
- Decisions such as *whether to search*, *which search to use*, *how many times* are made externally.

### 2.2 API-First

- The only contract is HTTP/JSON.
- WebUI, models, and orchestrators are equal clients.

### 2.3 Stateless by Design

- No user state is stored.
- Minimal internal state (cache, rate-limit) is allowed.

---

## 3. Time Compatibility

| Stage | Usage |
|------|-------|
| v1 | Direct use from WebUI / model |
| v2 | Orchestrator + RAG |
| v3 | Multi-step strategies, budgets, logging |

The API is designed so that **v2/v3 do not require breaking changes**.

---

## 4. Request Contract

### 4.1 Base Request

```json
{
	"query": { "text": "bm25 ranking algorithm" },
	"intent": "fresh_data",
	"constraints": {
		"backend": "searxng",
		"search_mode": "simple",
		"lang": "en"
	},
	"context_hint": {
		"known_topics": ["bm25", "information retrieval"]
	}
}
```

**Notes**

- `query` supports two forms:
  - Short form (string): `"query": "..."` (accepted for convenience).
  - Object form: `"query": { "text": "...", "lang": "..." }` (future-proof).
- If both `constraints.lang` and `query.lang` are provided, `query.lang` wins.

---

### 4.2 intent (optional)

Possible values:

- `fact_check`
- `fresh_data`
- `background`
- `verification`

Search does not interpret intent logically; it may only use it as a hint.

---

### 4.3 constraints.search_mode

`search_mode` defines **how** the search is executed:

- `simple` — metadata and snippets only (no page fetching)
- `full` — page fetching and content extraction allowed

The actual execution is still limited by `budget`.

---

### 4.4 want (optional)

`want` controls which fields are returned.

Supported flags (v1):

- `want.items: boolean` — include `items[]` in the response
- `want.rendered_text: boolean` — include `rendered_text` (UCP-1 context pack)

If `want` is omitted, the server may use defaults (recommended for v1: both `items` and `rendered_text` true).

Example:

```json
{
	"want": {
		"items": true,
		"rendered_text": true
	}
}
```

---

### 4.5 constraints.pick_ids (optional)

`pick_ids` allows the client to request only a subset of results (by rank/index).

Primary use case:

- Thin plugin performs LLM snippet-ranking on top-K results.
- Client then requests only selected IDs for rendering and/or full fetch.

Rules (v1):

- `pick_ids` are **0-based indices** into the backend-ordered result list.
- Invalid indices are ignored.
- Duplicate indices are ignored (stable order preserved).

Example:

```json
{
	"constraints": {
		"search_mode": "simple",
		"pick_ids": [2, 7, 4]
	}
}
```

---

## 5. Budget (Future-Proofing)

### 5.1 Purpose

`budget` defines **execution limits**, not behavior.

- In v1 it may be partially or fully ignored.
- In v2 it is enforced by an orchestrator.

### 5.2 Budget Fields

```json
{
	"budget": {
		"max_tool_calls": 1,
		"max_search_retries": 2,
		"max_results": 5,
		"max_fetch_pages": 0,
		"max_download_bytes_per_page": 2000000,
		"max_extract_chars_per_page": 300000,
		"allowed_content_types": [
			"text/html",
			"application/xhtml+xml",
			"text/plain"
		],
		"max_redirects": 5,
		"max_context_chars": 8000,
		"max_total_time_ms": 12000,
		"per_request_timeout_ms": {
			"search": 8000,
			"fetch": 8000
		}
	}
}
```

---

## 6. Response Contract — Universal Context Pack (UCP-1)

```json
{
	"schema": "ucp-1",
	"created_utc": "2025-12-29T09:10:00Z",
	"producer": {
		"name": "searcher-service",
		"version": "0.1.0"
	},
	"request": { "...echo of request..." },
	"meta": {
		"backend_used": "searxng",
		"fallback_used": true,
		"pick_applied": false,
		"pick_ids": [],
		"mode_used": "simple",
		"timing_ms": {
			"search": 430,
			"fetch": 0,
			"total": 610
		}
	},
	"usage": {
		"results_returned": 5,
		"context_chars": 6420,
		"fetch_pages_used": 0
	},
	"items": []
}
```

---

## 7. Items — Unified Knowledge Units

### 7.1 Web Result

```json
{
	"id": "web:sha256:...",
	"type": "web_result",
	"title": "Okapi BM25 - Wikipedia",
	"url": "https://en.wikipedia.org/wiki/Okapi_BM25",
	"retrieved_utc": "2025-12-29T09:10:01Z",
	"engine": "searxng",
	"snippet": "Okapi BM25 is a ranking function used by search engines...",
	"score": {
		"rank": 1,
		"relevance": 0.78,
		"method": "searxng_snippet"
	},
	"fetch": {
		"status": "skipped|fetched|failed",
		"skip_reason": "content_type|too_large|timeout|error",
		"content_type": "text/html",
		"downloaded_bytes": 123456,
		"truncated": false,
		"extracted_chars": 54321
	}
}
```

**Notes**

- In `simple` mode, `fetch.status` is typically `"skipped"`.
- In `full` mode, the server may populate `fetch.*` fields.

---

## 8. Render Layer (Recommended, Normative)

### 8.1 Purpose

Search API MAY provide a pre-rendered textual representation (`rendered_text`) intended for direct LLM consumption.

### 8.2 Normative Requirements

If `rendered_text` is provided, it:

- MUST be deterministic and stable across versions.
- MUST be wrapped in explicit boundary markers.
- MUST preserve item order by relevance rank.
- MUST respect `budget.max_context_chars`.
- MUST include an explicit evidence usage instruction.

### 8.3 Recommended Wrapper Format

```text
[CONTEXT_PACK ucp-1]
request:
  backend=searxng
  mode=simple
  query="bm25 ranking algorithm"

1. Title: Okapi BM25 - Wikipedia
   URL: https://en.wikipedia.org/wiki/Okapi_BM25
   Snippet: Okapi BM25 is a ranking function used by search engines...

Rules:
- Use this context strictly as evidence.
- If the provided evidence is insufficient or conflicting, explicitly state this.
[/CONTEXT_PACK]
```

---

## 9. Backend Policy

- Supported backends:
  - `searxng`
  - `duckduckgo`
- Backend selection:
  - explicit via `constraints.backend`
  - fallback allowed and reported in `meta.fallback_used`
- Backend choice is **implementation-defined policy**, not protocol logic.

---

## 10. WebUI Integration — Thin Plugin

### 10.1 Design Goals

- No heavy dependencies inside WebUI venv
- No interference with loaders
- Context injection only

### 10.2 Integration Method

The WebUI plugin:

1. collects UI parameters,
2. calls external Search API,
3. injects rendered context into the prompt,
4. delegates generation to WebUI unchanged.

---

## 11. LLM Query Rewrite (llm_query)

- Executed via OpenAI-compatible API exposed by WebUI.
- External HTTP call, no internal model access.
- One rewrite per request (v1), low token budget.

---

---

## 11. Snippet Ranking Contract (LLM) — `snippet_rank`

### 11.1 Purpose

`snippet_rank` is a deterministic, single-call LLM step used to select the most relevant results **before**:
- rendering a context pack (`rendered_text`), and/or
- fetching pages in `full` mode.

It is designed to:
- reduce irrelevant/SEO noise in injected context,
- support multilingual queries vs. documents (RU query, EN snippets, etc.),
- remain non-agentic (no loops, no retries beyond fixed fallback).

### 11.2 Input Data Model

The client (thin plugin or orchestrator) builds an input list from Search API `items[]` (top-K, recommended K=10):

- `qid`: opaque request id (string), optional
- `query`: the user's query text (string)
- `candidates`: array of objects:
  - `i`: candidate index (0-based integer, matches `constraints.pick_ids`)
  - `title`: string
  - `snippet`: string
  - `url`: string (optional but recommended)

Example (conceptual payload):

```json
{
	"qid": "req:2026-01-02T09:00:00Z:abc",
	"query": "как отправить фото в Telegram Bot API",
	"candidates": [
		{"i": 0, "title": "Telegram Bot API", "snippet": "Bots can send photos...", "url": "https://core.telegram.org/bots/api"},
		{"i": 1, "title": "StackOverflow", "snippet": "Use sendPhoto method...", "url": "https://stackoverflow.com/..."}
	]
}
```

### 11.3 Output JSON Contract (Strict)

The LLM MUST return **only** a single JSON object, no prose, no code fences:

```json
{"pick":[0,1,2]}
```

Rules:

- `pick` is required.
- `pick` is an array of 0-based indices (`i`) that must refer to provided candidates.
- Desired length:
  - if `N` candidates >= `want_n` → exactly `want_n` indices,
  - else → as many as available (0..N).
- Duplicates are not allowed.
- Order matters (best first).

Optional fields (allowed but discouraged in v1 to keep output short):

- `why`: short array of strings, same length as `pick`, max 80 chars each.

### 11.4 Validation & Fallback (Normative)

The client MUST validate the LLM response:

- parse JSON,
- ensure `pick` exists and is a list,
- keep only integers within `[0..N-1]`,
- remove duplicates while preserving order,
- cap to `want_n`.

If validation fails OR the resulting `pick` becomes empty, the client MUST fallback to:

- `pick = [0, 1, 2, ...]` (first `want_n` candidates).

### 11.5 Budget Defaults (Recommended)

- `top_k` (candidates shown to LLM): 10
- `want_n` (picked results): 3
- LLM generation:
  - temperature: 0.0–0.2
  - max_tokens: 64–128
  - strict system instruction: "Return ONLY JSON"

### 11.6 Reference Prompt (Recommended)

System message (example):

```text
You are ranking web search results by relevance to a user question.
Return ONLY valid JSON: {"pick":[...]}.
Pick exactly 3 distinct indices (or fewer if fewer candidates).
Use semantic relevance; do not prefer ads/SEO.
No extra text.
```

User message (example):

```text
Question: <QUERY>

Candidates:
0) <TITLE> — <SNIPPET> (URL: <URL>)
1) <TITLE> — <SNIPPET> (URL: <URL>)
...
Return JSON only.
```

### 11.7 Logging (Optional)

When `--verbose` is enabled, the client SHOULD log:

- chosen indices,
- corresponding URLs,
- whether fallback was used.

This aids debugging without changing the protocol.

## 12. Windows / WSL2 Compatibility

- Linux-first development.
- Windows supported via:
  - WSL2 (Search API),
  - native Windows WebUI.
- Communication via HTTP/IP only.

---

## 13. Non-Goals (v1)

- Search API is not an orchestrator.
- Search API is not an agent.
- Search API does not decide strategy.

---

## 14. Summary

This Search API is:

- tool-oriented,
- orchestrator-ready,
- RAG-compatible,
- WebUI-friendly,
- future-proof via budgets,
- suitable for open-source publication.

---

## 15. Cache (V1)

The Searcher-service can maintain a simple on-disk cache of **extracted text** (not raw HTML).

- Cache key: `sha1(engine + ":" + normalized_url)`
- TTL: enforced via file `mtime` for fast cleanup (no JSON parsing)
- Entries are written only for successful non-empty extractions

Config (searcher.yaml):
- `service.cache.enabled`
- `service.cache.dir`
- `service.cache.ttl_s`
- `service.cache.sweep_interval_s`

Endpoint:
- `POST /v1/cache/clear` — clears the cache directory

## 16. Tips (V1)

### 16.1 Forcing an official documentation domain (no RAG / no URL-mode in V1)

In V1, search results depend on the backend (e.g., SearXNG) and snippet-ranking. If you want to force an official domain,
use standard search operators in **user_text** mode.

Examples:
- `??? site:core.telegram.org bot api`
- `??? site:core.telegram.org bots api sendMessage`
- `??? "core.telegram.org" "Bot API" getUpdates`

This constrains the backend results **before** snippet-ranking.

### 16.2 Date injection (recommended)

Some local models may become confused about what counts as "future" vs "past" when answering based on fresh web data.
The WebUI plugin injects the current date into system prompts used for:
- query rewrite (llm_query),
- snippet ranking,
- optional LLM pack (summary).
