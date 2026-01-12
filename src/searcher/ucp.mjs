export function buildUcpResponse({
	request,
	items = [],
	backendUsed = null,
	fallbackUsed = false,
	modeUsed = "simple",
	pickApplied = false,
	pickIds = [],
	renderedText = null,
	timingMs = { search: 0, fetch: 0, total: 0 },
	note = null
}) {
	const now = new Date().toISOString();

	const response = {
		schema: "ucp-1",
		created_utc: now,
		producer: {
			name: "searcher-service",
			version: "0.1.1"
		},
		request,
		meta: {
			backend_used: backendUsed,
			fallback_used: !!fallbackUsed,
			pick_applied: !!pickApplied,
			pick_ids: Array.isArray(pickIds) ? pickIds : [],
			mode_used: modeUsed,
			timing_ms: timingMs
		},
		usage: {
			results_returned: items.length,
			context_chars: renderedText ? renderedText.length : 0,
			fetch_pages_used: 0
		},
		items
	};

	if (note) {
		response.meta.note = note;
	}

	if (renderedText !== null) {
		response.rendered_text = renderedText;
	}

	return response;
}


//<EOF ucp.mjs lines: 51>
