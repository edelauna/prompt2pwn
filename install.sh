#!/usr/bin/env sh

set -e # Exit immediately if a command fails

# Prompt2Pwn CLI Install Script (Binary Distribution)
# Downloads precompiled binary from latest GitHub Release.

REPO="edelauna/prompt2pwn"
LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"

# 1. Fetch version with rate limit check
JSON=$(curl -s "${LATEST_URL}")
VERSION=$(echo "$JSON" | grep '"tag_name"' | head -1 | cut -d '"' -f4)

if [ -z "${VERSION}" ]; then
  if echo "$JSON" | grep -q "rate limit"; then
    echo "❌ GitHub API rate limit exceeded. Try again later or set a GITHUB_TOKEN."
  else
    echo "❌ Could not fetch latest version. Visit https://github.com/${REPO}/releases"
  fi
  exit 1
fi

# 2. Check for Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "🐳 Warning: Docker is not installed. This tool requires Docker to function."
fi

# 3. Improved Architecture Detection
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $OS in
  darwin)
    [ "$ARCH" = "arm64" ] && SUFFIX="darwin-arm64" || SUFFIX="darwin-amd64"
    ;;
  linux)
    [ "$ARCH" = "aarch64" ] && SUFFIX="linux-arm64" || SUFFIX="linux-amd64"
    ;;
  *)
    echo "Unsupported OS: $OS. For Windows, download the .exe from GitHub releases."
    exit 1
    ;;
esac

BINARY_NAME="prompt2pwn"
DOWNLOAD_NAME="prompt2pwn-${SUFFIX}"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${DOWNLOAD_NAME}"

echo "🔧 Downloading ${DOWNLOAD_NAME} from ${URL} (${VERSION})"

# 4. Download to a temp file first
TEMP_BIN=$(mktemp)
curl -L -o "${TEMP_BIN}" "${URL}" || {
  echo "❌ Download failed. Ensure release ${VERSION} has assets. Check https://github.com/${REPO}/releases/tag/${VERSION}"
  exit 1
}

chmod +x "${TEMP_BIN}"
mkdir -p "$HOME/.local/bin"
mv "${TEMP_BIN}" "$HOME/.local/bin/${BINARY_NAME}"

echo "✅ Installed to ~/.local/bin/${BINARY_NAME}"

# 5. Path Check
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
  echo "💡 Note: ~/.local/bin is not in your PATH. Add it by running:"
  echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo "💡 Release: https://github.com/${REPO}/releases/tag/${VERSION}"
