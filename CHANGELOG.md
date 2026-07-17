# Changelog

All notable changes are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

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
