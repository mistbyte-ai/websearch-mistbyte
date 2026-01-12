function trimSnippet(s, maxChars) {
	const t = (s || "").toString();
	if (!maxChars || maxChars <= 0) return t;
	if (t.length <= maxChars) return t;
	return t.slice(0, maxChars);
}

export function renderContextPack({ items, maxContextChars, maxSnippetChars, maxContentCharsPerItem }) {
	const out = [];
	out.push("[CONTEXT_PACK ucp-1]");
	out.push("type: web_search_results");

	if (!items || items.length === 0) {
		out.push("status: empty");
		out.push("");
		out.push("(no results returned by backend)");
		out.push("");
		out.push("[/CONTEXT_PACK]");
		return out.join("\n");
	}

	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		out.push("");
		out.push(`#${it.rank} ${it.title}`);
		const eng = Array.isArray(it.engines) && it.engines.length > 0
			? it.engines.join(",")
			: "";

		const dom = (it.domain || "").toString();

		if (eng || dom) {
			out.push(`[${eng || "-"} | ${dom || "-"}]`);
		}

		out.push(it.url);

		const sn = trimSnippet(it.snippet, maxSnippetChars);
		if (sn) out.push(sn);

		const ft = (it?.fetch?.text || "").toString();
		if (ft && (it?.fetch?.status === "fetched")) {
			let c = ft;
			const lim = maxContentCharsPerItem ? parseInt(maxContentCharsPerItem, 10) : 0;
			if (lim && lim > 0 && c.length > lim) c = c.slice(0, lim);
			out.push("");
			out.push("CONTENT:");
			out.push(c);
		}
	}

	out.push("");
	out.push("[/CONTEXT_PACK]");

	let txt = out.join("\n");

	if (maxContextChars && maxContextChars > 0 && txt.length > maxContextChars) {
		// Детерминированная обрезка: сначала удаляем хвостовые элементы целиком.
		const lines = txt.split("\n");
		while (lines.join("\n").length > maxContextChars && lines.length > 10) {
			// Удаляем по одному блоку снизу до пустой строки перед [/CONTEXT_PACK]
			// (простая и стабильная стратегия)
			const endTagIdx = lines.lastIndexOf("[/CONTEXT_PACK]");
			if (endTagIdx <= 0) break;

			// Ищем начало последнего блока (пустая строка перед "#")
			let cutFrom = -1;
			for (let j = endTagIdx - 1; j >= 0; j--) {
				if (lines[j].startsWith("#")) {
					// идём вверх до пустой строки или начала
					cutFrom = j;
					while (cutFrom > 0 && lines[cutFrom - 1] !== "") cutFrom--;
					if (cutFrom > 0 && lines[cutFrom - 1] === "") cutFrom--;
					break;
				}
			}

			if (cutFrom < 0) break;

			lines.splice(cutFrom, endTagIdx - cutFrom);
		}

		txt = lines.join("\n");

		// Если всё ещё не влезло — режем хвост строки (последний шанс, детерминированно).
		if (txt.length > maxContextChars) {
			txt = txt.slice(0, maxContextChars);
		}
	}

	return txt;
}

//<EOF render.mjs lines: 94>
