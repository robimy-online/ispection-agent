import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isPublicTarget, isValidHost } from './validate';

// Remote config fetched from the server (overrides env). Local type — the agent stays standalone.
export interface RemoteConfig {
  intervalSec?: number;
  pingCount?: number;
  targets?: string[];
  rotateTargets?: boolean;
  scheduleJitterPct?: number;
  declaredDownMbps?: number; // declared (contracted) download speed from the panel → "% of contract"
  declaredUpMbps?: number; // declared upload speed from the panel
}

export type UpdateMode = 'off' | 'notify' | 'auto';

export interface AgentConfig {
  ingestUrl: string; // base URL, e.g. https://ispection.robimy.online/api
  claimCode: string | null; // one-time enrollment code (only needed on first run)
  targets: string[];
  intervalSec: number;
  pingCount: number;
  dataDir: string;
  insecure: boolean; // http, skip cert pinning (dev only)
  pinSpki: string | null; // base64 sha256 of the server SPKI (prod https)
  maxBatch: number;
  maxBuffer: number; // hard cap on buffered samples; oldest dropped past this (bounds RAM + disk)
  version: string; // agent version (reported to the server)
  httpTarget: string; // URL for the DNS + TTFB probe
  releasePublicKey: string; // base64 SPKI Ed25519 — verifies the signed self-update manifest
  tracerouteTarget: string;
  tracerouteIntervalSec: number;
  throughputUrl: string;
  throughputIntervalSec: number;
  declaredDownMbps: number | null; // contracted download rate (Mbit/s)
  uploadUrl: string;
  uploadBytes: number;
  declaredUpMbps: number | null; // contracted upload rate (Mbit/s)
  ipv6Target: string; // IPv6 literal for the parity probe
  ipv4Baseline: string; // IPv4 literal from the same ISP (baseline)
  ipv6IntervalSec: number;
  portProbes: Array<{ host: string; port: number }>; // port neutrality / blocking
  portProbeIntervalSec: number;
  dnsTestDomain: string;
  dnsPublicServer: string;
  dohUrl: string;
  dnsCheckIntervalSec: number;
  // Anti-identification (opt-in): rotate targets from a pool + schedule jitter so the ISP can't whitelist probes.
  targetPool: string[];
  rotateTargets: boolean;
  targetsPerCycle: number;
  scheduleJitterPct: number; // 0–0.5; 0 = deterministic
  // Update behaviour: 'off' = never check; 'notify' (default) = log when a newer version is out;
  // 'auto' = check +, when containerized, defer the actual image swap to Watchtower (see README).
  updateMode: UpdateMode;
  updateCheckIntervalSec: number;
}

// Popular anycast endpoints (they also answer on :443) — hard for an ISP to single out.
const DEFAULT_TARGET_POOL = '1.1.1.1,1.0.0.1,8.8.8.8,8.8.4.4,9.9.9.9,208.67.222.222,208.67.220.220';

function readAgentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseUpdateMode(raw: string | undefined): UpdateMode {
  const v = (raw ?? 'notify').trim().toLowerCase();
  return v === 'off' || v === 'auto' ? v : 'notify';
}

/**
 * Parse a numeric env var with a default and hard bounds. A missing/blank/non-numeric value
 * falls back to the default; out-of-range values are clamped. This keeps a typo like
 * `INGEST_INTERVAL_SEC=0` (or a stray `NaN`) from turning a scheduler loop into a busy-loop
 * that hammers the collector.
 */
