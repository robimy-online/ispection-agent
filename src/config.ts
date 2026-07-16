import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Remote config fetched from the server (overrides env). Local type — the agent stays standalone.
export interface RemoteConfig {
  intervalSec?: number;
  pingCount?: number;
  targets?: string[];
  rotateTargets?: boolean;
  scheduleJitterPct?: number;
}

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

export function loadConfig(): AgentConfig {
  const env = process.env;
  const targets = (env.TARGETS ?? '1.1.1.1,8.8.8.8')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ingestUrl: (env.INGEST_URL ?? 'https://ispection.robimy.online/api').replace(/\/+$/, ''),
    claimCode: env.CLAIM_CODE ?? null,
    targets,
    intervalSec: Number(env.INGEST_INTERVAL_SEC ?? 30),
    pingCount: Number(env.PING_COUNT ?? 5),
    dataDir: env.AGENT_DATA_DIR ?? path.join(os.homedir(), '.ispection-agent'),
    insecure: env.INGEST_INSECURE === 'true',
    pinSpki: env.INGEST_PIN_SPKI ?? null,
    maxBatch: Number(env.INGEST_MAX_BATCH ?? 500),
    version: readAgentVersion(),
    httpTarget: env.HTTP_TARGET ?? 'https://www.google.com/generate_204',
    releasePublicKey: env.RELEASE_PUBLIC_KEY ?? '',
    tracerouteTarget: env.TRACEROUTE_TARGET ?? targets[0] ?? '1.1.1.1',
    tracerouteIntervalSec: Number(env.TRACEROUTE_INTERVAL_SEC ?? 300),
    throughputUrl: env.THROUGHPUT_URL ?? 'https://speed.cloudflare.com/__down?bytes=25000000',
    throughputIntervalSec: Number(env.THROUGHPUT_INTERVAL_SEC ?? 900),
    declaredDownMbps: env.DECLARED_DOWN_MBPS ? Number(env.DECLARED_DOWN_MBPS) : null,
    uploadUrl: env.UPLOAD_URL ?? 'https://speed.cloudflare.com/__up',
    uploadBytes: Number(env.UPLOAD_BYTES ?? 8_000_000),
    declaredUpMbps: env.DECLARED_UP_MBPS ? Number(env.DECLARED_UP_MBPS) : null,
    ipv6Target: env.IPV6_TARGET ?? '2606:4700:4700::1111',
    ipv4Baseline: env.IPV4_BASELINE ?? '1.1.1.1',
    ipv6IntervalSec: Number(env.IPV6_INTERVAL_SEC ?? 300),
    targetPool: (env.TARGET_POOL ?? DEFAULT_TARGET_POOL)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rotateTargets: env.ROTATE_TARGETS === 'true',
    targetsPerCycle: Math.max(1, Number(env.TARGETS_PER_CYCLE ?? targets.length)),
    scheduleJitterPct: Math.min(0.5, Math.max(0, Number(env.SCHEDULE_JITTER_PCT ?? 0))),
    portProbes: parsePortProbes(env.PORT_PROBES ?? DEFAULT_PORT_PROBES),
    portProbeIntervalSec: Number(env.PORT_PROBE_INTERVAL_SEC ?? 600),
    dnsTestDomain: env.DNS_TEST_DOMAIN ?? 'example.com',
    dnsPublicServer: env.DNS_PUBLIC_SERVER ?? '1.1.1.1',
    dohUrl: env.DOH_URL ?? 'https://cloudflare-dns.com/dns-query',
    dnsCheckIntervalSec: Number(env.DNS_CHECK_INTERVAL_SEC ?? 600),
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
    .filter((p) => p.host !== '' && Number.isInteger(p.port) && p.port > 0 && p.port <= 65535);
}
