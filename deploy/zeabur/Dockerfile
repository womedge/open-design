ARG NODE_IMAGE=docker.io/library/node:24-alpine
ARG RUNTIME_IMAGE=docker.io/library/node:24-alpine

FROM ${NODE_IMAGE} AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG NO_PROXY

ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${http_proxy}
ENV https_proxy=${https_proxy}
ENV no_proxy=${no_proxy}
ENV NO_PROXY=${NO_PROXY}
ENV CI=true

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.mjs ./scripts/
COPY packages ./packages
COPY tools ./tools
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN corepack enable && \
    corepack prepare pnpm@10.33.2 --activate && \
    pnpm install --frozen-lockfile

COPY apps ./apps
# Self-hosted: hide the OpenDesign Cloud sign-up callouts (see
# apps/web/src/utils/cloudPromo.ts). Inlined into the static web export.
ENV NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO=1
# Product branding: "AWP+" with "OpenDesign" as the subtitle (apps/web/src/utils/brand.ts).
ENV NEXT_PUBLIC_OD_BRAND_NAME=AWP+
RUN pnpm --filter @open-design/daemon build && \
    pnpm --filter @open-design/web build && \
    pnpm --filter @open-design/daemon deploy --legacy --prod /app/deploy/daemon && \
    pnpm store prune && \
    rm -rf \
      /root/.cache \
      /root/.local/share/pnpm/store \
      /app/deploy/daemon/node_modules/.cache \
      /app/deploy/daemon/node_modules/@types \
      /app/deploy/daemon/node_modules/.pnpm/@types+* \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/src && \
    find /app/deploy/daemon/node_modules -type d \( \
      -name test -o \
      -name tests -o \
      -name "__tests__" -o \
      -name docs -o \
      -name doc -o \
      -name example -o \
      -name examples -o \
      -name ".github" \
    \) -prune -exec rm -rf '{}' + && \
    find /app/deploy/daemon/node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "*.d.ts" -o \
      -name "*.d.cts" -o \
      -name "*.d.mts" -o \
      -name "*.map" -o \
      -name "*.tsbuildinfo" -o \
      -name "binding.gyp" \
    \) -delete

# Stage-2 assets — copied into the build stage so the runtime stage
# can pull them via --from=build instead of reaching back into the
# build context.  This lets the Dockerfile work when the build context
# differs from the repo root (Railway, CI runners with a subdirectory
# context, etc.).
COPY skills ./skills
COPY design-systems ./design-systems
COPY craft ./craft
COPY prompt-templates ./prompt-templates
COPY assets ./assets
# `data/plugin-previews/manifest.json` is committed by the bake pipeline and is
# what `resolvePluginPreviewsDir()` looks for at runtime. Without it in the
# image, `loadManifest()` returns `{}` and every plugin silently falls back to
# the live-iframe preview path — the exact cost the bakes exist to avoid.
COPY data ./data
COPY plugins/_official ./plugins/_official

FROM ${RUNTIME_IMAGE}

# Zeabur variant of deploy/Dockerfile. Differences from the base image:
#   1. Claude Code from Anthropic's signed apk repository, with the Alpine
#      runtime deps from https://code.claude.com/docs/en/setup. Authenticate
#      with CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
#   2. OpenCode from npm (musl build), so API-key (BYOK) runs work.
#   3. A real home directory for the open-design user, plus everyday CLI
#      tools agents reach for (curl, file, python3, jq).
#   4. entrypoint.sh starts as root, fixes ownership of writable paths, then
#      drops to open-design via su-exec. Zeabur runs containers as root
#      regardless of USER, and Claude Code refuses bypassPermissions as root.
#   5. Headless Chromium (Alpine's package, with CJK/emoji fonts), the
#      od-screenshot helper and playwright-core, so agents can screenshot the
#      pages they build. Playwright's own browser downloads do not support
#      Alpine/musl; everything points at the system binary via CHROME_PATH.
#      Plus image/video/font tools, opencc, zip and gh (see below).
#      agent-instructions.md tells Claude Code and OpenCode what is there.
#   6. entrypoint.sh also records every daemon exit (code/signal + last output
#      lines) under $OD_DATA_DIR/diagnostics, since Zeabur keeps few logs.
ARG CLAUDE_CODE_APK_CHANNEL=stable
ARG OPENCODE_VERSION=1.18.35
RUN apk add --no-cache tini poppler-utils bash git su-exec libgcc libstdc++ ripgrep \
      curl file python3 jq && \
    wget -qO /etc/apk/keys/claude-code.rsa.pub https://downloads.claude.ai/keys/claude-code.rsa.pub && \
    echo "395759c1f7449ef4cdef305a42e820f3c766d6090d142634ebdb049f113168b6  /etc/apk/keys/claude-code.rsa.pub" | sha256sum -c - && \
    echo "https://downloads.claude.ai/claude-code/apk/${CLAUDE_CODE_APK_CHANNEL}" >> /etc/apk/repositories && \
    apk add --no-cache claude-code && \
    claude --version && \
    npm install -g "opencode-ai@${OPENCODE_VERSION}" && \
    npm cache clean --force && \
    opencode --version && \
    addgroup -S -g 1001 open-design && \
    adduser -S -D -h /home/open-design -u 1001 -G open-design open-design

