import json
import os
import sys
import datetime
import re
import urllib.request
import urllib.error
import gradio as gr

DEFAULT_CFG = {
	"enable": False,
	"trigger_prefix": "???",
	"trigger_anywhere": True,
	"query_mode": "user_text",  # user_text | llm_query
	"full_handling": "inject",  # inject | llm_pack (only when search_mode=full)
	"fetch_engine": "local",  # local | jina (only used when search_mode=full)
	"llm_query_until_newline": False,
	"llm_query_max_words": 12,
	"llm_query_max_chars": 200,
	"snippet_rank_enabled": True,
	"snippet_rank_top_k": 10,
	"snippet_rank_pick_n_simple": 6,
	"snippet_rank_pick_n_full": 3,
	"verbose": False,
	"max_query_chars": 512,
	"llm_query_max_user_chars": 1024,

	"search_api_url": "http://127.0.0.1:7070/v1/search",
	"backend": "searxng",
	"search_mode": "simple",

	"timeout_search_s": 8,
	"timeout_search_full_s": 40,
	# Legacy single timeout (kept for backward compatibility)
	"timeout_llm_s": 10,
	# More granular timeouts (advanced; edit llm_web_search.json manually)
	"timeout_rewrite_s": 20,
	"timeout_rank_s": 30,
	"timeout_pack_s": 60,
	"rewrite_max_tokens": 1024,

	"openai_api_base": "http://127.0.0.1:5000/v1",
	"openai_model": "",
}

cfg = dict(DEFAULT_CFG)

# Persisted UI settings live near this script to keep it portable.
CFG_PATH = os.path.join(os.path.dirname(__file__), "llm_web_search.json")

# Only save user-facing knobs. Tech fields stay in DEFAULT_CFG / manual edits.
PERSIST_KEYS = [
	"enable",
	"trigger_anywhere",
	"query_mode",
	"backend",
	"search_mode",
	"full_handling",
	"llm_query_until_newline",
	"llm_query_max_words",
	"llm_query_max_chars",
 	"snippet_rank_enabled",
 	"snippet_rank_top_k",
	"snippet_rank_pick_n_simple",
	"fetch_engine",
	"snippet_rank_pick_n_full",
	"snippet_rank_pick_n",
	"verbose",
	"max_query_chars",
	"llm_query_max_user_chars",
	"rewrite_max_tokens",
	"timeout_rewrite_s",
	"timeout_rank_s",
	"timeout_pack_s",
	"timeout_search_full_s",
]

# params используется WebUI для отображаемого имени (и опционально settings.yaml),
# но НЕ для gradio-виджетов.
params = {
	"display_name": "Websearch Mistbyte",
	"is_tab": False,
}

def setup():
	_load_persisted_cfg()

def _load_persisted_cfg():
	try:
		with open(CFG_PATH, "r", encoding="utf-8") as f:
			data = json.load(f)
	except Exception:
		return

	if not isinstance(data, dict):
		return

	for k in PERSIST_KEYS:
		if k in data:
			cfg[k] = data[k]

def _save_persisted_cfg():
	data = {}
	for k in PERSIST_KEYS:
		data[k] = cfg.get(k)
	try:
		with open(CFG_PATH, "w", encoding="utf-8") as f:
			json.dump(data, f, ensure_ascii=False, indent=2)
	except Exception:
		return False
	return True

def _is_webui_verbose() -> bool:
	try:
		from modules import shared
		args = getattr(shared, "args", None)
		if args is None:
			return False
		return bool(getattr(args, "verbose", False))
	except Exception:
		return False

def _set_cfg(key: str, value):
	cfg[key] = value
	return ""  # возвращаем в "sink" (скрытый textbox), чтобы gradio был доволен

def _on_search_mode_change(v):
	cfg["search_mode"] = (v or "simple")
	return "", gr.update(interactive=(cfg["search_mode"] == "full"))

def _apply_and_save(enable_v, trigger_anywhere_v, query_mode_v, backend_v, search_mode_v, full_handling_v, fetch_engine_v, llm_query_until_newline_v, max_query_chars_v, llm_query_max_user_chars_v):
	cfg["enable"] = bool(enable_v)
	cfg["trigger_anywhere"] = bool(trigger_anywhere_v)
	cfg["query_mode"] = (query_mode_v or "user_text")
	cfg["backend"] = (backend_v or "searxng")
	cfg["search_mode"] = (search_mode_v or "simple")
	cfg["full_handling"] = (full_handling_v or "inject")
	cfg["fetch_engine"] = (fetch_engine_v or "local")
	cfg["llm_query_until_newline"] = bool(llm_query_until_newline_v)

	try:
		cfg["max_query_chars"] = int(max_query_chars_v) if max_query_chars_v is not None else 512
	except Exception:
		cfg["max_query_chars"] = 512

	try:
		cfg["llm_query_max_user_chars"] = int(llm_query_max_user_chars_v) if llm_query_max_user_chars_v is not None else 1024
	except Exception:
		cfg["llm_query_max_user_chars"] = 1024

	# rewrite_max_tokens is not exposed in UI (advanced), but must remain persistable
	try:
		cfg["rewrite_max_tokens"] = int(cfg.get("rewrite_max_tokens") or 512)
	except Exception:
		cfg["rewrite_max_tokens"] = 512

	_save_persisted_cfg()
	return "", gr.update(interactive=(cfg["search_mode"] == "full"))

