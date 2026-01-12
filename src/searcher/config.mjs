import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const DEFAULT_CONFIG_PATH = path.resolve(
	process.cwd(),
	"config",
	"searcher.yaml"
);

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
	if (!fs.existsSync(configPath)) {
		throw new Error(
			`Config file not found: ${configPath}\n` +
			`Copy config/searcher.example.yaml to config/searcher.yaml`
		);
	}

	const raw = fs.readFileSync(configPath, "utf8");
	const cfg = yaml.load(raw);

	if (!cfg?.service?.listen?.tcp) {
		throw new Error("Invalid config: service.listen.tcp is required");
	}

	// Normalize and override cache dir (V1):
	// - If WEBSEARCH_CACHE_DIR is provided (e.g. by systemd unit), it wins.
	// - If cache.dir is relative, resolve it against CWD (WorkingDirectory).
	const envCacheDir = (process.env.WEBSEARCH_CACHE_DIR || "").toString().trim();
	if (!cfg.service) cfg.service = {};
	if (!cfg.service.cache) cfg.service.cache = {};

	if (envCacheDir) {
		cfg.service.cache.dir = envCacheDir;
	}

	if (typeof cfg.service.cache.dir === "string" && cfg.service.cache.dir.trim()) {
		const d = cfg.service.cache.dir.trim();
		cfg.service.cache.dir = path.isAbsolute(d) ? d : path.resolve(process.cwd(), d);
	}

	return cfg;
}

//<EOF config.mjs lines: 45>
