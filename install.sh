#!/usr/bin/env sh

# Prompt2Pwn CLI Install Script (Binary Distribution)
# Downloads precompiled binary from latest GitHub Release.

REPO="edelauna/prompt2pwn"
LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"
VERSION=$(curl -s "${LATEST_URL}" | grep '"tag_name"' | head -1 | cut -d '"' -f4)

if [ -z "${VERSION}" ]; then
  echo "❌ No releases found. Visit https://github.com/${REPO}/releases"
  exit 1
fi

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case $OS in
  darwin)
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
      SUFFIX="darwin-arm64"
    else
      SUFFIX="darwin-amd64"
    fi
    ;;
  linux)
    SUFFIX="linux-amd64"
    ;;
  windows* | mingw* | msys*)
    SUFFIX="windows-amd64.exe"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

BINARY="prompt2pwn-${SUFFIX}"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"

echo "🔧 Downloading ${BINARY} from ${URL} (${VERSION})"
echo "🐳 Note: This tool requires Docker. It will pull images from Docker Hub on first run."

curl -L -o "${BINARY}" "${URL}" || {
  echo "❌ Download failed. Ensure release ${VERSION} has assets. Check https://github.com/${REPO}/releases/tag/${VERSION}"
  exit 1
}

chmod +x "${BINARY}"

sudo mv "${BINARY}" /usr/local/bin/prompt2pwn || mv "${BINARY}" ~/bin/prompt2pwn  # Fallback

echo "✅ Installed! Run \`prompt2pwn --help\`"
echo "💡 Release: https://github.com/${REPO}/releases/tag/${VERSION}"
