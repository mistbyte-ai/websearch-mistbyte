#!/usr/bin/env bash
set -euo pipefail

# WebSearch Mistbyte installer (Search API V1)
# - Auto-detects USER vs SYSTEM install based on sudo
# - Installs/updates services: SearXNG (podman) + websearch searcher (node)
# - Preserves existing configs; writes *.new for updated examples

_die() {
	echo "ERROR: $*" 1>&2
	exit 1
}

_info() {
	echo "[install] $*"
}

_hint_install_rsync() {
	if _have dnf; then
		echo "Hint: sudo dnf install -y rsync"
	elif _have apt-get; then
		echo "Hint: sudo apt-get update && sudo apt-get install -y rsync"
	elif _have pacman; then
		echo "Hint: sudo pacman -S --needed rsync"
	elif _have zypper; then
		echo "Hint: sudo zypper install -y rsync"
	elif _have apk; then
		echo "Hint: sudo apk add rsync"
	elif _have brew; then
		echo "Hint: brew install rsync"
	else
		echo "Hint: install 'rsync' via your package manager."
	fi
}

_ask_yn() {
	local prompt="$1"
	local ans=""
	read -r -p "$prompt" ans || true
	case "${ans,,}" in
		y|yes) return 0;;
		*) return 1;;
	esac
}

_warn() { echo "[install] WARN: $*" >&2; }

_have() {
	command -v "$1" >/dev/null 2>&1
}

_abs_dir_of_this_script() {
	local src="${BASH_SOURCE[0]}"
	while [ -L "$src" ]; do
		src="$(readlink "$src")"
	done
	cd "$(dirname "$src")" && pwd
}

_rand_hex_64() {
	python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
}

_podman_pull_searxng_or_warn() {
	# Prevent systemd restart loops on first start if Docker Hub is unreachable.
	# We try to pull the image once during install. If it fails, we skip enabling
	# searxng.service and print actionable diagnostics.
	if ! _have podman; then
		_warn "podman not found. SearXNG install will be skipped."
		return 1
	fi

	local img="${SEARXNG_IMAGE:-docker.io/searxng/searxng:latest}"

	_info "Pulling SearXNG image: $img"
	if podman pull "$img"; then
		return 0
	fi

	_warn "Failed to pull SearXNG image from Docker Hub."
	_warn "SearXNG service will NOT be enabled to avoid restart loops."

	if _have curl; then
		_info "Quick connectivity checks:"
		# IPv4 should normally return 401 (OK). IPv6 often fails on partially-broken networks.
		(curl -4 -I --max-time 8 https://registry-1.docker.io/v2/ >/dev/null 2>&1 && _info "  IPv4: OK") || _warn "  IPv4: failed"
		(curl -6 -I --max-time 8 https://registry-1.docker.io/v2/ >/dev/null 2>&1 && _info "  IPv6: OK") || _warn "  IPv6: failed (common cause of TLS handshake timeouts)"
		_warn "If IPv4 is OK but IPv6 fails, consider preferring IPv4 by editing /etc/gai.conf:"
		_warn "  precedence ::ffff:0:0/96  100"
	fi

	_warn "You can retry later with:"
	_warn "  podman pull $img"
	return 1
}

_ensure_user_systemd_bus() {
	# When running headless (no GUI / no PAM session), systemctl --user may fail because
	# XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS are not set.
	# If /run/user/<uid> exists, we can wire the env vars automatically.
	# If it doesn't exist, user instance is not running → suggest loginctl enable-linger.
	if [ "${MODE}" != "user" ]; then
		return 0
	fi

	if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
		return 0
	fi

	local uid=""
	local rt=""
	uid="$(id -u)"

	# Prefer querying systemd-logind for the correct runtime path (more portable).
	if _have loginctl; then
		rt="$(loginctl show-user "$uid" --property=RuntimePath --value 2>/dev/null || true)"
		if [ -n "$rt" ] && [ -d "$rt" ]; then
			export XDG_RUNTIME_DIR="$rt"
			export DBUS_SESSION_BUS_ADDRESS="unix:path=$rt/bus"
			return 0
		fi
	fi

	rt="/run/user/$uid"

	if [ -d "$rt" ]; then
		export XDG_RUNTIME_DIR="$rt"
		export DBUS_SESSION_BUS_ADDRESS="unix:path=$rt/bus"
		return 0
	fi

	_info "WARN: systemctl --user needs a user systemd session bus, but it is not available."
	_info "      This is common for headless service users (no GUI/login session)."
	echo
	echo "Fix options (pick one):"
	echo "  1) Enable linger for this user (recommended for headless services):"
	echo "     sudo loginctl enable-linger $USER"
	echo "     Then re-run this installer."
	echo
	echo "  2) Run a real login session for this user (ssh/login), then re-run."
	echo
	echo "  3) Use SYSTEM install (sudo ./install.sh) to manage services via the system bus."
	echo
	_die "No user systemd bus available."
}


MODE=""
WEBUI_DIR=""
NO_WEBUI=0
SYSTEM_TARGET_USER=""

while [ $# -gt 0 ]; do
	case "$1" in
		--user)
			MODE="user"
			shift
			;;
		--system)
			MODE="system"
			shift
			;;
		--target-user)
			shift
			SYSTEM_TARGET_USER="${1:-}"
			[ -n "$SYSTEM_TARGET_USER" ] || _die "--target-user requires a user name"
			shift
			;;
		--webui)
			shift
			WEBUI_DIR="${1:-}"
			[ -n "$WEBUI_DIR" ] || _die "--webui requires a path"
			shift
			;;
		--no-webui)
			NO_WEBUI=1
			shift
			;;
		-h|--help)
			cat <<'H'
