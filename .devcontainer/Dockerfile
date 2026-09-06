# ============================================================
# App container for GitHub Codespaces / Dev Containers.
# Based on the JavaScript/Node devcontainer image so the Codespace
# has Node, npm, git and a 'node' user (UID 1000) that can write to
# the mounted workspace.
# ============================================================

FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm

# Make sure git + curl are present (already in the base image, but be safe).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# The image's default user is 'node' (UID 1000), which matches the
# Codespaces user so bind-mounted workspaces are writable.
