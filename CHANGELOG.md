# Changelog

All notable changes are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [0.2.0] — 2026-07-17

### Security & hardening
- **Remote config is now treated as a trust boundary.** Values pushed by the collector are
  range-clamped (`intervalSec` 5–86400, `pingCount` 1–20, `scheduleJitterPct` 0–0.5, declared
  speeds bounded) and every target is validated before it takes effect — a compromised or
  misbehaving server can no longer drive abusive intervals or hand flag-like strings to the probes.
- **Argument-injection guard on probes.** `ping`/`traceroute` targets are validated as IP/hostname
  and passed after a `--` separator (POSIX), so a target can never be read as a command-line flag.
- **Consistent TLS pinning on the live channel.** The `/agent-live` WebSocket now handshakes over a
  pinned `https.request` upgrade, honouring the same SPKI pin and CA validation as ingest (previously
  the WS was unpinned). Handshake auth is also sent as Upgrade headers (query params kept for
  backward compatibility).
- **Container runs unprivileged.** The image now runs as user `node` (uid 1000); Compose adds a
  read-only root FS, `no-new-privileges`, `cap_drop: ALL`, and a `ping_group_range` sysctl (ping via
  unprivileged ICMP datagram sockets, no `NET_RAW`). The Watchtower socket is mounted read-only with
  a stronger warning. **Breaking:** an existing root-owned `/data` volume must be chowned once —
  see the upgrade note in the README.
- Startup warns loudly when `INGEST_INSECURE=true` (pinning off + plain HTTP), and when a hosted
  `https` collector is used without `INGEST_PIN_SPKI` set.
- All numeric env vars are validated and range-clamped (`INGEST_INTERVAL_SEC`, `PING_COUNT`,
  intervals, `INGEST_MAX_BATCH`, `BUFFER_MAX`, `UPLOAD_BYTES`, …). A typo like `INGEST_INTERVAL_SEC=0`
  or a `NaN` can no longer turn a scheduler into a busy-loop that hammers the collector.
- Server-controlled strings (release manifest fields, error-response bodies) are sanitized
  (control chars stripped, truncated) before they are logged — no log/ANSI injection from a
  tampered collector response.
- State files (`meta.json`, `buffer.json`) are written `0600`, matching the private key.

### Reliability
- **Bounded buffer.** New `BUFFER_MAX` (default 50000) caps buffered samples; the oldest are dropped
  past the cap, bounding RAM/disk during a long outage.
- **Faster backlog drain.** `flush` now sends batches until the buffer is empty (or a send fails)
  instead of one batch per cycle, so a post-outage backlog clears quickly.
- `ping` falls back to TCP-connect timing (instead of reporting the target down) when it lacks ICMP
  privilege, and the bare `docker run` path now persists to `/data` by default (`AGENT_DATA_DIR`).
- Enrollment fails with a clear error instead of an unhandled `SyntaxError` when the collector
  returns a non-JSON 2xx body.
- Backlog drain is capped per cycle (and the live-channel reconnect is jittered) so a whole fleet
  recovering from a collector outage doesn't stampede it in lockstep.

## [0.1.1] — 2026-07-17

- Multi-arch image: `linux/amd64` + `linux/arm64` (for NAS boxes).
- Applies the declared download/upload speed pushed from the panel (remote config) for the
  "% of contract" throughput comparison, overriding the `DECLARED_*` env when set.

## [0.1.0] — 2026-07-17

Initial public release.

- Availability & latency (RTT, packet loss), DNS, HTTP TTFB/TLS, traceroute, throughput, IPv6, port neutrality.
- Ed25519-signed ingest with a durable offline buffer; optional leaf-key SPKI pinning.
- `UPDATE_MODE` (`off` | `notify` | `auto`) with opt-in Watchtower auto-update.
- Docker image + Compose; native install script (systemd / launchd).