Usage:
  ./install.sh                               # auto-detect mode (USER if no sudo, SYSTEM if sudo)
  ./install.sh --user                        # force USER install (no sudo). Note: this is NOT a target user selector.
  sudo ./install.sh                          # SYSTEM install
  sudo ./install.sh --system                 # same as above
  sudo ./install.sh --system --target-user X # run services as user X (rootless podman)

Optional:
  --target-user <name>     # SYSTEM mode: run services as this user (rootless podman). Default: SUDO_USER
  --webui <path>           # install WebUI extension to this text-generation-webui directory
  --no-webui               # skip WebUI extension installation
H
			exit 0
			;;
		*)
			_die "Unknown argument: $1"
			;;
	esac
done

if [ -z "$MODE" ]; then
	if [ "$(id -u)" -eq 0 ]; then
		MODE="system"
	else
		MODE="user"
	fi
fi

SCRIPT_DIR="$(_abs_dir_of_this_script)"

if [ "$MODE" = "system" ] && [ "$(id -u)" -ne 0 ]; then
	_die "SYSTEM install requires sudo. Re-run: sudo ./install.sh"
fi

RUN_USER="${SUDO_USER:-${USER}}"
if [ "$MODE" = "system" ] && [ -n "$SYSTEM_TARGET_USER" ]; then
	RUN_USER="$SYSTEM_TARGET_USER"
fi
if [ "$MODE" = "system" ] && [ -z "${SUDO_USER:-}" ] && [ -z "$SYSTEM_TARGET_USER" ]; then
	_die "Run SYSTEM install via sudo from a normal user (SUDO_USER is empty), or pass: --target-user <name>"
fi
if [ "$MODE" = "system" ] && ! id -u "$RUN_USER" >/dev/null 2>&1; then
	_die "Target user does not exist: $RUN_USER"
fi

if [ "$MODE" = "user" ]; then
	echo
	echo "No sudo detected → installing in USER mode."
	echo "- Install dir:  ~/.local/share/mistbyte-ai/websearch"
	echo "- Config dir:   ~/.config/mistbyte-ai/websearch"
	echo "- Cache dir:    ~/.cache/mistbyte-ai/websearch"
	echo "- systemd:      --user units (starts for this user)"
	echo
	echo "If you want a SYSTEM-wide install, re-run with sudo:"
	echo "  sudo ./install.sh"
	echo
	if ! _ask_yn "Continue with USER install? [y/N] "; then
		_info "Cancelled."
		exit 0
	fi
fi

if ! _have node; then
	_die "node is not installed. Install Node.js (LTS) and re-run."
fi
if ! _have npm; then
	_die "npm is not installed. Install npm and re-run."
fi
if ! _have podman; then
	_die "podman is not installed. Install podman and re-run."
