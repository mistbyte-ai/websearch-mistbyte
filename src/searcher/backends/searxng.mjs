import { URL } from "url";

function normalizeBaseUrl(baseUrl) {
	if (!baseUrl) throw new Error("SearXNG base_url is empty");
	return baseUrl.replace(/\/+$/, "");
}

export async function searxngSearchSimple({ baseUrl, query, timeoutMs, limit }) {
	const b = normalizeBaseUrl(baseUrl);

	const u = new URL(b + "/search");
	u.searchParams.set("q", query);
	u.searchParams.set("format", "json");

	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), Math.max(1, timeoutMs || 6000));

	let json;
	try {
		const res = await fetch(u.toString(), {
			method: "GET",
			signal: ac.signal,
			headers: {
				"accept": "application/json"
			}
		});

		if (!res.ok) {
			throw new Error(`SearXNG HTTP ${res.status}`);
		}

		json = await res.json();
	}
	catch (e) {
		throw new Error(`SearXNG request failed: ${e?.message || String(e)}`);
	}
	finally {
		clearTimeout(t);
	}

	const results = Array.isArray(json?.results) ? json.results : [];
	const sliced = results.slice(0, Math.max(0, limit || 10));

	return sliced.map((r, idx) => {
		const title = (r?.title || "").toString();
		const url = (r?.url || "").toString();
		const snippet = (r?.content || r?.snippet || "").toString();

		let domain = "";
		try {
			domain = url ? (new URL(url)).hostname : "";
		} catch (e) {
			domain = "";
		}

		let engines = [];
		if (Array.isArray(r?.engines)) {
			engines = r.engines.map(v => (v || "").toString()).filter(Boolean);
		} else if (typeof r?.engine === "string") {
			engines = [r.engine];
		} else if (typeof r?.engines === "string") {
			engines = [r.engines];
		}

		return {
			type: "web_result",
			rank: idx + 1,
			title,
			url,
			domain,
			engines,
			snippet,
			source: "searxng"
		};
	});
}

//<EOF searxng.mjs lines: 78>
