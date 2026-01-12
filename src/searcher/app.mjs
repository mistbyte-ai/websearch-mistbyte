import Fastify from "fastify";
import path from "path";
import { loadConfig } from "./config.mjs";
import { buildUcpResponse } from "./ucp.mjs";
import { searxngSearchSimple } from "./backends/searxng.mjs";
import { renderContextPack } from "./render.mjs";
import { duckduckgoSearchSimple } from "./backends/duckduckgo.mjs";
import { fetchAndExtract } from "./fetch.mjs";
import { createWebCache } from "./cache.mjs";

const fastify = Fastify({ logger: true });

function _getArgValue(args, key) {
	try {
		const i = args.indexOf(key);
		if (i >= 0 && i + 1 < args.length) {
			const v = args[i + 1];
			if (v && !v.startsWith("-")) return v;
		}
	}
	catch {/**/}
	return "";
}

function _resolveConfigPath(p) {
	try {
		if (!p) return "";
		return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
	}
	catch {/**/}
	return "";
}

let config;
try {
	const cfgArg = (
		_getArgValue(process.argv, "--config") ||
		_getArgValue(process.argv, "-c")
	);
	const cfgPath = _resolveConfigPath(cfgArg);
	config = loadConfig(cfgPath || undefined);
}
catch (err) {
	console.error(err.message);
	process.exit(1);
}

const cache = createWebCache(config?.service?.cache || {});

function _asInt(v, dflt) {
	try {
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : dflt;
	}
	catch {/**/}
	return dflt;
}

// eslint-disable-next-line no-unused-vars
function _asBool(v, dflt) {
	if (v === true) return true;
	if (v === false) return false;
	return dflt;
}

function _getFetchEngine(body) {
	const e = (body?.constraints?.fetch_engine || "").toString().trim().toLowerCase();
	if (e) return e;
	const d = (config?.service?.fetch?.engine || "").toString().trim().toLowerCase();
	return d || "local";
}

function _getFetchConfig() {
	return config?.service?.fetch || {};
}

function _getQueryText(body) {
	if (typeof body?.query === "string") return body.query.toString().trim();
	if (typeof body?.query?.text === "string") return body.query.text.toString().trim();
	return "";
}

function _getBackendPolicy(body) {
	// Accept both spec-like constraints.backend and legacy policy.backend.
	const b1 = (body?.constraints?.backend || "").toString().trim();
	if (b1) return b1;
	const b2 = (body?.policy?.backend || "").toString().trim();
	return b2;
}

function _getSearchMode(body) {
	const m = (body?.constraints?.search_mode || "").toString().trim();
	return (m === "full") ? "full" : "simple";
}

