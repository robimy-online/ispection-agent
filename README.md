# ispection agent

Lightweight ISP-reliability monitoring agent. It runs on your own hardware (NAS, mini-PC,
terminal, VPS), periodically measures the quality of your internet link, and ships
**Ed25519-signed** measurements to an [ispection](https://ispection.robimy.online) collector.
A durable local buffer makes it resilient to short outages.

## What it measures

- **Availability & latency** — uptime, RTT, packet loss (ICMP `ping`, with a TCP-connect fallback when ping is unavailable).
- **Application layer** — DNS resolution time, HTTP TTFB, TLS handshake time.
- **Path** — traceroute per-hop, bottleneck / route-change detection.
- **Throughput** — download & upload vs. contracted rates, plus bufferbloat (latency under load).
- **IPv6** — reachability & quality parity against IPv4.
- **Neutrality** — per-port reachability (detects port blocking) and DNS integrity (ISP vs. public resolver, NXDOMAIN-hijack detection, DoH reachability).
- **Anti-identification** (opt-in) — target rotation from an anycast pool + schedule jitter, so an ISP can't single out and favor probe traffic.

## How it works

1. **First run** generates its own Ed25519 keypair (`agent-key.pem`, mode `0600`, in the data dir) and enrolls
   (`POST /agents/enroll`) using a one-time `CLAIM_CODE` from the panel.
2. **Loop** (every `INGEST_INTERVAL_SEC`): measure targets → append samples to a durable local buffer →
   sign `${ts}.${seq}.${body}` and `POST /ingest` in batches. Samples are dropped from the buffer only after an
   HTTP 2xx (offline resilience). Live status changes are pushed over a WebSocket.

## Quickstart (Docker)

```bash
docker run -d --name ispection-agent --restart unless-stopped \
  -e CLAIM_CODE=<code-from-panel> \
  -v ispection-agent:/data \
  ghcr.io/robimy-online/ispection-agent:latest
```

Or with Compose — copy [`docker-compose.yml`](docker-compose.yml), set `CLAIM_CODE`, then:

```bash
docker compose up -d
```

`INGEST_URL` defaults to the hosted ispection service, so you normally only need a `CLAIM_CODE`
(from the panel's "Add agent" dialog). Point `INGEST_URL` at your own collector if you self-host the backend.
The `/data` volume (Ed25519 key + buffer + meta) **must survive restarts**.

## Configuration (environment variables)

| Variable | Default | Description |
| --- | --- | --- |
| `INGEST_URL` | `https://ispection.robimy.online/api` | Collector base URL |
| `CLAIM_CODE` | — | One-time enrollment code from the panel (first run only) |
| `TARGETS` | `1.1.1.1,8.8.8.8` | Measurement targets (comma-separated) |
| `INGEST_INTERVAL_SEC` | `30` | Measurement cycle interval |
| `PING_COUNT` | `5` | ICMP packets per target |
| `AGENT_DATA_DIR` | `~/.ispection-agent` | Directory for key, buffer, meta (`/data` in Docker) |
| `INGEST_INSECURE` | `false` | `true` = HTTP, skip cert pinning (dev only) |
| `INGEST_PIN_SPKI` | — | base64 SHA-256 of the server SPKI (prod HTTPS pinning) |
| `RELEASE_PUBLIC_KEY` | — | base64 SPKI Ed25519 — verifies the signed self-update manifest |
| `UPDATE_MODE` | `notify` | `off` \| `notify` (log when outdated) \| `auto` (defer image swap to Watchtower) |
| `UPDATE_CHECK_INTERVAL_SEC` | `86400` | How often to poll `GET /agents/release` (ignored when `off`) |
| `INGEST_MAX_BATCH` | `500` | Max samples per flush |
| `HTTP_TARGET` | `https://www.google.com/generate_204` | Target for the DNS + TTFB/TLS probe |
| `TRACEROUTE_TARGET` | first of `TARGETS` | Traceroute target |
| `TRACEROUTE_INTERVAL_SEC` | `300` | Traceroute interval |
| `THROUGHPUT_URL` | Cloudflare speed | Download throughput test URL |
| `THROUGHPUT_INTERVAL_SEC` | `900` | Throughput test interval |
| `DECLARED_DOWN_MBPS` | — | Contracted download rate (for `% of contract ↓`) |
| `UPLOAD_URL` | `https://speed.cloudflare.com/__up` | Upload throughput test URL |
| `UPLOAD_BYTES` | `8000000` | Upload payload size (bytes) |
| `DECLARED_UP_MBPS` | — | Contracted upload rate (for `% of contract ↑`) |
| `IPV6_TARGET` | `2606:4700:4700::1111` | IPv6 literal for the parity probe (TCP :443) |
| `IPV4_BASELINE` | `1.1.1.1` | IPv4 literal of the same ISP (baseline) |
| `IPV6_INTERVAL_SEC` | `300` | IPv6 probe interval |
| `PORT_PROBES` | `1.1.1.1:443,1.1.1.1:53,8.8.8.8:443,8.8.8.8:53,93.184.216.34:80` | `host:port` list (neutrality/blocking). Add your own, e.g. `mail.example.com:25` |
| `PORT_PROBE_INTERVAL_SEC` | `600` | Port-probe interval |
| `DNS_TEST_DOMAIN` | `example.com` | Domain used to measure resolution time |
| `DNS_PUBLIC_SERVER` | `1.1.1.1` | Public resolver to compare against the ISP resolver |
| `DOH_URL` | `https://cloudflare-dns.com/dns-query` | DoH endpoint (detects encrypted-DNS blocking) |
| `DNS_CHECK_INTERVAL_SEC` | `600` | DNS-check interval |

### Remote config

The env vars above are **defaults**. The operator can override some of them from the panel (interval, ping count, targets);
the agent fetches them with a signed request on startup and refreshes every 15 minutes. Target/ping changes apply from the
next cycle; interval/jitter changes apply after an agent restart. Empty in the panel = the env value is kept.

### Anti-identification (opt-in, off by default)

Makes it harder for an ISP to recognize measurement traffic (and thus favor it). Off by default so dev/CI stays deterministic.

| Variable | Default | Description |
| --- | --- | --- |
| `ROTATE_TARGETS` | `false` | `true` = each cycle picks different targets from the pool instead of fixed `TARGETS` |
| `TARGET_POOL` | anycast pool | Pool of targets to rotate through (comma-separated) |
| `TARGETS_PER_CYCLE` | count of `TARGETS` | How many pool targets to measure per cycle |
| `SCHEDULE_JITTER_PCT` | `0` | Random interval jitter (0–0.5) so probes don't land on round seconds |

## Updates

Choose per install with `UPDATE_MODE` (default `notify`):

- **`notify` (default) — manual, with a heads-up.** The agent reports its version (enroll + `X-Agent-Version`
  header, so the panel flags outdated agents) and polls `GET /agents/release` on startup and every
  `UPDATE_CHECK_INTERVAL_SEC` (default daily), **logging the exact upgrade command** when a newer version exists.
  You update when you want: `docker compose pull && docker compose up -d`.
- **`auto` — hands-off.** Run [Watchtower](https://containrrr.dev/watchtower/) alongside the agent; it pulls new
  images and recreates the container for you. It's bundled behind a compose profile:
  ```bash
  docker compose --profile autoupdate up -d
  ```
  Watchtower runs with `--label-enable`, so it only touches the agent (labeled
  `com.centurylinklabs.watchtower.enable=true`) — never your other containers. A container can't swap itself from
  the inside, so `UPDATE_MODE=auto` on the agent just logs that Watchtower owns the swap.
- **`off` — pinned.** No checks, no logs. Pin the image to `:X.Y.Z` or a `@sha256:` digest and update deliberately.

Images are published to `ghcr.io/robimy-online/ispection-agent` on a `vX.Y.Z` git tag, tagged `X.Y.Z`, `X.Y`, `X`, and `latest`.
Pin to `:X.Y.Z` or a `@sha256:` digest for reproducibility; container images are cosign-signed (keyless, GitHub OIDC).

## Build from source

```bash
npm ci
npm run build && npm start
# or, without a build step:
npm run dev
```

Requires Node 22+ (global `fetch`/`WebSocket`).

### Native install (no Docker) — Linux / macOS

For bare machines/terminals without Docker. From the repo root:

```bash
sudo sh packaging/install.sh
# or pass values up front:
CLAIM_CODE=<code-from-panel> sudo -E sh packaging/install.sh
```

It copies the agent to `/opt/ispection-agent`, builds it, and installs a system service:
- **Linux (systemd):** user `ispection`, env in `/etc/ispection-agent.env`, service `ispection-agent`
  (`systemctl status ispection-agent`, `journalctl -u ispection-agent -f`).
- **macOS (launchd):** `/Library/LaunchDaemons/com.ispection.agent.plist`, logs in `/tmp/ispection-agent.log`.

**NAS (Synology/QNAP):** use the Docker image above — they support containers natively.

## Security & trust model

- **Per-agent identity:** an Ed25519 keypair generated on first run; the private key never leaves the machine.
- **Integrity & anti-replay in transit:** every batch is signed over `${ts}.${seq}.${body}`; a monotonic `seq` plus a
  timestamp window let the collector reject replays and tampered payloads.
- **Transport:** TLS with optional leaf-key **SPKI pinning** (`INGEST_PIN_SPKI`) for production; `INGEST_INSECURE` is dev-only.
- **Honest limitation:** the agent runs on client hardware, so a determined owner can extract the key and submit fabricated
  measurements. Signing gives integrity/anti-replay/anti-MITM, **not** fabrication resistance — that is mitigated on the
  server (cross-agent / per-ISP anomaly detection). This is inherent to any client-side measurement.
- **Release integrity:** published images are cosign-signed; an optional Ed25519-signed release manifest backs native self-update.

## License

[MIT](LICENSE) © robimy//online