def ui():
	with gr.Accordion("Websearch Mistbyte", open=False):
		_sink = gr.Textbox(value="", visible=False)

		enable = gr.Checkbox(value=cfg["enable"], label="Enable web search")
		gr.Markdown(f"Use `{cfg.get('trigger_prefix') or '???'}` as search trigger prefix.")
		trigger_anywhere = gr.Checkbox(value=cfg["trigger_anywhere"], label="Trigger anywhere (not only at start)")
		query_mode = gr.Dropdown(choices=["user_text", "llm_query"], value=cfg["query_mode"], label="Query mode")

		backend = gr.Dropdown(choices=["searxng", "duckduckgo"], value=cfg["backend"], label="Backend")
		search_mode = gr.Dropdown(choices=["simple", "full"], value=cfg["search_mode"], label="Search mode")
		full_handling = gr.Dropdown(
			choices=["inject", "llm_pack"],
			value=cfg["full_handling"],
			label="Full handling",
			interactive=(cfg["search_mode"] == "full"),
		)
		fetch_engine = gr.Dropdown(
			choices=["local", "jina"],
			value=cfg.get("fetch_engine") or "local",
			label="Fetch engine (full mode)",
			interactive=(cfg["search_mode"] == "full"),
		)

		gr.Markdown("---")
		llm_query_until_newline = gr.Checkbox(value=cfg["llm_query_until_newline"], label="LLM query until newline")
		max_query_chars = gr.Number(value=cfg["max_query_chars"], label="Max query chars")
		llm_query_max_user_chars = gr.Number(value=cfg["llm_query_max_user_chars"], label="LLM query max user chars")
		apply_save = gr.Button(value="Apply & Save")
		gr.Markdown("---")
		cache_clear = gr.Button(value="Clear fetch cache")
		cache_clear_status = gr.Textbox(value="", label="Cache status")
		# link: UI changed -> cfg
		enable.change(lambda v: _set_cfg("enable", bool(v)), inputs=enable, outputs=_sink)
		trigger_anywhere.change(lambda v: _set_cfg("trigger_anywhere", bool(v)), inputs=trigger_anywhere, outputs=_sink)
		query_mode.change(lambda v: _set_cfg("query_mode", (v or "user_text")), inputs=query_mode, outputs=_sink)

		backend.change(lambda v: _set_cfg("backend", (v or "searxng")), inputs=backend, outputs=_sink)
		search_mode.change(_on_search_mode_change, inputs=search_mode, outputs=[_sink, full_handling])
		full_handling.change(lambda v: _set_cfg("full_handling", (v or "inject")), inputs=full_handling, outputs=_sink)
		fetch_engine.change(lambda v: _set_cfg("fetch_engine", (v or "local")), inputs=fetch_engine, outputs=_sink)
		llm_query_until_newline.change(lambda v: _set_cfg("llm_query_until_newline", bool(v)), inputs=llm_query_until_newline, outputs=_sink)
		max_query_chars.change(lambda v: _set_cfg("max_query_chars", int(v) if v is not None else 512), inputs=max_query_chars, outputs=_sink)
		llm_query_max_user_chars.change(lambda v: _set_cfg("llm_query_max_user_chars", int(v) if v is not None else 1024), inputs=llm_query_max_user_chars, outputs=_sink)

		apply_save.click(
			_apply_and_save,
			inputs=[enable, trigger_anywhere, query_mode, backend, search_mode, full_handling, fetch_engine, llm_query_until_newline, max_query_chars, llm_query_max_user_chars],
			outputs=[_sink, full_handling],
		)

		cache_clear.click(
			lambda: _call_cache_clear(),
			inputs=[],
			outputs=[cache_clear_status],
		)

def _http_post_json(url: str, payload: dict, timeout_s: int) -> dict:
	data = json.dumps(payload).encode("utf-8")
	req = urllib.request.Request(
		url,
		data=data,
		method="POST",
		headers={
			"Content-Type": "application/json",
			"Accept": "application/json",
		},
	)
	with urllib.request.urlopen(req, timeout=timeout_s) as resp:
		raw = resp.read().decode("utf-8", errors="replace")
		return json.loads(raw)

