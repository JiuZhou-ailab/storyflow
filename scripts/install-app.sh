#!/bin/bash
# input: Host platform details and release metadata from the Craft Agents update endpoint
# output: A compatible Craft Agents desktop installation or a clear preflight failure
# pos: User-facing installer that selects the correct release artifact for this machine

set -e

RELEASE_DOWNLOAD_URL="https://github.com/JiuZhou-ailab/craft-agents-oss/releases/latest/download"
DOWNLOAD_DIR="$HOME/.craft-agent/downloads"
MIN_MACOS_VERSION="12.0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info() { printf "%b\n" "${BLUE}>${NC} $1"; }
success() { printf "%b\n" "${GREEN}>${NC} $1"; }
warn() { printf "%b\n" "${YELLOW}!${NC} $1"; }
error() { printf "%b\n" "${RED}x${NC} $1"; exit 1; }

verify_macos_app_trust() {
    local app_path="$1"

    info "Verifying macOS app signature..."
    codesign --verify --deep --strict "$app_path" >/dev/null

    info "Checking macOS Gatekeeper trust..."
    spctl --assess --type execute "$app_path" >/dev/null
}

version_at_least() {
    local current="$1"
    local required="$2"

    awk -v current="$current" -v required="$required" '
        BEGIN {
            split(current, c, ".");
            split(required, r, ".");
            for (i = 1; i <= 3; i++) {
                cv = (c[i] == "" ? 0 : c[i]) + 0;
                rv = (r[i] == "" ? 0 : r[i]) + 0;
                if (cv > rv) exit 0;
                if (cv < rv) exit 1;
            }
            exit 0;
        }
    '
}

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin) OS_TYPE="darwin" ;;
    Linux)  OS_TYPE="linux" ;;
    *)      error "Unsupported operating system: $OS" ;;
esac

# Check for required dependencies
DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    error "Either curl or wget is required but neither is installed"
fi

# Check if yq is available (optional, for YAML parsing)
HAS_YQ=false
if command -v yq >/dev/null 2>&1; then
    HAS_YQ=true
fi

# Download function that works with both curl and wget
# Usage: download_file <url> [output_file] [show_progress]
download_file() {
    local url="$1"
    local output="$2"
    local show_progress="${3:-false}"

    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            if [ "$show_progress" = "true" ]; then
                curl -fL --progress-bar -o "$output" "$url"
            else
                curl -fsSL -o "$output" "$url"
            fi
        else
            curl -fsSL "$url"
        fi
    elif [ "$DOWNLOADER" = "wget" ]; then
        if [ -n "$output" ]; then
            if [ "$show_progress" = "true" ]; then
                wget --show-progress -q -O "$output" "$url"
            else
                wget -q -O "$output" "$url"
            fi
        else
            wget -q -O - "$url"
        fi
    else
        return 1
    fi
}

# Extract sha512 from YAML for a specific architecture
# YAML format: files array with url, sha512, arch fields
get_sha512_from_yaml() {
    local yaml="$1"
    local target_arch="$2"

    # Find the line with the target arch and extract sha512 from preceding lines
    local in_target_block=false
    local sha512=""

    while IFS= read -r line; do
        # Check if we're entering a new file entry
        if [[ $line =~ ^[[:space:]]*-[[:space:]]*url: ]]; then
            in_target_block=false
            sha512=""
        fi
        # Extract sha512
        if [[ $line =~ sha512:[[:space:]]*(.+) ]]; then
            sha512="${BASH_REMATCH[1]}"
        fi
        # Check arch
        if [[ $line =~ arch:[[:space:]]*(.+) ]]; then
            local arch="${BASH_REMATCH[1]}"
            if [ "$arch" = "$target_arch" ] && [ -n "$sha512" ]; then
                echo "$sha512"
                return 0
            fi
        fi
    done <<< "$yaml"

    return 1
}

# Extract filename from YAML for a specific architecture
get_filename_from_yaml() {
    local yaml="$1"
    local target_arch="$2"

    local url=""

    while IFS= read -r line; do
        # Check if we're entering a new file entry
        if [[ $line =~ ^[[:space:]]*-[[:space:]]*url:[[:space:]]*(.+) ]]; then
            url="${BASH_REMATCH[1]}"
        fi
        # Check arch
        if [[ $line =~ arch:[[:space:]]*(.+) ]]; then
            local arch="${BASH_REMATCH[1]}"
            if [ "$arch" = "$target_arch" ] && [ -n "$url" ]; then
                echo "$url"
                return 0
            fi
        fi
    done <<< "$yaml"

    return 1
}

