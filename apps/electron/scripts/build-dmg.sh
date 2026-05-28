#!/bin/bash
# input: Local Electron build inputs, runtime asset versions, and optional download proxy settings
# output: A signed or ad-hoc signed macOS Storyflow DMG for the requested architecture
# pos: macOS desktop packaging script used by local builds and release workflow

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$ELECTRON_DIR")")"

# Helper function to check required file/directory exists
require_path() {
    local path="$1"
    local description="$2"
    local hint="$3"

    if [ ! -e "$path" ]; then
        echo "ERROR: $description not found at $path"
        [ -n "$hint" ] && echo "$hint"
        exit 1
    fi
}

resolve_dotenv_value() {
    local value="$1"

    # Keep the loader non-evaluating, but preserve the existing local pattern
    # used for large secrets: CSC_KEY_PASSWORD="$(cat /path/to/password)".
    if [ "${value:0:6}" = '$(cat ' ] && [ "${value: -1}" = ')' ]; then
        local path="${value:6:${#value}-7}"
    elif [ "${value:0:5}" = '(cat ' ] && [ "${value: -1}" = ')' ]; then
        local path="${value:5:${#value}-6}"
    else
        printf '%s' "$value"
        return
    fi

        path="${path#"${path%%[![:space:]]*}"}"
        path="${path%"${path##*[![:space:]]}"}"
        if [[ "$path" == \"*\" && "$path" == *\" ]]; then
            path="${path:1:${#path}-2}"
        elif [[ "$path" == \'*\' && "$path" == *\' ]]; then
            path="${path:1:${#path}-2}"
        fi
        require_path "$path" "dotenv cat target" ""
        cat "$path"
        return
}

# Sync secrets from 1Password if CLI is available
if command -v op &> /dev/null; then
    echo "1Password CLI detected, syncing secrets..."
    cd "$ROOT_DIR"
    if bun run sync-secrets 2>/dev/null; then
        echo "Secrets synced from 1Password"
    else
        echo "Warning: Failed to sync secrets from 1Password (continuing with existing .env if present)"
    fi
fi

# Load environment variables from .env without overriding explicit env values
if [ -f "$ROOT_DIR/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        trimmed="${line#"${line%%[![:space:]]*}"}"
        trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
        if [ -z "$trimmed" ] || [[ "$trimmed" == \#* ]]; then
            continue
        fi
        if [[ "$trimmed" != *=* ]]; then
            continue
        fi
        key="${trimmed%%=*}"
        value="${trimmed#*=}"
        key="${key%"${key##*[![:space:]]}"}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        if [[ "$value" == \"*\" && "$value" == *\" ]]; then
            value="${value:1:${#value}-2}"
        elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
            value="${value:1:${#value}-2}"
        fi
        if [ -n "$key" ]; then
            if [ -z "${!key+x}" ]; then
                value="$(resolve_dotenv_value "$value")"
                export "$key=$value"
            else
                current_value="${!key}"
                if [ "${current_value:0:6}" = '$(cat ' ] || [ "${current_value:0:5}" = '(cat ' ]; then
                    current_value="$(resolve_dotenv_value "$current_value")"
                    export "$key=$current_value"
                fi
            fi
        fi
    done < "$ROOT_DIR/.env"
fi

# Parse arguments
ARCH="arm64"
UPLOAD=false
UPLOAD_LATEST=false
UPLOAD_SCRIPT=false

show_help() {
    cat << EOF
Usage: build-dmg.sh [arm64|x64] [--upload] [--latest] [--script]

Arguments:
  arm64|x64    Target architecture (default: arm64)
  --upload     Upload DMG to S3 after building
  --latest     Also update latest release assets (requires --upload)
  --script     Also upload install-app.sh (requires --upload)

Environment variables (from .env or environment):
  CRAFT_REQUIRE_MAC_SIGNING - Set to 1 for official releases; fails fast if signing/notarization credentials are missing
  CSC_LINK                  - Developer ID Application certificate, base64 or file path, for electron-builder signing
  CSC_KEY_PASSWORD          - Password for CSC_LINK, if the certificate is password-protected
  APPLE_API_KEY_BASE64      - Optional App Store Connect API private key as base64 text
  APPLE_API_KEY_ID          - App Store Connect API key ID
  APPLE_API_ISSUER          - Optional App Store Connect API issuer ID; required for Team API keys, omitted for Individual keys
  APPLE_ID                  - Apple ID for password-based notarization
  APPLE_TEAM_ID             - Apple Team ID for password-based notarization
  APPLE_APP_SPECIFIC_PASSWORD - App-specific password
  APPLE_SIGNING_IDENTITY    - Optional local keychain signing identity override
  S3_VERSIONS_BUCKET_*      - S3 credentials (for --upload)
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        arm64|x64)     ARCH="$1"; shift ;;
        --upload)      UPLOAD=true; shift ;;
        --latest)      UPLOAD_LATEST=true; shift ;;
        --script)      UPLOAD_SCRIPT=true; shift ;;
        -h|--help)     show_help ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Configuration
BUN_VERSION="bun-v1.3.9"  # Pinned version for reproducible builds

require_env() {
    local name="$1"
    if [ -z "${!name:-}" ]; then
        echo "ERROR: Missing required environment variable: $name"
        exit 1
    fi
}

has_apple_api_notarization_credentials() {
    ([ -n "${APPLE_API_KEY_BASE64:-}" ] || [ -n "${APPLE_API_KEY:-}" ]) && [ -n "${APPLE_API_KEY_ID:-}" ]
}

has_apple_password_notarization_credentials() {
    [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]
}

should_enable_macos_release_signing() {
    [ "${CRAFT_REQUIRE_MAC_SIGNING:-}" = "1" ] ||
        has_apple_api_notarization_credentials ||
        has_apple_password_notarization_credentials
}

prepare_apple_api_key() {
    if [ -z "${APPLE_API_KEY_BASE64:-}" ]; then
        return 0
    fi

    require_env APPLE_API_KEY_ID

    local api_key_dir="$TEMP_DIR/storyflow-apple-api-key"

    mkdir -p "$api_key_dir"
    export APPLE_API_KEY="$api_key_dir/AuthKey_${APPLE_API_KEY_ID}.p8"
    if ! printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode > "$APPLE_API_KEY" 2>/dev/null; then
        printf '%s' "$APPLE_API_KEY_BASE64" | base64 -D > "$APPLE_API_KEY"
    fi
    chmod 600 "$APPLE_API_KEY"
}

select_notarization_credentials() {
    if [ -n "${APPLE_API_KEY_BASE64:-}" ] || [ -n "${APPLE_API_KEY:-}" ]; then
        require_env APPLE_API_KEY_ID
        unset APPLE_ID
        unset APPLE_APP_SPECIFIC_PASSWORD
        unset APPLE_TEAM_ID
        # APPLE_API_ISSUER is optional and must be omitted for Individual API keys.
        if [ -n "${APPLE_API_ISSUER:-}" ]; then
            echo "Using App Store Connect Team API key notarization"
        else
            echo "Using App Store Connect Individual API key notarization"
        fi
        return 0
    fi

    if has_apple_password_notarization_credentials; then
        echo "Using Apple ID app-specific password notarization"
        return 0
    fi

    return 1
}

normalize_csc_link_for_macos_security() {
    if [ -z "${CSC_LINK:-}" ] || [ ! -f "$CSC_LINK" ]; then
        return 0
    fi

    case "${CSC_LINK##*.}" in
        p12|pfx) ;;
        *) return 0 ;;
    esac

    if ! command -v openssl >/dev/null 2>&1; then
        echo "OpenSSL not found; using CSC_LINK as provided."
        return 0
    fi

    local pass_file="$TEMP_DIR/storyflow-csc-password"
    local pem_file="$TEMP_DIR/storyflow-csc-extracted.pem"
    local normalized_p12="$TEMP_DIR/storyflow-csc-normalized.p12"

    printf '%s' "${CSC_KEY_PASSWORD:-}" > "$pass_file"
    chmod 600 "$pass_file"

    if ! openssl pkcs12 -in "$CSC_LINK" -passin "file:$pass_file" -nodes -out "$pem_file" >/dev/null 2>&1 &&
       ! openssl pkcs12 -legacy -in "$CSC_LINK" -passin "file:$pass_file" -nodes -out "$pem_file" >/dev/null 2>&1; then
        echo "OpenSSL could not read CSC_LINK; using CSC_LINK as provided."
        return 0
    fi
    chmod 600 "$pem_file"

    local export_openssl="/usr/bin/openssl"
    if [ ! -x "$export_openssl" ]; then
        export_openssl="$(command -v openssl)"
    fi

    if ! "$export_openssl" pkcs12 -export -in "$pem_file" -out "$normalized_p12" -passout "file:$pass_file" >/dev/null 2>&1; then
        echo "OpenSSL could not normalize CSC_LINK; using CSC_LINK as provided."
        return 0
    fi

    chmod 600 "$normalized_p12"
    export CSC_LINK="$normalized_p12"
    echo "Normalized CSC_LINK for macOS keychain import."
}

notarize_macos_dmg_artifact() {
    local dmg_path="$1"

    require_path "$dmg_path" "DMG artifact" ""

    echo "Submitting DMG for Apple notarization..."
    if [ -n "${APPLE_API_KEY_BASE64:-}" ] || [ -n "${APPLE_API_KEY:-}" ]; then
        require_env APPLE_API_KEY
        require_env APPLE_API_KEY_ID
        if [ -n "${APPLE_API_ISSUER:-}" ]; then
            xcrun notarytool submit "$dmg_path" --wait --output-format json \
                --key "$APPLE_API_KEY" \
                --key-id "$APPLE_API_KEY_ID" \
                --issuer "$APPLE_API_ISSUER"
        else
            xcrun notarytool submit "$dmg_path" --wait --output-format json \
                --key "$APPLE_API_KEY" \
                --key-id "$APPLE_API_KEY_ID"
        fi
    elif has_apple_password_notarization_credentials; then
        xcrun notarytool submit "$dmg_path" --wait --output-format json \
            --apple-id "$APPLE_ID" \
            --team-id "$APPLE_TEAM_ID" \
            --password "$APPLE_APP_SPECIFIC_PASSWORD"
    else
        echo "ERROR: Missing Apple notarization credentials for DMG artifact."
        exit 1
    fi

    echo "Stapling DMG notarization ticket..."
    xcrun stapler staple "$dmg_path"
}

validate_macos_release_credentials() {
    if [ "${CRAFT_REQUIRE_MAC_SIGNING:-}" != "1" ]; then
        return 0
    fi

    require_env CSC_LINK

    if ! select_notarization_credentials; then
        cat <<'EOF'
ERROR: Official macOS release builds require Apple notarization credentials.
Set either:
  APPLE_API_KEY_BASE64/APPLE_API_KEY and APPLE_API_KEY_ID (App Store Connect API key; set APPLE_API_ISSUER only for Team API keys)
or:
  APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD
EOF
        exit 1
    fi
}

verify_macos_release_artifacts() {
    local app_path="$1"
    local dmg_path="$2"
    local zip_path="$3"

    if [ -f "$dmg_path" ]; then
        echo "DMG artifact present: $dmg_path"
    else
        echo "ERROR: Expected DMG artifact not found at $dmg_path"
        exit 1
    fi

    if [ -f "$zip_path" ]; then
        echo "ZIP artifact present: $zip_path"
    else
        echo "ERROR: Expected ZIP artifact not found at $zip_path"
        exit 1
    fi

    echo "Verifying Developer ID signature..."
    codesign --verify --deep --strict --verbose=2 "$app_path"

    echo "Verifying Gatekeeper assessment for app bundle..."
    spctl --assess --type execute --verbose=4 "$app_path"

    echo "Validating notarization staple for app bundle..."
    xcrun stapler validate "$app_path"

    echo "Verifying Gatekeeper assessment for DMG..."
    spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg_path"

    echo "Validating notarization staple for DMG..."
    xcrun stapler validate "$dmg_path"
}

run_electron_builder_with_retries() {
    local max_attempts="${CRAFT_MACOS_NOTARIZE_ATTEMPTS:-3}"
    local retry_delay_seconds="${CRAFT_MACOS_NOTARIZE_RETRY_DELAY_SECONDS:-60}"
    local attempt=1
    local status=0

    while true; do
        echo "electron-builder attempt ${attempt} of ${max_attempts}..."
        set +e
        npx electron-builder $BUILDER_ARGS
        status=$?
        set -e

        if [ "$status" -eq 0 ]; then
            return 0
        fi

        if ! should_enable_macos_release_signing || [ "$attempt" -ge "$max_attempts" ]; then
            return "$status"
        fi

        echo "electron-builder failed during signed macOS packaging; retrying after ${retry_delay_seconds}s because Apple notarization can return transient timeouts."
        sleep "$retry_delay_seconds"
        attempt=$((attempt + 1))
    done
}

echo "=== Building Storyflow DMG (${ARCH}) using electron-builder ==="
if [ "$UPLOAD" = true ]; then
    echo "Will upload to S3 after build"
    if [ ! -f "$ROOT_DIR/scripts/upload.ts" ]; then
        echo "ERROR: Upload requested, but scripts/upload.ts is missing."
        exit 1
    fi
fi

CURL_FLAGS=(-fSL --retry 3 --retry-delay 2 --connect-timeout 20 --speed-time 30 --speed-limit 10240)

download_url() {
    local url="$1"
    if [ -n "${CRAFT_DOWNLOAD_PROXY_PREFIX:-}" ]; then
        echo "${CRAFT_DOWNLOAD_PROXY_PREFIX}${url}"
    else
        echo "$url"
    fi
}

# 1. Clean previous build artifacts
echo "Cleaning previous builds..."
rm -rf "$ELECTRON_DIR/vendor"
rm -rf "$ELECTRON_DIR/node_modules/@anthropic-ai"
rm -rf "$ELECTRON_DIR/packages"
rm -rf "$ELECTRON_DIR/release"

# 2. Install dependencies
echo "Installing dependencies..."
cd "$ROOT_DIR"
bun install

# 3. Download Bun binary with checksum verification
echo "Downloading Bun ${BUN_VERSION} for darwin-${ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/bun"
BUN_DOWNLOAD="bun-darwin-$([ "$ARCH" = "arm64" ] && echo "aarch64" || echo "x64")"

# Create temp directory to avoid race conditions and hold short-lived signing material
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

prepare_apple_api_key
validate_macos_release_credentials
normalize_csc_link_for_macos_security

# Download binary and checksums
curl "${CURL_FLAGS[@]}" "$(download_url "https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${BUN_DOWNLOAD}.zip")" -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip"
curl "${CURL_FLAGS[@]}" "$(download_url "https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt")" -o "$TEMP_DIR/SHASUMS256.txt"

# Verify checksum
echo "Verifying checksum..."
cd "$TEMP_DIR"
grep "${BUN_DOWNLOAD}.zip" SHASUMS256.txt | shasum -a 256 -c -
cd - > /dev/null

# Extract and install
unzip -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip" -d "$TEMP_DIR"
cp "$TEMP_DIR/${BUN_DOWNLOAD}/bun" "$ELECTRON_DIR/vendor/bun/"
chmod +x "$ELECTRON_DIR/vendor/bun/bun"

# 4. Copy SDK from root node_modules (monorepo hoisting)
# Note: The SDK is hoisted to root node_modules by the package manager.
# We copy it here because electron-builder only sees apps/electron/.
#
# Since SDK 0.2.113 the SDK split into a thin core + per-platform binary
# package (see plans/sdk-uplift-plan.md). We bundle:
#   1. The core (`claude-agent-sdk`) — universal sdk.mjs + types.
#   2. The matching arch's binary package, copied to a stable alias path
#      `claude-agent-sdk-binary/` so the electron-builder.yml entry stays
#      arch-agnostic and the runtime resolver finds it regardless of host
#      arch at build time.
SDK_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
require_path "$SDK_SOURCE" "SDK core" "Run 'bun install' from the repository root first."
echo "Copying SDK core..."
mkdir -p "$ELECTRON_DIR/node_modules/@anthropic-ai"
rm -rf "$ELECTRON_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
cp -r "$SDK_SOURCE" "$ELECTRON_DIR/node_modules/@anthropic-ai/"

# 4a. Resolve the target arch's binary package. If the host arch matches the
#     target, bun install already placed it in node_modules/@anthropic-ai/.
#     Otherwise, fetch and unpack the matching tarball directly via npm.
SDK_BIN_PKG="claude-agent-sdk-darwin-${ARCH}"
SDK_BIN_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/${SDK_BIN_PKG}"
if [ ! -d "$SDK_BIN_SOURCE" ]; then
    echo "Cross-arch build: ${SDK_BIN_PKG} not in node_modules — fetching from npm..."
    SDK_VERSION=$(node -p "require('$ROOT_DIR/package.json').dependencies['@anthropic-ai/claude-agent-sdk']" | tr -d '"')
    PKG_TMP=$(mktemp -d)
    trap "rm -rf $PKG_TMP" RETURN
    (
        cd "$PKG_TMP"
        npm pack "@anthropic-ai/${SDK_BIN_PKG}@${SDK_VERSION}" >/dev/null
        TARBALL=$(ls anthropic-ai-*.tgz | head -1)
        tar -xzf "$TARBALL"
    )
    mkdir -p "$SDK_BIN_SOURCE"
    cp -r "$PKG_TMP/package/." "$SDK_BIN_SOURCE/"
fi

require_path "$SDK_BIN_SOURCE" "SDK native binary package (${SDK_BIN_PKG})" \
  "Run 'bun install' from the repository root, or check your network for the npm cross-fetch."

echo "Staging SDK native binary as claude-agent-sdk-binary alias..."
ALIAS_DEST="$ELECTRON_DIR/node_modules/@anthropic-ai/claude-agent-sdk-binary"
rm -rf "$ALIAS_DEST"
mkdir -p "$ALIAS_DEST"
cp -r "$SDK_BIN_SOURCE/." "$ALIAS_DEST/"
chmod +x "$ALIAS_DEST/claude"

# Sanity check: native binary should be ~210 MB. Anything dramatically smaller
# indicates a botched copy / wrong tarball.
BIN_SIZE=$(stat -f%z "$ALIAS_DEST/claude" 2>/dev/null || stat -c%s "$ALIAS_DEST/claude")
if [ "$BIN_SIZE" -lt 50000000 ]; then
    echo "ERROR: claude binary at $ALIAS_DEST/claude is only ${BIN_SIZE} bytes (expected ~210 MB)"
    exit 1
fi
echo "  Native binary: $((BIN_SIZE / 1024 / 1024)) MB"

# 5. Copy ripgrep (was previously bundled inside the SDK at vendor/ripgrep/;
#    moved out in 0.2.113. Search service still needs the binary directly.)
RG_SOURCE="$ROOT_DIR/node_modules/@vscode/ripgrep"
require_path "$RG_SOURCE" "@vscode/ripgrep" "Run 'bun install' and 'bun pm trust @vscode/ripgrep' first."
require_path "$RG_SOURCE/bin/rg" "ripgrep binary" "@vscode/ripgrep postinstall did not run."
echo "Copying @vscode/ripgrep..."
mkdir -p "$ELECTRON_DIR/node_modules/@vscode"
rm -rf "$ELECTRON_DIR/node_modules/@vscode/ripgrep"
cp -r "$RG_SOURCE" "$ELECTRON_DIR/node_modules/@vscode/"

# 6. Copy network interceptor sources.
#    NOTE (Phase 1 of SDK uplift): the Claude native binary doesn't accept
#    Bun's --preload, so the Claude code path no longer uses these. They're
#    still needed for the **Pi** subprocess (runs on Bun, accepts --preload).
#    Phase 2 will reintroduce equivalent functionality for Claude via SDK
#    hooks or a local proxy. See plans/sdk-uplift-plan.md.
INTERCEPTOR_SOURCE="$ROOT_DIR/packages/shared/src/unified-network-interceptor.ts"
require_path "$INTERCEPTOR_SOURCE" "Interceptor" "Ensure packages/shared/src/unified-network-interceptor.ts exists."
echo "Copying interceptor (for Pi subprocess)..."
mkdir -p "$ELECTRON_DIR/packages/shared/src"
cp "$INTERCEPTOR_SOURCE" "$ELECTRON_DIR/packages/shared/src/"
for dep in interceptor-common.ts feature-flags.ts interceptor-request-utils.ts; do
  if [ -f "$ROOT_DIR/packages/shared/src/$dep" ]; then
    cp "$ROOT_DIR/packages/shared/src/$dep" "$ELECTRON_DIR/packages/shared/src/"
  fi
done

# 6. Build Electron app
echo "Building Electron app..."
cd "$ROOT_DIR"
export CRAFT_BUILD_PLATFORM=darwin
export CRAFT_BUILD_ARCH="$ARCH"
bun run electron:build

# 7. Package with electron-builder
echo "Packaging app with electron-builder..."
cd "$ELECTRON_DIR"

# Set up environment for electron-builder
export CSC_IDENTITY_AUTO_DISCOVERY=true

# Build electron-builder arguments
BUILDER_ARGS="--mac --${ARCH}"
if should_enable_macos_release_signing; then
    BUILDER_ARGS="$BUILDER_ARGS -c.mac.forceCodeSigning=true -c.mac.notarize=true"
else
    BUILDER_ARGS="$BUILDER_ARGS -c.mac.forceCodeSigning=false -c.mac.notarize=false"
fi

# Add code signing if identity is available
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    # Strip "Developer ID Application: " prefix if present (electron-builder adds it automatically)
    CSC_NAME_CLEAN="${APPLE_SIGNING_IDENTITY#Developer ID Application: }"
    echo "Using signing identity: $CSC_NAME_CLEAN"
    export CSC_NAME="$CSC_NAME_CLEAN"
fi

# Add notarization if credentials are available
if should_enable_macos_release_signing; then
    select_notarization_credentials
    echo "Notarization enabled"
else
    echo "Notarization credentials not present; building a local unsigned macOS package."
fi

# Run electron-builder. Official release builds include Apple notarization, which
# can intermittently return NSURLErrorDomain timeouts while the submission keeps
# processing server-side.
run_electron_builder_with_retries

# 8. Verify the DMG was built
# electron-builder.yml uses artifactName to output: Storyflow-${arch}.dmg
DMG_NAME="Storyflow-${ARCH}.dmg"
DMG_PATH="$ELECTRON_DIR/release/$DMG_NAME"

if [ ! -f "$DMG_PATH" ]; then
    echo "ERROR: Expected DMG not found at $DMG_PATH"
    echo "Contents of release directory:"
    ls -la "$ELECTRON_DIR/release/"
    exit 1
fi

ZIP_NAME="Storyflow-${ARCH}.zip"
ZIP_PATH="$ELECTRON_DIR/release/$ZIP_NAME"
MAC_DIR="$([ "$ARCH" = "arm64" ] && echo "mac-arm64" || echo "mac")"
APP_PATH="$ELECTRON_DIR/release/$MAC_DIR/Storyflow.app"

if should_enable_macos_release_signing; then
    notarize_macos_dmg_artifact "$DMG_PATH"
fi

if [ "${CRAFT_REQUIRE_MAC_SIGNING:-}" = "1" ]; then
    verify_macos_release_artifacts "$APP_PATH" "$DMG_PATH" "$ZIP_PATH"
fi

echo ""
echo "=== Build Complete ==="
echo "DMG: $ELECTRON_DIR/release/${DMG_NAME}"
[ -f "$ZIP_PATH" ] && echo "ZIP: $ELECTRON_DIR/release/${ZIP_NAME}"
echo "Size: $(du -h "$ELECTRON_DIR/release/${DMG_NAME}" | cut -f1)"

# 9. Create manifest.json for upload script
# Read version from package.json
ELECTRON_VERSION=$(cat "$ELECTRON_DIR/package.json" | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "Creating manifest.json (version: $ELECTRON_VERSION)..."
mkdir -p "$ROOT_DIR/.build/upload"
echo "{\"version\": \"$ELECTRON_VERSION\"}" > "$ROOT_DIR/.build/upload/manifest.json"

# 10. Upload to S3 (if --upload flag is set)
if [ "$UPLOAD" = true ]; then
    echo ""
    echo "=== Uploading to S3 ==="

    # Check for S3 credentials
    if [ -z "$S3_VERSIONS_BUCKET_ENDPOINT" ] || [ -z "$S3_VERSIONS_BUCKET_ACCESS_KEY_ID" ] || [ -z "$S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY" ]; then
        cat << EOF
ERROR: Missing S3 credentials. Set these environment variables:
  S3_VERSIONS_BUCKET_ENDPOINT
  S3_VERSIONS_BUCKET_ACCESS_KEY_ID
  S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY

You can add them to .env or export them directly.
EOF
        exit 1
    fi

    # Build upload flags
    UPLOAD_FLAGS="--electron"
    [ "$UPLOAD_LATEST" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --latest"
    [ "$UPLOAD_SCRIPT" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --script"

    cd "$ROOT_DIR"
    bun run scripts/upload.ts $UPLOAD_FLAGS

    echo ""
    echo "=== Upload Complete ==="
fi