def _derive_cache_clear_url() -> str:
	base = (cfg.get("search_api_url") or "").strip()
	if not base:
		return ""
	# Common case: .../v1/search -> .../v1/cache/clear
	if base.endswith("/v1/search"):
		return base[:-len("/v1/search")] + "/v1/cache/clear"
	# Fallback: append path (best-effort)
	if base.endswith("/"):
		base = base[:-1]
	return base + "/v1/cache/clear"

def _call_cache_clear() -> str:
	url = _derive_cache_clear_url()
	if not url:
		return "Cache clear URL is not configured."

	# Small timeout; this is a local service call.
	to = 5
	try:
		req = urllib.request.Request(
			url,
			data=b"{}",
			method="POST",
			headers={
				"Content-Type": "application/json",
				"Accept": "application/json",
			},
		)
		urllib.request.urlopen(req, timeout=to).read()
		return "Cache cleared."
	except Exception as e:
		return f"Cache clear failed: {str(e)}"

def _render_context_pack(items: list, max_context_chars: int|None, max_snippet_chars: int) -> str:
	# Deterministic wrapper compatible with searcher renderContextPack().
	out = []
	out.append("[CONTEXT_PACK ucp-1]")
	out.append("type: web_search_results")

	if not items:
		out.append("status: empty")
		out.append("")
		out.append("(no results returned by backend)")
		out.append("")
		out.append("[/CONTEXT_PACK]")
		return "\n".join(out)

	out.append("status: ok")
	out.append("")

	def _trim_snippet(s: str, max_chars: int) -> str:
		t = (s or "").strip()
		if not max_chars or max_chars <= 0:
			return t
		if len(t) <= max_chars:
			return t
		return t[:max_chars]

	for it in items:
		title = (it.get("title") or "").strip()
		url = (it.get("url") or "").strip()
		snippet = (it.get("snippet") or "").strip()

		if not (title or url or snippet):
			continue

		rank = it.get("rank")
		try:
			rank = int(rank)
		except Exception:
			rank = 0

		out.append(f"{rank}. {title}" if title else f"{rank}.")
		if url:
			out.append(url)

		sn = _trim_snippet(snippet, int(max_snippet_chars or 0))
		if sn:
			out.append(sn)

	out.append("")
	out.append("[/CONTEXT_PACK]")

	txt = "\n".join(out)

	if max_context_chars and max_context_chars > 0 and len(txt) > max_context_chars:
		# Deterministic cut: keep head and tail with marker.
		keep_head = max_context_chars // 2
		keep_tail = max_context_chars - keep_head - 40
		if keep_tail < 0:
			keep_tail = 0
		txt = txt[:keep_head] + "\n...TRUNCATED...\n" + (txt[-keep_tail:] if keep_tail else "")

	return txt

def _render_pack_summary(summary_text: str) -> str:
	# Deterministic wrapper for packed/summarized content (full_handling=llm_pack).
	out = []
	out.append("[CONTEXT_PACK ucp-1]")
	out.append("type: web_search_summary")
	out.append("status: ok")
	out.append("")
	out.append("SUMMARY:")
	out.append((summary_text or "").strip())
	out.append("")
	out.append("[/CONTEXT_PACK]")
	return "\n".join(out)

def _extract_json_object(text: str) -> str:
	# Best-effort extraction of a JSON value (object or array) from arbitrary text.
	if not isinstance(text, str):
		return ""
	s = text.strip()
	if not s:
		return ""
	if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
		return s
	# Try object first
	a = s.find("{")
	b = s.rfind("}")
	if a != -1 and b != -1 and b > a:
		return s[a:b+1].strip()
	# Then try array
	a = s.find("[")
	b = s.rfind("]")
	if a != -1 and b != -1 and b > a:
		return s[a:b+1].strip()
	return ""

def _extract_json_after_anchor(raw: str, anchor: str) -> str:
	# Extract a JSON value (object or array) after a line prefix like "JSON:" (case-insensitive).
	if not isinstance(raw, str):
		return ""
	s = raw.replace("\r", "\n")
	low_anchor = (anchor or "").lower()
	if not low_anchor:
		return ""
	for ln in s.split("\n"):
		t = (ln or "").strip()
		if not t:
			continue
		if t.lower().startswith(low_anchor):
			rest = t[len(anchor):].strip()
			return _extract_json_object(rest)
	return ""

