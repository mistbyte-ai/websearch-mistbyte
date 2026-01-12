# Roadmap — Search API

This document outlines the planned evolution of Search API beyond V1.

The roadmap follows a **deliberate, staged approach**: new capabilities are added without sacrificing predictability, debuggability, or local-first principles.

Some features may be moved earlier or later depending on real-world constraints and practical needs.

---

## Status: V1 (Released)

Search API V1 is complete and stable.

### Key properties of V1
- Explicit, user-triggered web search
- One search cycle per user message
- No agent loops
- No hidden retries or iterations
- Clear separation between search and generation
- Local-first architecture
- Deterministic behavior

### Included in V1
- Built-in extracted-text cache
  - extracted text only (no HTML)
  - URL normalization
  - TTL-based eviction
  - manual cache clear control
  - internal hit/miss counters
- Sequential page fetching
- Two fetch engines (`local`, `jina`)
- Two search backends (SearXNG, DuckDuckGo)

V1 is intentionally limited and **feature-frozen**, serving as a solid foundation.

---

## V2 — Performance and Coverage

V2 focuses on improving **latency, coverage, and extraction success**, while remaining non-agentic by default.

### Planned features

#### 1. Parallel page fetching
- Concurrent fetch/extract for selected pages
- Strict limits to avoid overload
- Configurable concurrency

Purpose:
- Reduce latency on multi-page extraction
- Preserve predictable execution time

---

#### 2. Additional search backends
- More public engines
- Optional commercial APIs
- Backend-specific tuning

Purpose:
- Improve result quality
- Reduce dependency on a single provider

---

#### 3. Fetch engine auto mode
- Try `local` first
- Detect common failure signatures:
  - “enable JavaScript”
  - “verify you are human”
  - bot challenges
- Fallback to `jina` when appropriate

Purpose:
- Improve extraction success without user micromanagement

---

## V3 — Advanced Extraction

V3 introduces **optional heavy tools**, explicitly opt-in.

### Planned features

#### 1. Headless browser extraction
- Playwright / Chromium
- JavaScript-rendered pages
- SPA support
- Strict limits
- Disabled by default

Important notes:
- Resource-intensive
- Higher maintenance cost
- Used only when simpler methods fail

---

#### 2. Source trust and filtering heuristics
- Domain blacklists / whitelists
- Anti-content-farm heuristics
- Duplicate content detection

Purpose:
- Reduce noise
- Improve signal quality

---

## Beyond Search — RAG and System Integration

Search API is designed as part of a larger local AI ecosystem.

### Possible intermediate milestone

#### Cache-RAG (optional)
- Semantic retrieval over cached extracted pages
- Query-based reuse of previously fetched content
- Minimal scope: cache as a single data source

This may be implemented as an intermediate step if it provides clear practical benefits.

---

### Target architecture

#### Unified RAG layer
- One retrieval layer spanning:
  - web search cache
  - filesystem documents
  - codebases
- Shared components:
  - chunking
  - embeddings
  - scoring
  - metadata
- Single retrieval API

Purpose:
- Avoid duplicated subsystems
- Enable consistent reasoning across heterogeneous data

---

### Additional long-term components
- Filesystem RAG:
  - developer-oriented (functions, symbols, code structure)
  - text-oriented (documents, notes, reports)
- Long-term memory RAG:
  - user-approved memory writes
  - cross-session persistence
- Orchestrator layer:
  - coordination between LLM, search, RAG, memory
- External reasoning loop:
  - self-verification
  - error detection
  - iterative refinement
- Adaptive interaction layer:
  - reduced friction over time
  - better context awareness

These components are **out of scope for Search API itself**, but the architecture is designed to support them cleanly.

---

## Development priorities

Development order and timing depend on:
- available time,
- hardware constraints,
- real-world usage feedback.

Bug fixes and stability improvements always take priority over new features.

---

## Philosophy

Search API is not trying to be “magic”.

It is designed to be:
- honest,
- explicit,
- inspectable,
- predictable.

Each roadmap step follows the same principle:

**Add power without losing control.**