ensure_single_manifest_value() {
    local value="$1"
    local description="$2"

    if [ -z "$value" ]; then
        error "Expected exactly one .zip artifact for architecture $arch in $yml_file, but found none"
    fi

    case "$value" in
        *$'\n'*)
            error "Expected exactly one .zip artifact for architecture $arch in $yml_file, but found multiple $description values"
            ;;
    esac
}

# Detect architecture
case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
esac

# Set platform-specific variables
if [ "$OS_TYPE" = "darwin" ]; then
    macos_version="$(sw_vers -productVersion 2>/dev/null || echo "")"
    if [ -z "$macos_version" ]; then
        error "Unable to detect macOS version"
    fi
    if ! version_at_least "$macos_version" "$MIN_MACOS_VERSION"; then
        error "Craft Agents requires macOS $MIN_MACOS_VERSION or newer. Detected macOS $macos_version on this Mac."
    fi

    platform="darwin-${arch}"
    APP_NAME="Craft Agents.app"
    INSTALL_DIR="/Applications"
    ext="zip"
    yml_file="latest-mac.yml"
else
    # Linux only supports x64 currently
    if [ "$arch" != "x64" ]; then
        error "Linux currently only supports x64 architecture. Your architecture: $arch"
    fi
    platform="linux-${arch}"
    APP_NAME="Craft-Agents-x64.AppImage"
    INSTALL_DIR="$HOME/.local/bin"
    ext="AppImage"
    yml_file="latest-linux.yml"
fi

echo ""
if [ "$OS_TYPE" = "darwin" ]; then
    info "Detected platform: $platform (macOS $macos_version)"
else
    info "Detected platform: $platform"
fi

mkdir -p "$DOWNLOAD_DIR"
mkdir -p "$INSTALL_DIR"

# Fetch YAML manifest directly from the latest GitHub Release assets.
info "Fetching release info..."
manifest_yaml=$(download_file "$RELEASE_DOWNLOAD_URL/$yml_file")

if [ -z "$manifest_yaml" ]; then
    error "Failed to fetch release info from $yml_file"
fi

# Extract version from YAML manifest
if [ "$HAS_YQ" = true ]; then
    version=$(echo "$manifest_yaml" | yq -r '.version // empty')
else
    version=$(echo "$manifest_yaml" | grep -m1 '^version:' | sed 's/^version:[[:space:]]*//')
fi

if [ -z "$version" ]; then
    error "Failed to extract version from manifest"
fi

info "Latest version: $version"

# Extract sha512 and filename for our architecture
if [ "$HAS_YQ" = true ]; then
    checksum=$(echo "$manifest_yaml" | yq -r ".files[] | select(.arch == \"$arch\" and (.url | endswith(\".zip\"))) | .sha512")
    filename=$(echo "$manifest_yaml" | yq -r ".files[] | select(.arch == \"$arch\" and (.url | endswith(\".zip\"))) | .url")
    ensure_single_manifest_value "$checksum" "checksum"
    ensure_single_manifest_value "$filename" "filename"
else
    checksum=$(get_sha512_from_yaml "$manifest_yaml" "$arch")
    filename=$(get_filename_from_yaml "$manifest_yaml" "$arch")
fi