def _extract_single_line_query(raw: str, max_words: int, max_chars: int) -> str:
	"""
	Robust extraction of a single-line search query from LLM output.
	Strategy:
	- If output contains an explicit "QUERY:" anchor, prefer it:
	  * Take the text after "QUERY:" (same line) as the answer.
	- If output starts with a tag (<tag>), treat it as reasoning.
	  * If matching </tag> exists -> take everything AFTER it.
	  * If not -> consider output incomplete and return "" (fallback).
	- If output does NOT start with a tag -> treat whole output as answer.
	Limits are applied AFTER extraction.
	"""
	if not isinstance(raw, str):
		return ""

	s = raw.replace("\r", "\n").strip()
	if not s:
		return ""

	# Prefer explicit anchor if present (works even if the model emitted reasoning).
	# We accept both "QUERY:" and "Query:" etc.
	try:
		for ln in s.split("\n"):
			t = (ln or "").strip()
			if not t:
				continue
			if t.lower().startswith("query:"):
				s = t[len("query:"):].strip()
				break
	except Exception:
		pass

	# Check if output starts with a tag: <tagname>
	m = re.match(r"^\s*<([a-zA-Z0-9_:-]+)>", s)
	if m:
		tag = m.group(1)
		close_tag = f"</{tag}>"
		pos = s.lower().find(close_tag.lower())
		if pos == -1:
			# Reasoning started but not closed -> no reliable answer
			return ""
		# Take everything AFTER closing tag
		s = s[pos + len(close_tag):].strip()

	# Remove fenced code blocks
	s = re.sub(r"```[\s\S]*?```", " ", s)

	# Take first non-empty line as the answer
	lines = []
	for ln in s.split("\n"):
		ln = (ln or "").strip()
		if ln:
			lines.append(ln)

	if not lines:
		return ""

	q = lines[0]

	# Normalize whitespace and quotes
	q = q.replace("\t", " ")
	q = " ".join(q.split())
	q = q.strip().strip('"').strip("'").strip()

	if not q:
		return ""

	# Enforce limits AFTER extraction
	if max_words > 0:
		words = q.split()
		if len(words) > max_words:
			q = " ".join(words[:max_words]).strip()

	if max_chars > 0 and len(q) > max_chars:
		q = q[:max_chars].strip()

	return q

def _today_utc_iso_date() -> str:
	# Provide the current date to the model to avoid "future/past" confusion.
	try:
		return datetime.datetime.utcnow().date().isoformat()
	except Exception:
		return ""

