#!/usr/bin/env bash
# Drive the containerised server through an MCP `initialize` over stdio.
#
# This exercises three things a build alone does not: that the pruned
# production dependency tree is complete, that the unprivileged `node` user can
# write the log and cache paths, and that nothing pollutes stdout — a single
# stray line there corrupts the JSON-RPC channel.
set -euo pipefail

IMAGE="${1:-abs-mcp-server:smoke-test}"

request='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke-test","version":"0"}}}'

# An empty volume, so the run also proves the writable paths are created from
# scratch rather than relying on directories baked into the image.
volume="abs-mcp-smoke-$$"
docker volume create "$volume" >/dev/null
trap 'docker volume rm -f "$volume" >/dev/null 2>&1 || true' EXIT

output=$(printf '%s\n' "$request" | timeout 60 docker run -i --rm -v "$volume:/data" "$IMAGE")

echo "--- server stdout ---"
echo "$output"
echo "---------------------"

if ! echo "$output" | grep -q '"serverInfo"'; then
    echo "FAIL: initialize response did not contain serverInfo" >&2
    exit 1
fi

# Every line on stdout must be a JSON-RPC message; anything else is a log leak.
while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! echo "$line" | grep -q '^{"result"\|^{"jsonrpc"\|^{"id"'; then
        echo "FAIL: non-JSON-RPC line on stdout: $line" >&2
        exit 1
    fi
done <<< "$output"

echo "PASS: stdio handshake returned serverInfo with a clean stdout"