# Validate checksum format (SHA512 base64 = 88 characters)
if [ -z "$checksum" ] || [ ${#checksum} -lt 80 ]; then
    error "Architecture $arch not found in $yml_file. This release may be missing the $platform artifact."
fi

# Use default filename if not found
if [ -z "$filename" ]; then
    filename="Craft-Agents-${arch}.${ext}"
fi

info "Expected sha512: ${checksum:0:20}..."

# Download installer
installer_url="$RELEASE_DOWNLOAD_URL/$filename"
installer_path="$DOWNLOAD_DIR/$filename"

info "Downloading $filename..."
echo ""
if ! download_file "$installer_url" "$installer_path" true; then
    rm -f "$installer_path"
    error "Download failed"
fi
echo ""

# Verify checksum (sha512, base64 encoded)
info "Verifying checksum..."
if [ "$OS_TYPE" = "darwin" ]; then
    # macOS: shasum outputs hex, convert to base64
    actual=$(shasum -a 512 "$installer_path" | cut -d' ' -f1 | xxd -r -p | base64)
else
    # Linux: sha512sum outputs hex, convert to base64
    actual=$(sha512sum "$installer_path" | cut -d' ' -f1 | xxd -r -p | base64 | tr -d '\n')
fi

if [ "$actual" != "$checksum" ]; then
    rm -f "$installer_path"
    error "Checksum verification failed\n  Expected: $checksum\n  Actual:   $actual"
fi

success "Checksum verified!"

# Platform-specific installation
if [ "$OS_TYPE" = "darwin" ]; then
    # macOS installation (from ZIP)
    zip_path="$installer_path"

    # Extract ZIP to temp directory
    info "Extracting..."
    temp_dir=$(mktemp -d)
    if ! unzip -q "$zip_path" -d "$temp_dir"; then
        rm -rf "$temp_dir"
        rm -f "$zip_path"
        error "Failed to extract ZIP"
    fi

    # Find the .app in the extracted contents
    app_source=$(find "$temp_dir" -maxdepth 1 -name "*.app" -type d | head -1)

    if [ -z "$app_source" ]; then
        rm -rf "$temp_dir"
        rm -f "$zip_path"
        error "No .app found in ZIP"
    fi

    verify_macos_app_trust "$app_source"

    install_temp_dir=$(mktemp -d "$INSTALL_DIR/.craft-agents-install.XXXXXX")
    backup_temp_dir=$(mktemp -d "$INSTALL_DIR/.craft-agents-backup.XXXXXX")
    staged_app="$install_temp_dir/$APP_NAME"
    backup_app="$backup_temp_dir/$APP_NAME"
    preserve_backup=false

    cleanup_install_temps() {
        rm -rf "$install_temp_dir"
        if [ "$preserve_backup" != true ]; then
            rm -rf "$backup_temp_dir"
        fi
    }
    trap cleanup_install_temps EXIT

    info "Staging app for installation..."
    cp -R "$app_source" "$staged_app"

    # Quit the app only after the replacement bundle has been extracted and trusted.
    APP_BUNDLE_ID="com.lukilabs.craft-agent"
    if pgrep -x "Craft Agents" >/dev/null 2>&1; then
        info "Quitting Craft Agents..."
        osascript -e "tell application id \"$APP_BUNDLE_ID\" to quit" 2>/dev/null || true
        # Wait for app to quit (max 5 seconds) - POSIX compatible loop
        i=0
        while [ $i -lt 10 ]; do
            if ! pgrep -x "Craft Agents" >/dev/null 2>&1; then
                break
            fi
            sleep 0.5
            i=$((i + 1))
        done
        # Force kill if still running
        if pgrep -x "Craft Agents" >/dev/null 2>&1; then
            warn "App didn't quit gracefully. Force quitting (unsaved data may be lost)..."
            pkill -9 -x "Craft Agents" 2>/dev/null || true
            # Wait longer for macOS to release file handles
            sleep 3
        fi
    fi

    # Remove existing installation only after the staged replacement is ready.
    if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
        info "Removing previous installation..."
        mv "$INSTALL_DIR/$APP_NAME" "$backup_app"
    fi

    # Copy app to /Applications
    info "Installing to $INSTALL_DIR..."
    if ! mv "$staged_app" "$INSTALL_DIR/$APP_NAME"; then
        if [ -d "$backup_app" ] && [ ! -d "$INSTALL_DIR/$APP_NAME" ]; then
            if mv "$backup_app" "$INSTALL_DIR/$APP_NAME"; then
                backup_app=""
            else
                preserve_backup=true
                warn "Previous installation backup remains at $backup_app"
            fi
        fi
        error "Failed to install Craft Agents. Previous installation was restored if it existed."
    fi

    # Clean up
    info "Cleaning up..."
    rm -rf "$temp_dir"
    rm -f "$zip_path"
    cleanup_install_temps
    trap - EXIT

    # Remove quarantine attribute if present
    xattr -rd com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

    echo ""
    echo "─────────────────────────────────────────────────────────────────────────"
    echo ""
    success "Installation complete!"
    echo ""
    printf "%b\n" "  Craft Agents has been installed to ${BOLD}$INSTALL_DIR/$APP_NAME${NC}"
    echo ""
    printf "%b\n" "  You can launch it from ${BOLD}Applications${NC} or by running:"
    printf "%b\n" "    ${BOLD}open -a 'Craft Agents'${NC}"
    echo ""

else
    # Linux installation
    appimage_path="$installer_path"

    # New paths
    APP_DIR="$HOME/.craft-agent/app"
    WRAPPER_PATH="$INSTALL_DIR/craft-agents"
    APPIMAGE_INSTALL_PATH="$APP_DIR/Craft-Agents-x64.AppImage"

    # Kill the app if it's running
    if pgrep -f "Craft-Agent.*AppImage" >/dev/null 2>&1; then
        info "Stopping Craft Agents..."
        pkill -f "Craft-Agent.*AppImage" 2>/dev/null || true
        sleep 2
    fi

    # Create directories
    mkdir -p "$APP_DIR"
    mkdir -p "$INSTALL_DIR"

    # Remove existing AppImage
    [ -f "$APPIMAGE_INSTALL_PATH" ] && rm -f "$APPIMAGE_INSTALL_PATH"

    # Install AppImage
    info "Installing AppImage to $APP_DIR..."
    mv "$appimage_path" "$APPIMAGE_INSTALL_PATH"
    chmod +x "$APPIMAGE_INSTALL_PATH"

    # Create wrapper script
    info "Creating launcher at $WRAPPER_PATH..."
    cat > "$WRAPPER_PATH" << 'WRAPPER_EOF'
#!/bin/bash
# Craft Agent launcher - handles Linux-specific AppImage issues

APPIMAGE_PATH="$HOME/.craft-agent/app/Craft-Agents-x64.AppImage"
ELECTRON_CACHE="$HOME/.config/@craft-agent"
ELECTRON_CACHE_ALT="$HOME/.cache/@craft-agent"

# Verify AppImage exists
if [ ! -f "$APPIMAGE_PATH" ]; then
    echo "Error: Craft Agent not found at $APPIMAGE_PATH"
    echo "Reinstall: curl -fsSL $RELEASE_DOWNLOAD_URL/install-app.sh | bash"
    exit 1
fi

# Ensure DISPLAY is set (required for X11)
if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0.0
fi

# Clear stale cache referencing AppImage mount paths
# AppImage creates a new /tmp/.mount_Craft-XXXX each launch, so any cached path is stale
for cache_dir in "$ELECTRON_CACHE" "$ELECTRON_CACHE_ALT"; do
    if [ -d "$cache_dir" ] && grep -rq '/tmp/\.mount_Craft' "$cache_dir" 2>/dev/null; then
        rm -rf "$cache_dir"
    fi
done

# Set APPIMAGE for auto-update
export APPIMAGE="$APPIMAGE_PATH"

# Launch with --no-sandbox (AppImage extracts to /tmp, losing SUID on chrome-sandbox)
exec "$APPIMAGE_PATH" --no-sandbox "$@"
WRAPPER_EOF

    chmod +x "$WRAPPER_PATH"

    # Migrate old installation
    OLD_APPIMAGE="$INSTALL_DIR/Craft-Agents-x64.AppImage"
    [ -f "$OLD_APPIMAGE" ] && rm -f "$OLD_APPIMAGE"

    echo ""
    echo "─────────────────────────────────────────────────────────────────────────"
    echo ""
    success "Installation complete!"
    echo ""
    printf "%b\n" "  AppImage: ${BOLD}$APPIMAGE_INSTALL_PATH${NC}"
    printf "%b\n" "  Launcher: ${BOLD}$WRAPPER_PATH${NC}"
    echo ""
    printf "%b\n" "  Run with: ${BOLD}craft-agents${NC}"
    echo ""
    printf "%b\n" "  Add to PATH if needed:"
    printf "%b\n" "    ${BOLD}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc${NC}"
    echo ""

    # FUSE check
    if ! command -v fusermount >/dev/null 2>&1; then
        warn "FUSE required but not detected."
        printf "%b\n" "  Install: ${BOLD}sudo apt install fuse libfuse2${NC} (Debian/Ubuntu)"
        printf "%b\n" "           ${BOLD}sudo dnf install fuse fuse-libs${NC} (Fedora)"
    fi
fi