def _call_openai_snippet_rank(query_text: str, candidates: list, want_n: int, timeout_s: int) -> list:
	# Returns list of picked indices (ints) referring to candidates[i].
	today = _today_utc_iso_date()
	system = (
		(f"Current date: {today}.\n" if today else "") +
		"Ranking policy for time relevance:\n"
		"- If the question requires present-time relevance, prioritize candidates whose title or snippet contains explicit dates or years closest to the Current date.\n"
		"- Prefer candidates explicitly mentioning the Current year.\n"
		"- Deprioritize candidates that clearly refer to an earlier period (e.g. year ranges ending before the Current date, or terms like former, previous, ex-).\n"
		"- If a source explicitly states it is archived, frozen in time, not updated, or deprecated, deprioritize it for present-time or \"current/latest\" questions.\n"
		"- If candidates contradict each other about a present-time fact, prefer those consistent with the most recent, explicitly time-anchored information closest to the Current date.\n"
		"Ranking policy for source authority:\n"
		"- Prefer original, official, or primary sources (e.g. government websites, official vendor or project pages) over secondary summaries, biography pages, SEO articles, or mirrors.\n"
		"Ranking policy for language:\n"
		"- Prefer sources in the same language as the question and English.\n"
		"- If the question is not in Chinese, deprioritize Chinese-language sources unless there are no reasonable alternatives.\n"
		"You are ranking web search results by relevance to a user question. "
		"Return ONLY valid JSON prefixed with 'JSON: ' like: JSON: {\"pick\":[...]}. "
		"Indices must be distinct. "
		f"Pick exactly {int(want_n)} indices (or fewer if fewer candidates are available). "
		"No extra text."
	)

	lines = []
	lines.append(f"Question: {query_text}")
	lines.append("")
	lines.append("Candidates:")
	for c in candidates:
		i = c.get("i")
		title = (c.get("title") or "").strip()
		snippet = (c.get("snippet") or "").strip()
		url = (c.get("url") or "").strip()
		lines.append(f"{i}) {title} — {snippet} (URL: {url})")
	lines.append("")
	lines.append("Return JSON only.")

	messages = [
		{"role": "system", "content": system},
		{"role": "user", "content": "\n".join(lines)},
		{"role": "assistant", "content": "JSON: "},
	]

	payload = {
		"messages": messages,
		"temperature": 0.1,
		# Allow small models to finish reasoning and output the final query.
		# NOTE: verbose prints are truncated; see llm_query_raw_len / tail.
		"max_tokens": int(cfg.get("rewrite_max_tokens") or 512),
	}

	model = (cfg.get("openai_model") or "").strip()
	if model:
		payload["model"] = model

	base = (cfg.get("openai_api_base") or "").rstrip("/")
	url = base + "/chat/completions"

	data = _http_post_json(url, payload, int(timeout_s))

	try:
		content = data["choices"][0]["message"]["content"]
	except Exception:
		return []

	# Best-effort: strip leading reasoning tags (think/reasoning/analysis) but keep the rest.
	try:
		if isinstance(content, str):
			s = content.strip()
			m = re.match(r"^\s*<([a-zA-Z0-9_:-]+)>", s)
			if m:
				tag = m.group(1)
				close_tag = f"</{tag}>"
				pos = s.lower().find(close_tag.lower())
				if pos != -1:
					s = s[pos + len(close_tag):].strip()
			content = s
	except Exception:
		pass

	effective_verbose = bool(cfg.get("verbose")) or _is_webui_verbose()
	if effective_verbose:
		try:
			c = content if isinstance(content, str) else ""
			c1 = c.replace("\n", "\\n")
			if len(c1) > 400:
				c1 = c1[:400] + "..."
			print(f"[llm_web_search] snippet_rank_raw: {c1}")
		except Exception:
			pass

	# Prefer anchored JSON to avoid grabbing braces from stray reasoning text.
	jtxt = _extract_json_after_anchor(content if isinstance(content, str) else "", "JSON:")
	if not jtxt:
		jtxt = _extract_json_object(content if isinstance(content, str) else "")
	if effective_verbose and jtxt:
		try:
			j1 = jtxt.replace("\n", "\\n")
			if len(j1) > 300:
				j1 = j1[:300] + "..."
			print(f"[llm_web_search] snippet_rank_json: {j1}")
		except Exception:
			pass
	if not jtxt:
		return []

	try:
		obj = json.loads(jtxt)
	except Exception:
		return []

	# Accept both object format {"pick":[...]} and plain list format [..]
	# Some small models ignore the contract and output a bare JSON array.
	if isinstance(obj, list):
		pick = obj
	else:
		pick = obj.get("pick") if isinstance(obj, dict) else None
		if not isinstance(pick, list):
			return []

	n = len(candidates)
	seen = set()
	out = []
	for v in pick:
		try:
			iv = int(v)
		except Exception:
			continue
		if iv < 0 or iv >= n:
			continue
		if iv in seen:
			continue
		seen.add(iv)
		out.append(iv)
		if want_n and len(out) >= int(want_n):
			break

	return out

def _call_search_api_ucp(query_text: str, want_rendered: bool, want_items: bool, pick_ids: list|None=None, search_mode: str|None=None, seed_items: list|None=None) -> dict:
	# Full mode can take significantly longer because the Search Service fetches and extracts pages.
	# Use a separate timeout for the client-side HTTP request to avoid returning an empty context pack.
	mode = (search_mode or cfg.get("search_mode") or "simple")
	to = cfg.get("timeout_search_s")
	try:
		to = int(to) if to is not None else 8
	except Exception:
		to = 8
	if mode == "full":
		to2 = cfg.get("timeout_search_full_s")
		try:
			to2 = int(to2) if to2 is not None else None
		except Exception:
			to2 = None
		if to2 and to2 > 0:
			to = to2
	fetch_engine = (cfg.get("fetch_engine") or "local")
	try:
		fetch_engine = fetch_engine.strip()
	except Exception:
		fetch_engine = "local"
	payload = {
		"query": {"text": query_text},
		"constraints": {"search_mode": (search_mode or cfg["search_mode"]), "backend": cfg["backend"], "fetch_engine": fetch_engine},
		"want": {"rendered_text": bool(want_rendered), "items": bool(want_items)},
		"policy": {"backend": cfg["backend"]},
	}

	if pick_ids is not None:
		payload["constraints"]["pick_ids"] = pick_ids
	if seed_items is not None:
		payload["constraints"]["seed_items"] = seed_items

	return _http_post_json(cfg["search_api_url"], payload, int(to))

def _call_search_api(query_text: str) -> str:
	data = _call_search_api_ucp(query_text, True, False, None)
	rt = data.get("rendered_text", "")
	return rt if isinstance(rt, str) else ""