fi

NODE_VER="$(node -v 2>/dev/null || true)"
_info "node: $NODE_VER"

if [ "$MODE" = "user" ]; then
	BASE_SHARE="$HOME/.local/share/mistbyte-ai/websearch"
	BASE_CFG="$HOME/.config/mistbyte-ai/websearch"
	BASE_CACHE="$HOME/.cache/mistbyte-ai/websearch"
	SYSTEMCTL=(systemctl --user)
	SYSTEMD_DIR="$HOME/.config/systemd/user"
	UNIT_SRC_DIR="$SCRIPT_DIR/systemd/user"
else
	BASE_SHARE="/opt/mistbyte-ai/websearch"
	BASE_CFG="/etc/mistbyte-ai/websearch"
	BASE_CACHE="/var/cache/mistbyte-ai/websearch"
	SYSTEMCTL=(systemctl)
	SYSTEMD_DIR="/etc/systemd/system"
	UNIT_SRC_DIR="$SCRIPT_DIR/systemd/system"
fi

mkdir -p "$BASE_SHARE" "$BASE_CFG" "$BASE_CACHE"
mkdir -p "$BASE_CFG/searxng"

if [ "$MODE" = "system" ]; then
	chown -R "$RUN_USER:$RUN_USER" "$BASE_CACHE" || true
	chown -R "$RUN_USER:$RUN_USER" "$BASE_SHARE" || true
	# /etc is root-owned; config files will be written by root, but must be readable by RUN_USER.
	chmod -R a+rX "$BASE_CFG" || true
fi

_info "Installing/updating project files..."
if _have rsync; then
	rsync -a --delete \
		--exclude '.git' \
		--exclude 'node_modules' \
		--exclude '.cache' \
		--exclude '__pycache__' \
		"$SCRIPT_DIR/" "$BASE_SHARE/"
else
	_info "WARN: rsync not found. Using fallback copy; upgrades may leave stale files."
	_hint_install_rsync
	_info "Continuing with fallback..."
	# Fallback: less perfect, but works for simple cases.
	rm -rf "$BASE_SHARE/src" "$BASE_SHARE/config" "$BASE_SHARE/docs" "$BASE_SHARE/systemd" "$BASE_SHARE/searxng" "$BASE_SHARE/install.sh" 2>/dev/null || true
	cp -a "$SCRIPT_DIR/src" "$BASE_SHARE/"
	cp -a "$SCRIPT_DIR/config" "$BASE_SHARE/"
	[ -d "$SCRIPT_DIR/docs" ] && cp -a "$SCRIPT_DIR/docs" "$BASE_SHARE/" || true
	[ -d "$SCRIPT_DIR/systemd" ] && cp -a "$SCRIPT_DIR/systemd" "$BASE_SHARE/" || true
	[ -d "$SCRIPT_DIR/searxng" ] && cp -a "$SCRIPT_DIR/searxng" "$BASE_SHARE/" || true
	cp -a "$SCRIPT_DIR/package.json" "$BASE_SHARE/" || true
	cp -a "$SCRIPT_DIR/package-lock.json" "$BASE_SHARE/" || true
	cp -a "$SCRIPT_DIR/install.sh" "$BASE_SHARE/" || true
fi

_info "Installing node dependencies (npm ci)..."
pushd "$BASE_SHARE" >/dev/null
if [ -f "$BASE_SHARE/package-lock.json" ]; then
	npm ci
else
	_info "WARN: package-lock.json not found. Falling back to 'npm install'."
	npm install
fi
popd >/dev/null

_copy_example_preserve() {
	local src="$1"
	local dst="$2"
	if [ ! -f "$dst" ]; then
		cp -a "$src" "$dst"
		return 0
	fi
	# Preserve existing, write new example as *.new
	cp -a "$src" "$dst.new"
	return 0
}

_info "Installing configs..."
_copy_example_preserve "$BASE_SHARE/config/searcher.example.yaml" "$BASE_CFG/searcher.yaml"
_copy_example_preserve "$BASE_SHARE/searxng/settings.yml.example" "$BASE_CFG/searxng/settings.yml"

