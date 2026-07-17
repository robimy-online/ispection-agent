# Security Policy

## Supported versions

The agent is released from `master`; the latest published image
(`ghcr.io/robimy-online/ispection-agent:latest`) receives security fixes. Pin to a `vX.Y.Z` tag or a
`@sha256:` digest for reproducibility. Images are cosign-signed (keyless, GitHub OIDC).

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

- Preferred: GitHub **private vulnerability reporting** — repo → **Security** → **Report a vulnerability**.
- Or email **kontakt@robimy.online** with details and reproduction steps.

We aim to acknowledge within a few working days and will coordinate a fix and disclosure with you.

## Trust model (by design — not a vulnerability)

The agent runs on **client-owned hardware**, so a determined owner can extract its Ed25519 key and submit
fabricated measurements. Signing provides **integrity, anti-replay and anti-MITM in transit** — not
resistance to fabrication by the device owner. That is mitigated server-side (cross-agent / per-ISP anomaly
detection) and is inherent to any client-side measurement. Reports about extracting a key from a machine you
control fall in this category.

Genuine issues we **do** want to hear about, for example:

- signature or verification bypass, or a replay the server accepts;
- certificate-pinning bypass / MITM;
- RCE, path traversal, or secrets leakage in the agent;
- supply-chain concerns in the published image or build pipeline.
