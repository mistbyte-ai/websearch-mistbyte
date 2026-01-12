import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

let _fetchSocks = null;

async function _loadFetchSocks() {
	if (_fetchSocks !== null) return _fetchSocks;
	try {
		// Lazy-load optional dependency.
		// npm i fetch-socks
		_fetchSocks = await import("fetch-socks");
		return _fetchSocks;
	}
	catch {/**/}
	_fetchSocks = false;
	return _fetchSocks;
}

function _parseSocksProxyUrl(proxyUrl) {
	try {
		const u = new URL((proxyUrl || "").toString().trim());
		const proto = (u.protocol || "").toLowerCase();
		if (proto !== "socks5:" && proto !== "socks5h:" && proto !== "socks4:" && proto !== "socks4a:") return null;

		let type = 5;
		if (proto === "socks4:" || proto === "socks4a:") type = 4;

		const host = (u.hostname || "").toString().trim();
		const port = parseInt((u.port || "").toString(), 10);
		if (!host || !Number.isFinite(port) || port <= 0) return null;

		const userId = (u.username || "").toString();
		const password = (u.password || "").toString();

		const out = { type, host, port };
		if (userId) out.userId = userId;
		if (password) out.password = password;
		return out;
	}
	catch {/**/}
	return null;
}

async function _buildDispatcher(proxySocksUrl) {
	const psu = (proxySocksUrl || "").toString().trim();
	if (!psu) return null;

	const cfg = _parseSocksProxyUrl(psu);
	if (!cfg) return null;

	const mod = await _loadFetchSocks();
	if (!mod || mod === false) return { error: "missing_fetch_socks" };

	try {
		const dispatcher = mod.socksDispatcher(cfg);
		return dispatcher || null;
	}
	catch {/**/}
	return { error: "proxy_init_failed" };
}


function _buildJinaReaderUrl(baseUrl, targetUrl) {
	const b = (baseUrl || "https://r.jina.ai/").toString().trim();
	const bb = b.endsWith("/") ? b : (b + "/");
	return bb + targetUrl;
}

async function _fetchViaJina(url, { timeoutMs, jinaBaseUrl, jinaApiKey, headers, dispatcher }) {
	const out = {
		ok: false,
		status: 0,
		text: "",
		error: null,
	};

	const u = _buildJinaReaderUrl(jinaBaseUrl, url);
	const h = new Headers(headers || {});
	// Optional API key for higher rate limits (Jina Reader supports Authorization: Bearer <token>).
	if (jinaApiKey) {
		h.set("Authorization", "Bearer " + jinaApiKey);
	}

	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), Math.max(1, timeoutMs || 8000));
	try {
		const resp = await fetch(u, { method: "GET", headers: h, signal: ac.signal, dispatcher: dispatcher || undefined });
		out.status = resp.status;
		out.text = await resp.text();
		out.ok = resp.ok;
		return out;
	}
	catch (e) {
		out.error = (e?.name === "AbortError") ? "timeout" : "error";
		return out;
	}
	finally {
		clearTimeout(t);
	}
}

function _normContentType(ct) {
	const s = (ct || "").toString().toLowerCase();
	if (!s) return "";
	return s.split(";")[0].trim();
}

function _isAllowedType(ct, allow) {
	const t = _normContentType(ct);
	if (!t) return false;
	if (!Array.isArray(allow) || allow.length === 0) return false;
	for (const a of allow) {
		if (_normContentType(a) === t) return true;
	}
	return false;
}

function _extractReadable(html, baseUrl) {
	try {
		const dom = new JSDOM((html || "").toString(), { url: baseUrl || "https://local/" });
		const reader = new Readability(dom.window.document);
		const out = reader.parse();
		const text = (out?.textContent || "").toString().trim();
		return text || null;
	}
	catch {/**/}
	return null;
}

