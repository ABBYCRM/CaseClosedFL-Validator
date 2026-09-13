FROM golang:1.22-bookworm AS osint-go
# Mosint has no linux/amd64 release tarball; official install is `go install`.
ENV CGO_ENABLED=0
ARG MOSINT_VERSION=v3.0.0
RUN GOBIN=/out go install "github.com/alpkeskin/mosint/v3/cmd/mosint@${MOSINT_VERSION}"

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOME=/home/node \
    PATH="/usr/local/bin:${PATH}"

# FREE OSINT CLIs on PATH for DigitalOcean App Platform (no docker-in-docker).
# Holehe + h8mail via Python venv; PhoneInfoga official linux binary; Mosint from osint-go.
# Runtime adapters still soft-fail if a tool errors. npm build/test do not require these CLIs.
ARG PHONEINFOGA_VERSION=v2.11.0
ARG HOLEHE_VERSION=1.61
ARG H8MAIL_VERSION=2.5.6
ARG TARGETARCH=amd64
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      python3 \
      python3-pip \
      python3-venv; \
    python3 -m venv /opt/osint; \
    /opt/osint/bin/pip install --no-cache-dir --upgrade pip; \
    /opt/osint/bin/pip install --no-cache-dir "holehe==${HOLEHE_VERSION}" "h8mail==${H8MAIL_VERSION}"; \
    ln -sf /opt/osint/bin/holehe /usr/local/bin/holehe; \
    ln -sf /opt/osint/bin/h8mail /usr/local/bin/h8mail; \
    case "${TARGETARCH}" in \
      amd64|x86_64) pf_arch=x86_64 ;; \
      arm64|aarch64) pf_arch=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    tmp="$(mktemp -d)"; \
    curl -fsSL "https://github.com/sundowndev/phoneinfoga/releases/download/${PHONEINFOGA_VERSION}/phoneinfoga_Linux_${pf_arch}.tar.gz" -o "${tmp}/phoneinfoga_Linux_${pf_arch}.tar.gz"; \
    curl -fsSL "https://github.com/sundowndev/phoneinfoga/releases/download/${PHONEINFOGA_VERSION}/phoneinfoga_checksums.txt" -o "${tmp}/phoneinfoga_checksums.txt"; \
    (cd "${tmp}" && sha256sum --ignore-missing -c phoneinfoga_checksums.txt); \
    tar -xzf "${tmp}/phoneinfoga_Linux_${pf_arch}.tar.gz" -C /usr/local/bin phoneinfoga; \
    chmod 0755 /usr/local/bin/phoneinfoga; \
    rm -rf "${tmp}" /root/.cache /opt/osint/share /opt/osint/lib/python*/ensurepip; \
    apt-get purge -y --auto-remove curl python3-pip python3-venv; \
    rm -rf /var/lib/apt/lists/*

COPY --from=osint-go /out/mosint /usr/local/bin/mosint
RUN chmod 0755 /usr/local/bin/mosint \
    && mkdir -p /home/node \
    && printf '%s\n' \
      '# Free-only Mosint config. Paid Hunter/HIBP/IntelX/etc. keys are out of scope.' \
      'services:' \
      '  breach_directory_api_key: ""' \
      '  emailrep_api_key: ""' \
      '  hunter_api_key: ""' \
      '  intelx_api_key: ""' \
      '  haveibeenpwned_api_key: ""' \
      'settings:' \
      '  intelx_max_results: 10' \
      > /home/node/.mosint.yaml \
    && chown node:node /home/node/.mosint.yaml \
    && chmod 0644 /home/node/.mosint.yaml \
    && chmod -R a+rX /opt/osint

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/knowledge ./knowledge
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
EXPOSE 8080
USER node
# Fail the image build if a FREE CLI is missing from PATH for the production user.
RUN holehe --help >/tmp/osint-holehe.help \
    && h8mail -h >/tmp/osint-h8mail.help \
    && phoneinfoga version \
    && mosint -h >/tmp/osint-mosint.help \
    && command -v holehe \
    && command -v h8mail \
    && command -v phoneinfoga \
    && command -v mosint
CMD ["sh","-c","node dist/scripts/migrate.js && exec node dist/src/server.js"]