def _call_openai_rewrite(user_text: str) -> str:
	max_words = cfg.get("llm_query_max_words") or 12
	try:
		max_words = int(max_words)
	except Exception:
		max_words = 12

	max_chars = cfg.get("llm_query_max_chars") or 200
	try:
		max_chars = int(max_chars)
	except Exception:
		max_chars = 200

	# Reference datetime for time-anchored queries (UTC, ISO-8601)
	ref_dt = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
	system = (
		f"Current datetime (reference, UTC): {ref_dt}\n"
		"Treat the reference datetime above as the real present time ('now') for this request. Do NOT question it or compare it to your training cutoff.\n"
		"Any time-relative expressions in the user request (e.g. now, current, today, this year)\n"
		"MUST be interpreted relative to the reference datetime above.\n"
		"If the request is time-relative, the search query MUST explicitly include\n"
		"a time anchor (year or date) derived from the reference datetime.\n"
		"If a time anchor is included, use ONLY the year or date (YYYY or YYYY-MM-DD).\n"
		"Do NOT include time-of-day or timezone.\n"
		"Do NOT inject or guess a specific PERSON name unless it is explicitly present in the user text. Technical terms, product names, libraries, commands, and acronyms are allowed.\n"
		"If the user asks 'who is ... now/current/today' (or similar), keep the query person-agnostic (do NOT include any person's name).\n"
		"Rewrite the user's text into a concise web search query.\n"
		"Return ONLY the query text as a SINGLE LINE.\n"
		"Be brief and factual.\n"
		"Do NOT include explanations, reasoning, or <think>/<thinking> blocks.\n"
		"Output MUST start with 'QUERY: ' followed by the final query.\n"
		f"Max {max_words} words."
	)
	messages = [
		{"role": "system", "content": system},
		{"role": "user", "content": user_text},
		{"role": "assistant", "content": "QUERY: "},
	]

	payload = {
		"messages": messages,
		"temperature": 0.2,
		# Allow small models (e.g. 8B) to finish even if they reason first
		"max_tokens": int(cfg.get("rewrite_max_tokens") or 512),
	}

	model = (cfg.get("openai_model") or "").strip()
	if model:
		payload["model"] = model

	base = (cfg.get("openai_api_base") or "").rstrip("/")
	url = base + "/chat/completions"

	# Prefer granular timeout if configured, otherwise fall back to legacy timeout_llm_s.
	to = cfg.get("timeout_rewrite_s")
	try:
		to = int(to) if to is not None else None
	except Exception:
		to = None
	if not to or to <= 0:
		try:
			to = int(cfg.get("timeout_llm_s") or 10)
		except Exception:
			to = 10
	data = _http_post_json(url, payload, int(to))


	try:
		content = data["choices"][0]["message"]["content"]
	except Exception:
		return ""

	if not isinstance(content, str):
		return ""

	effective_verbose = bool(cfg.get("verbose")) or _is_webui_verbose()
	if effective_verbose:
		try:
			# Always show tail too; head-only hides closing tags on short outputs.
			raw_len = len(content)
			c1 = content.replace("\n", "\\n")
			head = c1[:400] + ("..." if len(c1) > 400 else "")
			tail = ("..." + c1[-200:]) if len(c1) > 200 else c1
			has_close = False
			try:
				# Generic detection: if output begins with <tag>, check for matching </tag>
				m2 = re.match(r"^\s*<([a-zA-Z0-9_:-]+)>", content.strip())
				if m2:
					tag = m2.group(1)
					has_close = (f"</{tag}>".lower() in content.lower())
			except Exception:
				has_close = False
			print(f"[llm_web_search] llm_query_raw_len: {raw_len}")
			print(f"[llm_web_search] llm_query_raw_head: {head}")
			print(f"[llm_web_search] llm_query_raw_tail: {tail}")
			print(f"[llm_web_search] llm_query_has_close_tag: {bool(has_close)}")
		except Exception:
			pass
	q = _extract_single_line_query(content, int(max_words), int(max_chars))
	if not q:
		return ""
	return q

