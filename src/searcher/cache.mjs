import fs from "fs";
import path from "path";
import crypto from "crypto";
import { URL } from "url";

function _asBool(v, dflt) {
	if (v === true) return true;
	if (v === false) return false;
	return dflt;
}

function _asInt(v, dflt) {
	try {
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : dflt;
	}
	catch {/**/}
	return dflt;
}

function _stripTrailingSlash(p) {
	const s = (p || "").toString();
	if (!s) return "/";
	if (s === "/") return "/";
	if (s.endsWith("/")) return s.replace(/\/+$/g, "");
	return s;
}

export function normalizeUrl(rawUrl) {
	try {
		const u = new URL((rawUrl || "").toString().trim());
		u.protocol = (u.protocol || "").toLowerCase();
		u.hostname = (u.hostname || "").toLowerCase();
		u.hash = "";

		// Remove common tracking parameters.
		const dropKeys = new Set([
			"gclid",
			"fbclid",
			"mc_cid",
			"mc_eid",
		]);

		const pairs = [];
		for (const [k, v] of u.searchParams.entries()) {
			const kk = (k || "").toString();
			const lk = kk.toLowerCase();
			if (lk.startsWith("utm_")) continue;
			if (lk.startsWith("mc_")) continue;
			if (dropKeys.has(lk)) continue;
			pairs.push([kk, (v || "").toString()]);
		}

		pairs.sort((a, b) => {
			const ka = a[0].toLowerCase();
			const kb = b[0].toLowerCase();
			if (ka < kb) return -1;
			if (ka > kb) return 1;
			if (a[1] < b[1]) return -1;
			if (a[1] > b[1]) return 1;
			return 0;
		});

		u.search = "";
		for (const [k, v] of pairs) {
			u.searchParams.append(k, v);
		}

		u.pathname = _stripTrailingSlash(u.pathname || "/");
		return u.toString();
	}
	catch {/**/}
	return "";
}

function _hashKey(s) {
	return crypto.createHash("sha1").update((s || "").toString()).digest("hex");
}

function _ensureDir(dirPath) {
	try {
		fs.mkdirSync(dirPath, { recursive: true });
		return true;
	}
	catch {/**/}
	return false;
}

function _nowMs() {
	try { return Date.now(); } catch {/**/}
	return 0;
}

export function createWebCache(cfg) {
	const enabled = _asBool(cfg?.enabled, false);
	const ttlS = _asInt(cfg?.ttl_s, 86400);
	const sweepIntervalS = _asInt(cfg?.sweep_interval_s, 1800);

	const baseDirRaw = (cfg?.dir || ".cache/websearch").toString();
	const baseDir = path.resolve(process.cwd(), baseDirRaw);

	let lastSweepMs = 0;

	function _filePathFor(engine, normalizedUrl) {
		const k = (engine || "local").toString().toLowerCase() + ":" + normalizedUrl;
		const h = _hashKey(k);
		return path.join(baseDir, h + ".json");
	}

	function _isExpiredMtimeMs(mtimeMs) {
		if (!ttlS || ttlS <= 0) return false;
		const ageMs = _nowMs() - (mtimeMs || 0);
		return ageMs > (ttlS * 1000);
	}

	async function maybeSweep() {
		if (!sweepIntervalS || sweepIntervalS <= 0) return;
		const now = _nowMs();
		if (lastSweepMs && (now - lastSweepMs) < (sweepIntervalS * 1000)) return;
		lastSweepMs = now;
		await sweepExpired();
	}

	async function sweepExpired() {
		// V1: fast TTL cleanup based on file mtime. No JSON parsing needed.
		if (!_ensureDir(baseDir)) return 0;

		let removed = 0;
		let entries = [];
		try {
			entries = fs.readdirSync(baseDir, { withFileTypes: true });
		}
		catch {/**/}

		for (const de of entries) {
			if (!de || !de.isFile()) continue;
			const name = (de.name || "").toString();
			if (!name.endsWith(".json")) continue;

			const fp = path.join(baseDir, name);
			let st;
			try {
				st = fs.statSync(fp);
			}
			catch {/**/}
			if (!st) continue;

			if (_isExpiredMtimeMs(st.mtimeMs)) {
				try {
					fs.unlinkSync(fp);
					removed += 1;
				}
				catch {/**/}
			}
		}

		return removed;
	}

	async function get({ engine, url }) {
		await maybeSweep();
		if (!enabled) return null;
		if (!url) return null;

		const normalized = normalizeUrl(url);
		if (!normalized) return null;
		if (!_ensureDir(baseDir)) return null;

		const fp = _filePathFor(engine, normalized);

		let st;
		try {
			st = fs.statSync(fp);
		}
		catch {/**/}
		if (!st) return null;

		if (_isExpiredMtimeMs(st.mtimeMs)) {
			try { fs.unlinkSync(fp); } catch {/**/}
			return null;
		}

		let raw;
		try {
			raw = fs.readFileSync(fp, "utf8");
		}
		catch {/**/}
		if (!raw) return null;

		let obj;
		try {
			obj = JSON.parse(raw);
		}
		catch {/**/}
		if (!obj || typeof obj !== "object") return null;

		const text = (obj.extracted_text || "").toString();
		if (!text) return null;

		return { text };
	}

	async function put({ engine, url, finalUrl, title, text }) {
		await maybeSweep();
		if (!enabled) return false;

		const normalized = normalizeUrl(url);
		if (!normalized) return false;
		if (!_ensureDir(baseDir)) return false;

		const fp = _filePathFor(engine, normalized);
		const tmp = fp + ".tmp";

		const payload = {
			v: 1,
			engine: (engine || "local").toString().toLowerCase(),
			normalized_url: normalized,
			source_url: (url || "").toString(),
			final_url: (finalUrl || "").toString(),
			title: (title || "").toString(),
			extracted_text: (text || "").toString(),
			created_utc: new Date().toISOString()
		};

		try {
			fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
			fs.renameSync(tmp, fp);
			return true;
		}
		catch {/**/}
		try { fs.unlinkSync(tmp); } catch {/**/}
		return false;
	}

	async function clearAll() {
		if (!_ensureDir(baseDir)) return 0;

		let removed = 0;
		let entries = [];
		try {
			entries = fs.readdirSync(baseDir, { withFileTypes: true });
		}
		catch {/**/}

		for (const de of entries) {
			if (!de || !de.isFile()) continue;
			const name = (de.name || "").toString();
			if (!name.endsWith(".json")) continue;

			const fp = path.join(baseDir, name);
			try {
				fs.unlinkSync(fp);
				removed += 1;
			}
			catch {/**/}
		}

		return removed;
	}

	return {
		enabled,
		dir: baseDir,
		ttl_s: ttlS,
		sweep_interval_s: sweepIntervalS,
		get,
		put,
		clearAll,
		sweepExpired
	};
}

//<EOF cache.mjs lines: 273>
