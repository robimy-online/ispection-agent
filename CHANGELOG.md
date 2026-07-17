# Changelog

All notable changes are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [Unreleased]

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

### Reliability
- **Bounded buffer.** New `BUFFER_MAX` (default 50000) caps buffered samples; the oldest are dropped
  past the cap, bounding RAM/disk during a long outage.
- **Faster backlog drain.** `flush` now sends batches until the buffer is empty (or a send fails)
  instead of one batch per cycle, so a post-outage backlog clears quickly.
- `ping` falls back to TCP-connect timing (instead of reporting the target down) when it lacks ICMP
  privilege, and the bare `docker run` path now persists to `/data` by default (`AGENT_DATA_DIR`).

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