function envNum(raw: string | undefined, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function loadConfig(): AgentConfig {
  const env = process.env;
  // Drop malformed/flag-like AND private/reserved targets up front — they flow to ping/traceroute.
  // Public-only keeps this hobby monitor from ever probing someone's LAN (see validate.ts).
  const targets = (env.TARGETS ?? '1.1.1.1,8.8.8.8')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isPublicTarget);
  const safeTargets = targets.length ? targets : ['1.1.1.1', '8.8.8.8'];
  return {
    ingestUrl: (env.INGEST_URL ?? 'https://ispection.robimy.online/api').replace(/\/+$/, ''),
    claimCode: env.CLAIM_CODE ?? null,
    targets: safeTargets,
    intervalSec: envNum(env.INGEST_INTERVAL_SEC, 30, 5, 86_400),
    pingCount: envNum(env.PING_COUNT, 5, 1, 20),
    dataDir: env.AGENT_DATA_DIR ?? path.join(os.homedir(), '.ispection-agent'),
    insecure: env.INGEST_INSECURE === 'true',
    pinSpki: env.INGEST_PIN_SPKI ?? null,
    maxBatch: envNum(env.INGEST_MAX_BATCH, 500, 1, 10_000),
    maxBuffer: envNum(env.BUFFER_MAX, 50_000, 100, 5_000_000),
    version: readAgentVersion(),
    httpTarget: env.HTTP_TARGET ?? 'https://www.google.com/generate_204',
    releasePublicKey: env.RELEASE_PUBLIC_KEY ?? '',
    tracerouteTarget:
      env.TRACEROUTE_TARGET && isPublicTarget(env.TRACEROUTE_TARGET) ? env.TRACEROUTE_TARGET : (safeTargets[0] ?? '1.1.1.1'),
    tracerouteIntervalSec: envNum(env.TRACEROUTE_INTERVAL_SEC, 300, 30, 86_400),
    throughputUrl: env.THROUGHPUT_URL ?? 'https://speed.cloudflare.com/__down?bytes=25000000',
    throughputIntervalSec: envNum(env.THROUGHPUT_INTERVAL_SEC, 900, 60, 86_400),
    declaredDownMbps: env.DECLARED_DOWN_MBPS ? envNum(env.DECLARED_DOWN_MBPS, 0, 0, 1_000_000) || null : null,
    uploadUrl: env.UPLOAD_URL ?? 'https://speed.cloudflare.com/__up',
    uploadBytes: envNum(env.UPLOAD_BYTES, 8_000_000, 0, 100_000_000),
    declaredUpMbps: env.DECLARED_UP_MBPS ? envNum(env.DECLARED_UP_MBPS, 0, 0, 1_000_000) || null : null,
    ipv6Target: env.IPV6_TARGET ?? '2606:4700:4700::1111',
    ipv4Baseline: env.IPV4_BASELINE ?? '1.1.1.1',
    ipv6IntervalSec: envNum(env.IPV6_INTERVAL_SEC, 300, 30, 86_400),
    targetPool: (env.TARGET_POOL ?? DEFAULT_TARGET_POOL)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(isPublicTarget),
    rotateTargets: env.ROTATE_TARGETS === 'true',
    targetsPerCycle: envNum(env.TARGETS_PER_CYCLE, safeTargets.length, 1, 64),
    scheduleJitterPct: envNum(env.SCHEDULE_JITTER_PCT, 0, 0, 0.5),
    portProbes: parsePortProbes(env.PORT_PROBES ?? DEFAULT_PORT_PROBES),
    portProbeIntervalSec: envNum(env.PORT_PROBE_INTERVAL_SEC, 600, 30, 86_400),
    dnsTestDomain: env.DNS_TEST_DOMAIN ?? 'example.com',
    dnsPublicServer: env.DNS_PUBLIC_SERVER ?? '1.1.1.1',
    dohUrl: env.DOH_URL ?? 'https://cloudflare-dns.com/dns-query',
    dnsCheckIntervalSec: envNum(env.DNS_CHECK_INTERVAL_SEC, 600, 30, 86_400),
    updateMode: parseUpdateMode(env.UPDATE_MODE),
    updateCheckIntervalSec: envNum(env.UPDATE_CHECK_INTERVAL_SEC, 86_400, 3_600, 604_800),
  };
}

// Ports usually open (443/53/80) — the "blocked" heuristic fires when the host answers on another port.
const DEFAULT_PORT_PROBES = '1.1.1.1:443,1.1.1.1:53,8.8.8.8:443,8.8.8.8:53,93.184.216.34:80';

function parsePortProbes(raw: string): Array<{ host: string; port: number }> {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.lastIndexOf(':'); // last colon → port (host = hostname/IPv4)
      const host = idx > 0 ? pair.slice(0, idx) : pair;
      const port = Number(pair.slice(idx + 1));
      return { host, port };
    })
    .filter((p) => isValidHost(p.host) && Number.isInteger(p.port) && p.port > 0 && p.port <= 65535);
}
