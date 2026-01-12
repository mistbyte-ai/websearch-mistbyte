import { URL } from "url";

function safeHostname(u) {
	// Возвращает hostname или пустую строку, без исключений.
	try {
		if (!u) return "";
		return (new URL(u)).hostname || "";
	}
	catch (e) {
		return "";
	}
}

export async function duckduckgoSearchSimple({ query, timeoutMs, limit }) {
	const u = new URL("https://api.duckduckgo.com/");
	u.searchParams.set("q", query);
	u.searchParams.set("format", "json");
	u.searchParams.set("no_html", "1");
	u.searchParams.set("skip_disambig", "1");

	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), Math.max(1, timeoutMs || 6000));
	console.log("duckduckgo req: %o", u.toString());

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
			throw new Error(`DuckDuckGo HTTP ${res.status}`);
		}

		json = await res.json();
		console.log("duckduckgo: %o",json);
	}
	catch (e) {
		throw new Error(`DuckDuckGo request failed: ${e?.message || String(e)}`);
	}
	finally {
		clearTimeout(t);
	}

	const results = [];

	// 1) Instant answer / abstract / definition (если есть)
	const answer = (json?.Answer || "").toString().trim();
	const abstractText = (json?.AbstractText || "").toString().trim();
	const definition = (json?.Definition || "").toString().trim();
	const heading = (json?.Heading || "").toString().trim();
	const abstractUrl = (json?.AbstractURL || "").toString().trim();
	const answerType = (json?.AnswerType || "").toString().trim();

	let instantSnippet = "";
	if (answer) {
		instantSnippet = answer;
	}
	else if (abstractText) {
		instantSnippet = abstractText;
	}
	else if (definition) {
		instantSnippet = definition;
	}

	if (instantSnippet) {
		results.push({
			type: "web_result",
			rank: 1,
			title: heading || "DuckDuckGo Instant Answer",
			url: abstractUrl,
			domain: safeHostname(abstractUrl),
			engines: answerType ? ["duckduckgo:" + answerType] : ["duckduckgo"],
			snippet: instantSnippet,
			source: "duckduckgo"
		});
	}

	// 2) RelatedTopics (плоско, без рекурсии)
	if (Array.isArray(json.RelatedTopics)) {
		for (const r of json.RelatedTopics) {
			if (!r?.Text || !r?.FirstURL) continue;

			results.push({
				type: "web_result",
				rank: results.length + 1,
				title: r.Text.split(" - ")[0],
				url: r.FirstURL,
				domain: safeHostname(r.FirstURL),
				engines: ["duckduckgo"],
				snippet: r.Text,
				source: "duckduckgo"
			});

			if (limit && results.length >= limit) break;
		}
	}

	return results.slice(0, Math.max(0, limit || 10));
}

//<EOF duckduckgo.mjs lines: 106>