def _call_openai_pack(user_text: str, context_pack: str) -> str:
	# Returns a concise summary based only on the provided CONTEXT_PACK.
	today = _today_utc_iso_date()
	system = (
		(f"Current date: {today}.\n" if today else "") +
		"You are a summarizer. You will be given a CONTEXT_PACK with web search results and extracted page text.\n"
		"Answer the user's question using ONLY the information in CONTEXT_PACK.\n"

		# --- rules about time & conflicts ---
		"If sources contradict each other about present-time facts, prefer those consistent with the most recent, explicitly time-anchored information.\n"
		"If a source explicitly says it is archived, frozen in time, not updated, or deprecated, deprioritize it for present-time or 'current/latest' claims.\n"
		"If no source in CONTEXT_PACK explicitly supports the present-time fact as of the Current date, say you could not find it in the provided sources.\n"

		# --- algorithmic guidance ---
		"Process:\n"
		"1) Identify the most up-to-date answer target strictly from explicit cues in CONTEXT_PACK "
		"(e.g. 'current', 'incumbent', 'latest', 'as of <date/year>', 'version X', 'term ...–', 'assumed office', 'released on').\n"
		"2) Ignore sources that describe a different time period or state, unless the question explicitly asks for historical information.\n"
		"3) Answer the question using ONLY sources consistent with the target identified in step (1).\n"
		"4) If no such source exists, say you could not find the answer in the provided sources.\n"

		# --- output constraints ---
		"Be concise and factual. Do NOT include reasoning or <think>/<thinking> blocks.\n"
		"Output MUST start with 'PACK: ' followed by the summary text."
	)
	messages = [
		{"role": "system", "content": system},
		{"role": "user", "content": f"{context_pack}\n\nUSER_QUESTION:\n{user_text}"},
		{"role": "assistant", "content": "PACK: "},
	]

	payload = {
		"messages": messages,
		"temperature": 0.2,
		"max_tokens": 1024,
	}

	model = (cfg.get("openai_model") or "").strip()
	if model:
		payload["model"] = model

	base = (cfg.get("openai_api_base") or "").rstrip("/")
	url = base + "/chat/completions"

	to = cfg.get("timeout_pack_s")
	try:
		to = int(to) if to is not None else None
	except Exception:
		to = None
	if not to or to <= 0:
		try:
			to = int(cfg.get("timeout_llm_s") or 60)
		except Exception:
			to = 60

	data = _http_post_json(url, payload, int(to))
	try:
		content = data["choices"][0]["message"]["content"]
	except Exception:
		return ""
	if not isinstance(content, str):
		return ""

	effective_verbose = bool(cfg.get("verbose")) or _is_webui_verbose()
	if effective_verbose:
		try:
			raw = content.replace("\r", "")
			head = raw[:160].replace("\n", "\\n")
			tail = raw[-160:].replace("\n", "\\n") if len(raw) > 160 else head
			print(f"[llm_web_search] llm_pack_raw_len: {len(raw)}")
			print(f"[llm_web_search] llm_pack_raw_head: {head}")
			print(f"[llm_web_search] llm_pack_raw_tail: {tail}")
		except Exception:
			pass

	idx = content.find("PACK:")
	if idx >= 0:
		content = content[idx + len("PACK:"):].strip()
	else:
		content = content.strip()
	return content