function _stripHtml(html) {
	// Simple deterministic text extraction without external dependencies.
	let s = (html || "").toString();

	// Remove <script>/<style>
	s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
	s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

	// Replace <br>/<p>/<li> with line breaks.
	s = s.replace(/<\s*br\s*\/?>/gi, "\n");
	s = s.replace(/<\s*\/p\s*>/gi, "\n");
	s = s.replace(/<\s*\/li\s*>/gi, "\n");
	s = s.replace(/<\s*p\b[^>]*>/gi, "");
	s = s.replace(/<\s*li\b[^>]*>/gi, "- ");

	// Remove all tags
	s = s.replace(/<[^>]+>/g, " ");

	// Minimal entity decoding.
	s = s.replace(/&nbsp;/gi, " ");
	s = s.replace(/&amp;/gi, "&");
	s = s.replace(/&lt;/gi, "<");
	s = s.replace(/&gt;/gi, ">");
	s = s.replace(/&quot;/gi, "\"");
	s = s.replace(/&#39;/gi, "'");

	// Space normalize
	s = s.replace(/\r/g, "\n");
	s = s.replace(/[ \t\f\v]+/g, " ");
	s = s.replace(/\n\s+\n/g, "\n\n");

	return s.trim();
}

async function _readLimitedBody(resp, maxBytes, timeoutMs) {
	const deadline = (timeoutMs && timeoutMs > 0) ? (Date.now() + timeoutMs) : null;

	function _mkTimeoutPromise() {
		if (!deadline) return null;
		const ms = Math.max(0, deadline - Date.now());
		return new Promise((_, reject) => {
			setTimeout(() => {
				const e = new Error("timeout");
				e.name = "AbortError";
				reject(e);
			}, ms);
		});
	}

	const reader = resp.body?.getReader?.();
	if (!reader) {
		const tp = _mkTimeoutPromise();
		const ab = tp ? await Promise.race([resp.arrayBuffer(), tp]) : await resp.arrayBuffer();
		const buf = Buffer.from(ab);
		const truncated = maxBytes > 0 && buf.length > maxBytes;
		const out = truncated ? buf.subarray(0, maxBytes) : buf;
		return { buf: out, downloadedBytes: out.length, truncated };
	}

	let downloaded = 0;
	let chunks = [];
	let truncated = false;

	try {
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const tp = _mkTimeoutPromise();
			const r = tp ? await Promise.race([reader.read(), tp]) : await reader.read();
			const { done, value } = r;
			if (done) break;
			if (!value) continue;

			downloaded += value.length;
			if (maxBytes && maxBytes > 0 && downloaded > maxBytes) {
				truncated = true;
				const keep = value.subarray(0, value.length - (downloaded - maxBytes));
				if (keep.length > 0) chunks.push(Buffer.from(keep));
				break;
			}
			chunks.push(Buffer.from(value));
		}
	}
	finally {
		try { reader.releaseLock(); } catch {/**/}
		try { await resp.body?.cancel?.(); } catch {/**/}
	}

	const buf = Buffer.concat(chunks);
	return { buf, downloadedBytes: buf.length, truncated };
}

async function _fetchWithRedirects(url, opts) {
	const maxRedirects = opts.maxRedirects ?? 5;
	let cur = url;
	let redirects = 0;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const ac = new AbortController();
		const to = opts.timeoutMs && opts.timeoutMs > 0
			? setTimeout(() => ac.abort(), opts.timeoutMs)
			: null;

		let resp;
		try {
			const headers = {};
			if (opts?.headers && typeof opts.headers === "object") {
				for (const k of Object.keys(opts.headers)) {
					const v = (opts.headers[k] || "").toString().trim();
					if (!v) continue;
					headers[k] = v;
				}
			}

			resp = await fetch(cur, {
				method: "GET",
				redirect: "manual",
				headers,
				signal: ac.signal,
				dispatcher: opts.dispatcher || undefined,
			});
		}
		finally {
			if (to) clearTimeout(to);
		}

		if (resp.status >= 300 && resp.status < 400) {
			const loc = resp.headers.get("location");
			if (!loc) {
				return { resp, finalUrl: cur, redirects };
			}
			if (redirects >= maxRedirects) {
				return { resp, finalUrl: cur, redirects, redirectError: "max_redirects" };
			}
			redirects += 1;
			cur = new URL(loc, cur).toString();
			continue;
		}

		return { resp, finalUrl: cur, redirects };
	}
}