function _getPickIds(body) {
	const raw = body?.constraints?.pick_ids;
	if (!Array.isArray(raw)) return [];
	const seen = new Set();
	const out = [];
	for (const v of raw) {
		const n = _asInt(v, null);
		if (n === null) continue;
		if (n < 0) continue;
		if (seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	return out;
}

function _applyPick(items, pickIds) {
	if (!Array.isArray(pickIds) || pickIds.length === 0) {
		return { items, pickApplied: false };
	}

	const out = [];
	for (const idx of pickIds) {
		if (idx >= 0 && idx < items.length) {
			out.push(items[idx]);
		}
	}
	return { items: out, pickApplied: true };
}

function _budgetOrCfg(body, key, cfgVal) {
	const b = body?.budget?.[key];
	return (b !== undefined && b !== null) ? b : cfgVal;
}

function _budgetTimeout(body, key, cfgVal) {
	const b = body?.budget?.per_request_timeout_ms?.[key];
	return (b !== undefined && b !== null) ? b : cfgVal;
}

function _getFetchHeaders(cfg) {
	const h = cfg?.service?.fetch?.headers || {};
	const ua = (h?.user_agent || "").toString().trim();
	const accept = (h?.accept || "").toString().trim();
	const al = (h?.accept_language || "").toString().trim();
	const out = {};
	if (ua) out["User-Agent"] = ua;
	if (accept) out["Accept"] = accept;
	if (al) out["Accept-Language"] = al;
	return out;
}

const DEFAULT_FETCH_HEADERS = {
	"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

fastify.get("/healthz", async () => {
	return { ok: true };
});

fastify.post("/v1/cache/clear", async () => {
	const cleared = await cache.clearAll();
	return { ok: true, cleared };
});

fastify.post("/v1/search", async (request) => {
	const t0 = Date.now();

	const body = request.body ?? {};
	const query = _getQueryText(body);

	const wantItems = body?.want?.items !== false;
	const wantRendered = body?.want?.rendered_text !== false;

	const maxResults = _asInt(
		_budgetOrCfg(body, "max_results", config?.service?.limits?.max_results || 10),
		10
	);

	const timeoutSearchMs = _asInt(
		_budgetTimeout(body, "search", config?.service?.timeouts_ms?.search || 6000),
		6000
	);

	const maxSnippetChars = _asInt(
		_budgetOrCfg(body, "max_snippet_chars", config?.service?.limits?.max_snippet_chars || 600),
		600
	);

	const maxContextChars = _asInt(
		_budgetOrCfg(body, "max_context_chars", config?.service?.limits?.max_context_chars || 0),
		0
	) || null;

	const maxContentCharsPerItem = _asInt(
		_budgetOrCfg(body, "max_render_content_chars_per_item", config?.service?.limits?.max_render_content_chars_per_item || 2000),
		2000
	);

	const searchMode = _getSearchMode(body);
	const pickIds = _getPickIds(body);
	const fetchEngine = _getFetchEngine(body);
	const fetchCfg = _getFetchConfig();

	const maxFetchPages = _asInt(
		_budgetOrCfg(body, "max_fetch_pages", config?.service?.limits?.max_fetch_pages || 0),
		0
	);

	const maxDownloadBytesPerPage = _asInt(
		_budgetOrCfg(body, "max_download_bytes_per_page", config?.service?.limits?.max_download_bytes_per_page || 2000000),
		2000000
	);

	const maxExtractCharsPerPage = _asInt(
		_budgetOrCfg(body, "max_extract_chars_per_page", config?.service?.limits?.max_extract_chars_per_page || 300000),
		300000
	);

	const allowedContentTypes = Array.isArray(_budgetOrCfg(body, "allowed_content_types", config?.service?.limits?.allowed_content_types))
		? _budgetOrCfg(body, "allowed_content_types", config?.service?.limits?.allowed_content_types)
		: ["text/html", "application/xhtml+xml", "text/plain"];

	const maxRedirects = _asInt(
		_budgetOrCfg(body, "max_redirects", config?.service?.limits?.max_redirects || 5),
		5
	);

	const timeoutFetchMs = _asInt(
		_budgetTimeout(body, "fetch", config?.service?.timeouts_ms?.fetch || 8000),
		8000
	);

	const fetchHeaders = Object.assign({}, DEFAULT_FETCH_HEADERS, _getFetchHeaders(config));

	let items = [];
	let backendUsed = null;
	let note = null;
	let fallbackUsed = false;

	if (!query) {
		note = "Empty query";
	}
	else {
		let order = Array.isArray(config?.backends?.order)
			? config.backends.order
			: ["searxng", "duckduckgo"];

		const forced = _getBackendPolicy(body);
		if (forced) {
			const isEnabled = (b) => {
				if (b === "searxng") return !!config?.backends?.searxng?.enabled;
				if (b === "duckduckgo") return !!config?.backends?.duckduckgo?.enabled;
				return false;
			};

			if (forced === "duckduckgo") {
				if (isEnabled("duckduckgo")) {
					order = ["duckduckgo"];
				} else {
					note = "Requested backend 'duckduckgo' is disabled";
					order = [];
				}
			} else if (forced === "searxng") {
				if (isEnabled("searxng")) {
					order = ["searxng", ...order.filter(v => v !== "searxng")];
				} else {
					note = "Requested backend 'searxng' is disabled";
					// If the backend is unavailable, use the order from the config as a fallback.
				}
			} else {
				note = `Unknown backend: ${forced}`;
				// Do not break the order from the config.
			}
		}

		const ts = Date.now();

		for (let i = 0; i < order.length; i++) {
			const b = order[i];

			if (b === "searxng") {
				if (!config?.backends?.searxng?.enabled) continue;
				try {
					items = await searxngSearchSimple({
						baseUrl: config.backends.searxng.base_url,
						query,
						timeoutMs: timeoutSearchMs,
						limit: maxResults
					});

					backendUsed = "searxng";
					break;
				}
				catch (e) {
					note = e?.message || String(e);
					fallbackUsed = true;
					continue;
				}
			}

			if (b === "duckduckgo") {
				if (!config?.backends?.duckduckgo?.enabled) continue;

				try {
					items = await duckduckgoSearchSimple({
						query,
						timeoutMs: timeoutSearchMs,
						limit: maxResults
					});

					backendUsed = "duckduckgo";
					break;
				}
				catch (e) {
					note = e?.message || String(e);
					fallbackUsed = true;
					continue;
				}
			}
		}

		const searchMs = Date.now() - ts;

		if (items.length === 0 && !note) {
			if (backendUsed === "duckduckgo") {
				note = "DuckDuckGo returned no instant answers";
			}
			else if (backendUsed === "searxng") {
				note = "SearXNG returned no results";
			}
			else {
				note = "No results returned by backend";
			}
		}

		// ApPLY the snippet limit deterministically at the level of our items.
		for (let i = 0; i < items.length; i++) {
			const sn = (items[i].snippet || "").toString();
			if (maxSnippetChars && sn.length > maxSnippetChars) {
				items[i].snippet = sn.slice(0, maxSnippetChars);
			}
		}

		// Apply pick_ids after obtaining the full list.
		const picked = _applyPick(items, pickIds);
		items = picked.items;
		const pickApplied = picked.pickApplied;

		let fetchMs = 0;
		let fetchPagesUsed = 0;
		let cacheHits = 0;
		let cacheMisses = 0;
		let cacheWrites = 0;

		if (searchMode === "full" && maxFetchPages > 0 && items.length > 0) {
			const tf = Date.now();

			for (let i = 0; i < items.length; i++) {
				if (fetchPagesUsed >= maxFetchPages) {
					items[i].fetch = { status: "skipped", skip_reason: "budget" };
					continue;
				}

				const url = (items[i].url || "").toString();
				if (!url) {
					items[i].fetch = { status: "failed", skip_reason: "error" };
					continue;
				}

				// Cache lookup (V1): key is based on the original URL (normalized) and extractor engine.
				try {
					const hit = await cache.get({
						engine: fetchEngine,
						url
					});
					if (hit && typeof hit.text === "string" && hit.text) {
						cacheHits += 1;
						items[i].fetch = {
							status: "fetched",
							skip_reason: "",
							content_type: "cache",
							downloaded_bytes: 0,
							truncated: false,
							extracted_chars: hit.text.length,
							final_url: url,
							redirects: 0,
							text: hit.text
						};
						fetchPagesUsed += 1;
						try {
							fastify.log.info({ url, engine: fetchEngine }, "cache hit");
						}
						catch {/**/}
						continue;
					}
					cacheMisses += 1;
				}
				catch {/**/}

				const fx = await fetchAndExtract({
					url,
					proxySocksUrl: (fetchCfg?.proxy?.socks_url || "").toString().trim() || "",
					engine: fetchEngine,
					jinaBaseUrl: (fetchCfg?.jina?.base_url || "").toString().trim() || "https://r.jina.ai/",
					jinaApiKey: (fetchCfg?.jina?.api_key || "").toString().trim() || "",
					headers: fetchHeaders,
					allowedContentTypes,
					maxBytes: maxDownloadBytesPerPage,
					maxExtractChars: maxExtractCharsPerPage,
					timeoutMs: timeoutFetchMs,
					maxRedirects
				});

				items[i].fetch = {
					status: fx.status,
					skip_reason: fx.skip_reason || "",
					content_type: fx.content_type || "",
					downloaded_bytes: fx.downloaded_bytes || 0,
					truncated: !!fx.truncated,
					extracted_chars: fx.extracted_chars || 0,
					final_url: fx.final_url || url,
					redirects: fx.redirects || 0,
					text: fx.text || ""
				};

				if (fx.status === "fetched") {
					fetchPagesUsed += 1;
					// Cache store (V1): only successful non-empty extractions are cached.
					try {
						if ((fx.text || "").toString().trim()) {
							await cache.put({
								engine: fetchEngine,
								url,
								finalUrl: fx.final_url || url,
								title: (items[i].title || "").toString(),
								text: (fx.text || "").toString()
							});
							cacheWrites += 1;
							try {
								fastify.log.info({ url, engine: fetchEngine }, "cache write");
							}
							catch {/**/}
						}
					}
					catch {/**/}
				}

			}

			fetchMs = Date.now() - tf;
		} else {
			// In simple mode, explicitly mark that fetch was skipped.
			for (let i = 0; i < items.length; i++) {
				if (!items[i].fetch) items[i].fetch = { status: "skipped" };
			}
		}

		const renderedText = (wantRendered && items.length > 0)
			? renderContextPack({
				items,
				maxContextChars,
				maxSnippetChars,
				maxContentCharsPerItem
			})
			: (wantRendered ? renderContextPack({ items: [], maxContextChars, maxSnippetChars, maxContentCharsPerItem }) : null);

		const totalMs = Date.now() - t0;

		const response = buildUcpResponse({
			request: body,
			items: wantItems ? items : [],
			backendUsed,
			fallbackUsed,
			modeUsed: searchMode,
			pickApplied,
			pickIds,
			renderedText: wantRendered ? renderedText : null,
			timingMs: {
				search: searchMs,
				fetch: fetchMs,
				total: totalMs
			},
			note
		});

		if (searchMode === "full") {
			let n = 0;
			for (const it of items) {
				if (it?.fetch?.status === "fetched") n += 1;
			}
			response.usage.fetch_pages_used = n;
			response.usage.cache_hits = cacheHits;
			response.usage.cache_misses = cacheMisses;
			response.usage.cache_writes = cacheWrites;
		}

		return response;
	}

	// No query
	const response = buildUcpResponse({
		request: body,
		items: [],
		backendUsed,
		fallbackUsed,
		modeUsed: "simple",
		pickApplied: false,
		pickIds: [],
		renderedText: wantRendered ? renderContextPack({ items: [], maxContextChars, maxSnippetChars, maxContentCharsPerItem }) : null,
		timingMs: { search: 0, fetch: 0, total: Date.now() - t0 },
		note
	});

	return response;
});

const { host, port } = config.service.listen.tcp;

try {
	await fastify.listen({ host, port });
	console.log(`Search service listening on ${host}:${port}`);
}
catch (err) {
	fastify.log.error(err);
	process.exit(1);
}

//<EOF app.mjs lines: 525>