# If we created settings.yml from example, ensure it has a secret_key.
if [ -f "$BASE_CFG/searxng/settings.yml" ]; then
	if grep -q 'secret_key: "CHANGE_ME"' "$BASE_CFG/searxng/settings.yml"; then
		SECRET="$(_rand_hex_64)"
		# Use a safe delimiter to avoid sed quoting issues.
		sed -i 's|secret_key: "CHANGE_ME"|secret_key: "'"$SECRET"'"|g' "$BASE_CFG/searxng/settings.yml" || true
		if grep -q 'secret_key: "CHANGE_ME"' "$BASE_CFG/searxng/settings.yml"; then
			_info "WARN: Failed to auto-replace SearXNG secret_key (still CHANGE_ME)."
			_info "      Please edit this file and set a random secret_key:"
			_info "      $BASE_CFG/searxng/settings.yml"
			echo "Hint:"
			echo "  python3 - <<'PY'"
			echo "  import secrets; print(secrets.token_hex(32))"
			echo "  PY"
		else
			_info "Generated SearXNG secret_key in: $BASE_CFG/searxng/settings.yml"
		fi
	fi
else
	_info "WARN: SearXNG settings.yml not found at expected path:"
	_info "      $BASE_CFG/searxng/settings.yml"
	_info "      SearXNG may fail to start without a valid secret_key."
fi

_tmpl_install_unit() {
	local src="$1"
	local dst="$2"
	# Replace placeholders in unit templates.
	sed \
		-e "s|@PROJECT_DIR@|$BASE_SHARE|g" \
		-e "s|@CFG_DIR@|$BASE_CFG|g" \
		-e "s|@CACHE_DIR@|$BASE_CACHE|g" \
		"$src" >"$dst"
}

_info "Installing systemd units..."
_ensure_user_systemd_bus

if [ "$MODE" = "user" ]; then
	mkdir -p "$SYSTEMD_DIR"
	_tmpl_install_unit "$UNIT_SRC_DIR/searxng.service" "$SYSTEMD_DIR/searxng.service"
	_tmpl_install_unit "$UNIT_SRC_DIR/websearch-mistbyte.service" "$SYSTEMD_DIR/websearch-mistbyte.service"
else
	_tmpl_install_unit "$UNIT_SRC_DIR/searxng@.service" "$SYSTEMD_DIR/searxng@.service"
	_tmpl_install_unit "$UNIT_SRC_DIR/websearch-mistbyte@.service" "$SYSTEMD_DIR/websearch-mistbyte@.service"
fi

${SYSTEMCTL[@]} daemon-reload

_info "Enabling and starting services..."
if [ "$MODE" = "user" ]; then
	SEARX_WAS_ACTIVE=0
	WS_WAS_ACTIVE=0
	if ${SYSTEMCTL[@]} is-active --quiet searxng.service 2>/dev/null; then
		SEARX_WAS_ACTIVE=1
	fi
	if ${SYSTEMCTL[@]} is-active --quiet websearch-mistbyte.service 2>/dev/null; then
		WS_WAS_ACTIVE=1
	fi
	if _podman_pull_searxng_or_warn; then
		${SYSTEMCTL[@]} enable --now searxng.service
	else
		_warn "Skipping: systemctl --user enable --now searxng.service"
	fi
	${SYSTEMCTL[@]} enable --now websearch-mistbyte.service

	# If services were already running, restart them to apply updated units/configs.
	if [ "$SEARX_WAS_ACTIVE" -eq 1 ] && ${SYSTEMCTL[@]} is-active --quiet searxng.service 2>/dev/null; then
		${SYSTEMCTL[@]} restart searxng.service || true
	fi
	if [ "$WS_WAS_ACTIVE" -eq 1 ] && ${SYSTEMCTL[@]} is-active --quiet websearch-mistbyte.service 2>/dev/null; then
		${SYSTEMCTL[@]} restart websearch-mistbyte.service || true
	fi