export async function fetchAndExtract({ url, headers, allowedContentTypes, maxBytes, maxExtractChars, timeoutMs, maxRedirects }) {
	const out = {
		status: "failed",
		skip_reason: "error",
		content_type: "",
		final_url: url,
		redirects: 0,
		downloaded_bytes: 0,
		truncated: false,
		extracted_chars: 0,
		text: "",
	};

	try {
		const dispatcher = await _buildDispatcher(arguments?.[0]?.proxySocksUrl);
		if (dispatcher && dispatcher?.error) {
			out.status = "failed";
			out.skip_reason = dispatcher.error;
			return out;
		}

		// Optional alternate extractor engine: Jina Reader (https://r.jina.ai/<URL>).
		// Backwards compatible: existing callers can ignore these optional fields.
		const engine = (arguments?.[0]?.engine || "local").toString().toLowerCase();
		if (engine === "jina") {
			const jr = await _fetchViaJina(url, {
				timeoutMs,
				jinaBaseUrl: arguments?.[0]?.jinaBaseUrl,
				jinaApiKey: arguments?.[0]?.jinaApiKey,
				headers,
				dispatcher
			});
			if (!jr.ok) {
				out.status = "failed";
				out.skip_reason = jr.error || "http_" + (jr.status || 0);
				return out;
			}
			let text = jr.text || "";
			if (maxExtractChars && maxExtractChars > 0 && text.length > maxExtractChars) text = text.slice(0, maxExtractChars);
			out.status = "fetched";
			out.skip_reason = "";
			out.content_type = "text/plain";
			out.downloaded_bytes = (jr.text || "").length;
			out.truncated = false;
			out.text = text;
			out.extracted_chars = text.length;
			return out;
		}

		const { resp, finalUrl, redirects, redirectError } = await _fetchWithRedirects(url, { timeoutMs, maxRedirects, headers, dispatcher });
		out.final_url = finalUrl;
		out.redirects = redirects;

		if (redirectError) {
			out.status = "failed";
			out.skip_reason = redirectError;
			return out;
		}

		out.content_type = _normContentType(resp.headers.get("content-type") || "");

		if (!_isAllowedType(out.content_type, allowedContentTypes)) {
			out.status = "skipped";
			out.skip_reason = "content_type";
			return out;
		}

		const cl = resp.headers.get("content-length");
		if (maxBytes && maxBytes > 0 && cl) {
			const n = parseInt(cl, 10);
			if (Number.isFinite(n) && n > maxBytes) {
				out.status = "skipped";
				out.skip_reason = "too_large";
				return out;
			}
		}

		const { buf, downloadedBytes, truncated } = await _readLimitedBody(resp, maxBytes, timeoutMs);
		out.downloaded_bytes = downloadedBytes;
		out.truncated = truncated;

		const raw = buf.toString("utf8");

		let text;
		if (out.content_type === "text/plain") {
			text = raw;
		} else {
			// Prefer Mozilla Readability to reduce navigation/menu noise.
			// Falls back to a deterministic tag-stripper if readability returns nothing.
			const rd = _extractReadable(raw, out.final_url || url);
			text = rd ? rd : _stripHtml(raw);
		}

		if (maxExtractChars && maxExtractChars > 0 && text.length > maxExtractChars) {
			text = text.slice(0, maxExtractChars);
		}

		out.text = text;
		out.extracted_chars = text.length;
		out.status = "fetched";
		out.skip_reason = "";
		return out;
	}
	catch (e) {
		const msg = (e?.name === "AbortError") ? "timeout" : "error";
		out.status = "failed";
		out.skip_reason = msg;
		return out;
	}
}

//<EOF fetch.mjs lines: 384>
