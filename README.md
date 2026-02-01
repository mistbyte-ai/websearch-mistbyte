# Search API V1 — Explicit Web Search for LLMs

Search API V1 is a local, non-agentic web search system designed for Large Language Models and built to integrate with Text Generation WebUI via a thin extension layer.

It provides **explicit, controllable, and reproducible** web search without pretending that the model has direct internet access.

This project was originally developed as the first building block of a larger local AI system (code-named **“The Junior”**), but is released as a **standalone, production-ready component**.


---

## Documentation

- **FAQ (settings, troubleshooting, known limitations):** [`docs/FAQ.md`](docs/FAQ.md)
- **Changelog (all releases):** [`CHANGELOG.md`](CHANGELOG.md)
---

## Why this exists

Most LLM integrations that claim “web access” suffer from at least one of these problems:

- the model hallucinates browsing behavior,
- search is implicit and uncontrollable,
- results are mixed with generation,
- behavior is unpredictable and hard to debug,
- installation breaks Python environments.

Search API V1 was designed to solve these problems **explicitly and honestly**.

---

## Design goals

- No fake “I can browse the web”
- Clear separation between **search** and **generation**
- Deterministic, debuggable behavior
- One search per user message (V1)
- Works with **any** LLM exposed via an OpenAI-compatible API
- Minimal impact on WebUI Python environment
- Simple installation (user or system, headless supported)

---

## Core principles

### 1. The LLM does NOT search on its own

The model:
- never claims internet access,
- never performs implicit searches,
- never “checks” or “verifies” facts online by itself.

Search is only possible via an **explicit user marker**:

```
???
```

This completely eliminates hallucinated browsing.

---

### 2. One search per user message (V1)

In **V1**, each user message can trigger **at most one** search cycle:

```
rewrite → search → rank → (fetch/extract) → (optional pack)
```

There are:
- no retries,
- no loops,
- no multi-step agent behavior.

This is **intentional**, to keep the system:
- fast,
- predictable,
- easy to reason about.

If the model determines that more data is needed, it outputs a new search query and **asks the user to repeat the request manually**.

---

### 3. Only the first trigger is processed

In V1:
- only the **first** `???` marker in a message is processed,
- multiple triggers in a single message are **not supported**.

---

## Architecture overview

The system is designed to work with Text Generation WebUI using its OpenAI-compatible API interface.

```
User
 ↓
WebUI (thin Python plugin)
 ↓
LLM
 ↓   (SEARCH_QUERY)
Searcher Service (Node.js)
 ├─ Search backend (SearXNG / DuckDuckGo)
 ├─ Snippet ranking (LLM, single call)
 ├─ Fetch & extract (local | jina)
 ├─ Cache (extracted text only)
 ↓
CONTEXT_PACK
 ↓
LLM final answer
```

### Why a thin WebUI plugin + external service?

Experience shows that complex WebUI plugins often turn into **Python dependency hell**, breaking WebUI upgrades or entire environments.

This project deliberately uses:
- a **thin Python plugin** (UI + orchestration only),
- a **separate search service** with its own dependencies, lifecycle and systemd units.

This makes installation, upgrades and maintenance **much safer and cleaner**.

---

## Search flow (V1)

For each user message containing `???`:

### 1. Query source

Two modes:

- **user_text**
  Your text after `???` is used as-is.

- **llm_query**
  The LLM rewrites your text into a concise search query.

You can switch modes at any time.

---

### 2. Search backends

Supported in V1:
- **SearXNG** (primary, recommended)
- **DuckDuckGo** (fallback, limited)

DuckDuckGo API is intentionally treated as a fallback due to its limited and often empty responses.

More backends (including commercial ones) are planned for future versions.

---

### 3. Snippet ranking (optional)

After search results are returned:
- the LLM performs **a single ranking call**,
- selects the most relevant snippets,
- deterministic fallback is used if ranking fails.

No loops, no retries, no agent behavior.

---

### 4. Fetch & extract (optional, full mode)

Two extraction engines are supported:

#### `local`
- Direct HTTP fetch
- Mozilla Readability
- High privacy
- Does **not** handle JS-rendered or protected pages

#### `jina`
- Uses the external Jina Reader service
- Better results on complex pages
- Optional API key for higher limits

---

### 5. Context handling

Two modes:

#### `inject`
Extracted content is injected directly into the prompt.

#### `llm_pack`
All extracted pages are passed to the LLM, which:
- selects only information relevant to the **full user question**,
- produces a compact summary,
- significantly reduces context pollution.

---

## Privacy and proxy support

Search API V1 supports routing **search requests and page fetching** through a SOCKS5 proxy.

This can be useful for:
- increased privacy,
- network isolation,
- bypassing regional or network-level restrictions.

### Configuration

Proxy usage is optional and disabled by default.