else
	SEARX_WAS_ACTIVE=0
	WS_WAS_ACTIVE=0
	if ${SYSTEMCTL[@]} is-active --quiet "searxng@${RUN_USER}.service" 2>/dev/null; then
		SEARX_WAS_ACTIVE=1
	fi
	if ${SYSTEMCTL[@]} is-active --quiet "websearch-mistbyte@${RUN_USER}.service" 2>/dev/null; then
		WS_WAS_ACTIVE=1
	fi
	if _podman_pull_searxng_or_warn; then
		${SYSTEMCTL[@]} enable --now searxng@${RUN_USER}.service
	else
		_warn "Skipping: systemctl enable --now searxng@${RUN_USER}.service"
	fi
	${SYSTEMCTL[@]} enable --now "websearch-mistbyte@${RUN_USER}.service"

	if [ "$SEARX_WAS_ACTIVE" -eq 1 ] && ${SYSTEMCTL[@]} is-active --quiet "searxng@${RUN_USER}.service" 2>/dev/null; then
		${SYSTEMCTL[@]} restart "searxng@${RUN_USER}.service" || true
	fi
	if [ "$WS_WAS_ACTIVE" -eq 1 ] && ${SYSTEMCTL[@]} is-active --quiet "websearch-mistbyte@${RUN_USER}.service" 2>/dev/null; then
		${SYSTEMCTL[@]} restart "websearch-mistbyte@${RUN_USER}.service" || true
	fi
fi

_info "Basic checks..."
if _have curl; then
	set +e
	curl -fsS --max-time 3 "http://127.0.0.1:8888/" >/dev/null 2>&1
	SEARX_OK=$?
	curl -fsS --max-time 3 "http://127.0.0.1:7070/healthz" >/dev/null 2>&1
	WS_OK=$?
	set -e

	if [ "$SEARX_OK" -ne 0 ]; then
		_info "WARN: SearXNG check failed on http://127.0.0.1:8888/ (may still be starting)."
	fi
	if [ "$WS_OK" -ne 0 ]; then
		_info "WARN: WebSearch check failed on http://127.0.0.1:7070/healthz (may still be starting)."
	fi
else
	_info "curl not found, skipping HTTP checks."
fi

_detect_webui() {
	# Try explicit path first.
	if [ -n "$WEBUI_DIR" ]; then
		echo "$WEBUI_DIR"
		return 0
	fi
	# Try common locations.
	local c=""
	for c in \
		"$HOME/text-generation-webui" \
		"$HOME/model/text-generation-webui" \
		"$HOME/models/text-generation-webui" \
		"$HOME/Text-Generation-WebUI" \
		"$HOME/oobabooga/text-generation-webui" \
		"$HOME/oobabooga/Text-Generation-WebUI" \
		"$HOME/AI/text-generation-webui" \
		"$HOME/AI-local/text-generation-webui"
	do
		if [ -d "$c/extensions" ] && { [ -f "$c/server.py" ] || [ -f "$c/webui.py" ] || [ -d "$c/modules" ]; }; then
			echo "$c"
			return 0
		fi
	done
	return 1
}

_install_webui_ext() {
	local webui="$1"
	local ext_dir="$webui/extensions/websearch_mistbyte"
	mkdir -p "$ext_dir"
	if [ -f "$ext_dir/script.py" ]; then
		cp -a "$ext_dir/script.py" "$ext_dir/script.py.bak" || true
	fi
	cp -a "$BASE_SHARE/src/webui_plugin/script.py" "$ext_dir/script.py"
	_info "WebUI extension installed to: $ext_dir"
	_info "Restart WebUI to load the updated extension."
}

if [ "$NO_WEBUI" -eq 0 ]; then
	if WEBUI="$(_detect_webui)"; then
		_install_webui_ext "$WEBUI"
	else
		_info "WebUI directory not found. To install extension manually:"
		echo "  Copy: $BASE_SHARE/src/webui_plugin/script.py"
		echo "  To:   <text-generation-webui>/extensions/websearch_mistbyte/script.py"
	fi
fi

echo
_info "Done."
if [ "$MODE" = "user" ]; then
	echo
	echo "Note: user services start when you are logged in."
	echo "Optional (start at boot without login):"
	echo "  sudo loginctl enable-linger $USER"
	echo
	echo "Logs:"
	echo "  journalctl --user -u searxng -f"
	echo "  journalctl --user -u websearch-mistbyte -f"
else
	echo
	echo "Logs:"
	echo "  journalctl -u searxng@${RUN_USER} -f"
	echo "  journalctl -u websearch-mistbyte@${RUN_USER} -f"
fi

#<eof install.sh lines 409>