def input_modifier(string, state, is_chat=False):
	if not cfg.get("enable"):
		return string

	s = string or ""
	prefix = cfg.get("trigger_prefix") or "???"
	if not isinstance(prefix, str):
		prefix = "???"

	pos = s.find(prefix) if cfg.get("trigger_anywhere", True) else (0 if s.startswith(prefix) else -1)
	if pos < 0:
		return s

	# Full user message for the LLM: keep everything before and after the trigger,
	# remove ONLY the trigger marker itself (do not strip surrounding spaces).
	llm_user_text = s[:pos] + s[pos + len(prefix):]
	llm_user_text_stripped = llm_user_text.strip()

	# Search query source: text AFTER the trigger (optionally only until newline).
	query_src = s[pos + len(prefix):]
	if cfg.get("llm_query_until_newline", False):
		query_src = query_src.split("\n", 1)[0]
	query_src = query_src.strip()

	# If there's no usable query after the trigger, do not fire the search.
	if not query_src:
		return s

	max_q = cfg.get("max_query_chars") or 512
	try:
		max_q = int(max_q)
	except Exception:
		max_q = 512

	effective_verbose = bool(cfg.get("verbose")) or _is_webui_verbose()
	query = query_src
	qgen = ""
	if (cfg.get("query_mode") or "user_text") == "llm_query":
		try:
			max_u = cfg.get("llm_query_max_user_chars") or 1024
			try:
				max_u = int(max_u)
			except Exception:
				max_u = 1024

			u2 = query_src[:max_u]
			q2 = _call_openai_rewrite(u2)
			if q2:
				query = q2
				qgen = q2
			else:
				# If rewrite returned empty (e.g., model emitted only <think>), keep user_text.
				if effective_verbose:
					print("[llm_web_search] llm_query_empty: fallback_to_user_text")
		except Exception:
			query = query_src

	if effective_verbose:
		try:
			if qgen:
				print(f"[llm_web_search] llm_query: {qgen}")
			print(f"[llm_web_search] query_used: {query}")
		except Exception:
			pass

	if len(query) > max_q:
		query = query[:max_q].strip()

	# Fetch items once (single search call) and render locally to avoid output/candidate mismatch.
	items = []
	try:
		ucp = _call_search_api_ucp(query, False, True, None, search_mode="simple")
		items = ucp.get("items") if isinstance(ucp, dict) else None
		if not isinstance(items, list):
			items = []
	except Exception:
		items = []

	rendered = ""
	picked = []
	used_fallback = False

	want_n = 3
	try:
		if (cfg.get("search_mode") or "simple") == "simple":
			want_n = int(cfg.get("snippet_rank_pick_n_simple") or 6)
		else:
			want_n = int(cfg.get("snippet_rank_pick_n_full") or 3)
	except Exception:
		want_n = 3

	if cfg.get("snippet_rank_enabled") and items:
		k = int(cfg.get("snippet_rank_top_k") or 10)

		if "snippet_rank_pick_n" in cfg:
			want_n = int(cfg.get("snippet_rank_pick_n") or want_n)

		candidates = []
		for idx, it in enumerate(items[:max(0, k)]):
			candidates.append({
				"i": idx,
				"title": (it.get("title") or ""),
				"snippet": (it.get("snippet") or ""),
				"url": (it.get("url") or ""),
			})

		# Prefer granular timeout if configured, otherwise fall back to legacy timeout_llm_s.
		to = cfg.get("timeout_rank_s")
		try:
			to = int(to) if to is not None else None
		except Exception:
			to = None
		if not to or to <= 0:
			try:
				to = int(cfg.get("timeout_llm_s") or 10)
			except Exception:
				to = 10
		try:
			picked = _call_openai_snippet_rank(query_src, candidates, want_n, int(to))
		except Exception:
			picked = []

		if picked:
			if (cfg.get("search_mode") or "simple") == "full":
				# Full mode: re-call Search API with pick_ids so the server can fetch/extract pages.
				try:
					# Keep extraction aligned with the SAME candidate list we just ranked.
					ucp2 = _call_search_api_ucp(query, True, True, picked, search_mode="full", seed_items=items)
					rendered = (ucp2.get("rendered_text") or "") if isinstance(ucp2, dict) else ""
				except Exception:
					rendered = ""
			else:
				picked_items = [items[i] for i in picked if i >= 0 and i < len(items)]
				rendered = _render_context_pack(picked_items, None, 600)
		else:
			used_fallback = True
			# If ranker returned empty, fall back to engine order (first N) so full-mode still fetches something.
			try:
				if items and want_n and int(want_n) > 0:
					picked = list(range(min(int(want_n), len(items))))
				else:
					picked = []
			except Exception:
				picked = []

			# In full mode, ask searcher-service to fetch/extract the fallback picks so CONTENT is available.
			if (cfg.get("search_mode") or "simple") == "full" and picked:
				try:
					# Keep extraction aligned with the SAME candidate list we just ranked.
					u2 = _call_search_api_ucp(query, True, False, picked, search_mode="full", seed_items=items)
					rt = u2.get("rendered_text", "") if isinstance(u2, dict) else ""
					if isinstance(rt, str) and rt:
						rendered = rt
				except Exception:
					pass

		if effective_verbose:
			try:
				urls = []
				for i in picked:
					if i >= 0 and i < len(items):
						urls.append((items[i].get("url") or ""))
				print(f"[llm_web_search] snippet_rank pick={picked} fallback={used_fallback} urls={urls}")
			except Exception:
				pass

	if not rendered:
		# Fallback: unranked selection. In full mode, re-call Search API so it can fetch/extract pages.
		unranked = items[:max(0, want_n)] if items else []
		if (cfg.get("search_mode") or "simple") == "full":
			ids = list(range(0, len(unranked)))
			try:
				# Keep extraction aligned with the SAME candidate list we just ranked.
				ucp2 = _call_search_api_ucp(query, True, True, ids, search_mode="full", seed_items=unranked)
				rendered = (ucp2.get("rendered_text") or "") if isinstance(ucp2, dict) else ""
			except Exception:
				rendered = ""
		else:
			rendered = _render_context_pack(unranked, None, 600)

	# Optional LLM pack in full mode: summarize fetched/extracted text before injecting into the model prompt.
	if rendered and (cfg.get("search_mode") or "simple") == "full" and (cfg.get("full_handling") or "inject") == "llm_pack":
		try:
			packed = _call_openai_pack(llm_user_text_stripped or query_src, rendered)
			if isinstance(packed, str) and packed.strip():
				rendered = _render_pack_summary(packed)
		except Exception:
			pass

	if not rendered:
		return llm_user_text  # remove trigger even if empty, to avoid polluting the prompt

	# Inject current date into the main prompt context (works even when full_handling=inject).
	# This helps local models to avoid "future/past" confusion when reading fresh web data.
	today = _today_utc_iso_date()
	if today:
		rendered = f"Current date: {today} (UTC).\n\n" + rendered

	return f"{rendered}\n\n{llm_user_text}"


#<EOF script.py lines: 1013>