To enable it:
1. Open the relevant configuration files.
2. Uncomment the proxy sections.
3. Specify your SOCKS5 proxy address.

Example:

```yaml
proxy:
  socks_url: socks5://127.0.0.1:1080
```

Both search and fetch stages respect this setting.

---

## Cache (V1)

V1 includes a **simple, robust cache** by design.

- Caches **extracted text only**
- HTML is never stored
- Failed or empty extractions are not cached
- Key: `sha1(engine + normalized_url)`
- TTL-based cleanup using file `mtime`
- No index (intentional)

Cache locations:

- User install:
  `~/.cache/mistbyte-ai/websearch`

- System install:
  `/var/cache/mistbyte-ai/websearch`

---

## System prompt contract (important)

This project relies on a **strict system prompt contract**.

At minimum, the system prompt **must enforce the following rules**:

- The assistant does **NOT** have direct access to the web.
- The assistant must **never claim** that it can browse, search, or verify information online.
- Any `CONTEXT_PACK` must be treated as **explicitly provided input**, equivalent to user-supplied data.
- When additional information is required, the assistant may ask for a search **only** by emitting:
  ```
  SEARCH_QUERY:
  <single line query>
  ```
- The search query must be **a single line**, with no explanations, reasoning, or formatting.
- The assistant must **not** output reasoning, analysis, or `<think>` blocks when generating search queries.

A reference system prompt used during development is included in the repository.

Advanced users may adapt it, but **violating this contract will break guarantees**, including:
- hallucinated browsing,
- incorrect handling of CONTEXT_PACK,
- false “knowledge cutoff” claims.

Full reference prompt:
[`docs/system-prompt.txt`](docs/system-prompt.txt)

Additional docs:
- FAQ: [`docs/FAQ.md`](docs/FAQ.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
--

## Installation

The project ships with a single installer:

```
install.sh
```

It supports:
- user-level installation (recommended),
- system-wide installation,
- headless environments,
- systemd user services.

### User install vs system install

- Running as a regular user → user install
- Running as root → system install

User install is recommended to avoid writing into system directories.

**Recommended setup:** install in **USER mode** under the same Linux user account
that runs `text-generation-webui`.
This avoids permission mismatches between WebUI, the plugin, and systemd services,
and is the least error-prone configuration.

---

### WebUI plugin installation

The WebUI plugin is installed under the identifier **`websearch-mistbyte`**.

The installer:
- attempts to auto-detect `text-generation-webui`,
- installs the plugin automatically if found.

If auto-detection fails:
1. Create a directory in WebUI extensions:
   ```
   websearch_mistbyte
   ```
2. Copy `script.py` into it.
3. Restart **WebUI backend** (not just the browser UI).

(Note: the project identifier uses a dash, while the directory name uses an underscore.)

After restart, search settings appear below the input box.

---

## Headless user setup

For headless systems or servers:

```bash
sudo loginctl enable-linger <user>
```

Logs:
```bash
journalctl --user -u searxng -f
journalctl --user -u websearch-mistbyte -f
```

Commands must be executed as the same user that owns the services.

---

## Windows / WSL2 support

Search API V1 is **Linux-first**.

### Supported on Windows via WSL2

- Windows 10 / 11
- WSL2
- Linux filesystem inside WSL (`/home/...`)
- systemd enabled inside WSL

Enable systemd in WSL:

```
/etc/wsl.conf
[boot]
systemd=true
```

Then restart WSL:

```powershell
wsl --shutdown
```

Native Windows service installation is **not supported in V1**.

---

## Troubleshooting

For a full troubleshooting guide and configuration reference, see [`docs/FAQ.md`](docs/FAQ.md).

### Podman pull fails with TLS handshake timeout

If `podman pull` hangs or fails:

```bash
curl -4 -I https://registry-1.docker.io/v2/
curl -6 -I https://registry-1.docker.io/v2/
```

If IPv6 fails but IPv4 works, your system prefers IPv6 by default.

**Fix (recommended):**

```bash
sudo vim /etc/gai.conf
```

Add:

```
precedence ::ffff:0:0/96 100
```

This forces IPv4 preference and fixes most Podman/Docker TLS issues.

---

## Limitations (V1)

- One search per user message
- Only the first `???` trigger is processed
- No agent loop
- No multi-step search
- No headless browser extraction
- Sequential page fetching only

These limitations are **intentional**.

---

## Donations

This project is developed independently, without sponsors.

Donations directly accelerate development of roadmap features.

---

## Releases

See [`CHANGELOG.md`](CHANGELOG.md) for the release history and what changed in each version.

---

## Roadmap

See [ROADMAP.md](ROADMAP.md)

---

## About the author

More projects and technical background:
- https://home.vps.3-a.net/

---

## Summary

Search API V1 is a **clean, honest, engineering-driven foundation**.

It does not promise magic —
it delivers **predictable, controllable web search** for LLMs.