# Tools agents reach for while building and checking pages: headless browser
# + CJK/emoji fonts, image/video/font processing, zh-CN<->zh-TW conversion,
# zip and the GitHub CLI (gh; not authenticated here). Agents run as
# open-design and cannot apk add, so what they need has to be baked in.
ARG PLAYWRIGHT_CORE_VERSION=1.63.0
RUN apk add --no-cache chromium font-noto-cjk font-noto-emoji font-liberation \
      imagemagick ffmpeg py3-pillow py3-numpy py3-fonttools py3-pip opencc zip github-cli && \
    chromium --version && \
    npm install -g "playwright-core@${PLAYWRIGHT_CORE_VERSION}" && \
    npm cache clean --force
ENV CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_PATH=/usr/local/lib/node_modules
COPY --chmod=0755 deploy/zeabur/od-screenshot /usr/local/bin/od-screenshot
# User-level instructions: Claude Code reads ~/.claude/CLAUDE.md; OpenCode
# reads ~/.config/opencode/AGENTS.md (it no longer falls back to CLAUDE.md).
COPY --chown=open-design:open-design deploy/zeabur/agent-instructions.md /home/open-design/.claude/CLAUDE.md
COPY --chown=open-design:open-design deploy/zeabur/agent-instructions.md /home/open-design/.config/opencode/AGENTS.md

WORKDIR /app
COPY --from=build --chown=open-design:open-design /app/deploy/daemon ./apps/daemon
COPY --from=build --chown=open-design:open-design /app/apps/web/out ./apps/web/out
COPY --from=build --chown=open-design:open-design /app/skills ./skills
COPY --from=build --chown=open-design:open-design /app/design-systems ./design-systems
COPY --from=build --chown=open-design:open-design /app/craft ./craft
COPY --from=build --chown=open-design:open-design /app/prompt-templates ./prompt-templates
COPY --from=build --chown=open-design:open-design /app/data ./data
COPY --from=build --chown=open-design:open-design /app/assets/frames ./assets/frames
COPY --from=build --chown=open-design:open-design /app/assets/community-pets ./assets/community-pets
# Plan §3.J4 / spec §23.3.5 — bundled atom plugins registered on
# daemon boot. The directory contains `plugins/_official/atoms/<atom>/`
# pairs (SKILL.md + open-design.json); registerBundledPlugins() walks
# it on startup so the container ships with first-party atoms reachable
# via the same registry path third-party plugins use.
COPY --from=build --chown=open-design:open-design /app/plugins/_official ./plugins/_official

RUN mkdir -p /app/.od && \
    chown -R open-design:open-design /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV OD_BIND_HOST=0.0.0.0
ENV OD_PORT=7456
ENV USE_BUILTIN_RIPGREP=0
ENV DISABLE_AUTOUPDATER=1

COPY --chmod=0755 deploy/zeabur/entrypoint.sh /usr/local/bin/od-entrypoint

EXPOSE 7456

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/od-entrypoint"]
CMD ["node", "apps/daemon/dist/cli.js", "--no-open"]
