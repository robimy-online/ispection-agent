import { createPublicKey, verify } from 'node:crypto';
import { loadConfig, AgentConfig, RemoteConfig } from './config';
import { AgentKeys } from './crypto/keys';
import { AgentStore } from './store/buffer';
import { agentStatus, probeAll, type LiveStatus } from './measure/probe';
import { probeHttp } from './measure/http';
import { getJson, postJson, type HttpResponse } from './transport/client';
import { INGEST_API_VERSION } from './api-version';
import { AgentLive } from './transport/agent-live';
import { traceroute } from './measure/traceroute';
import { measureThroughput } from './measure/throughput';
import { measureUpload } from './measure/upload';
import { measureIpv6 } from './measure/ipv6';
import { measurePorts } from './measure/ports';
import { measureDns } from './measure/dns-check';
import { ping } from './measure/ping';
import { err, log } from './logger';

interface LiveState {
  last: LiveStatus;
}

const startedAtMs = Date.now();
let lastError: string | null = null;

function pinOpts(cfg: AgentConfig): { pinSpki: string | null } {
  return { pinSpki: cfg.insecure ? null : cfg.pinSpki };
}

/** Anti-fingerprinting: when rotation is enabled, each cycle takes a sliding window from the target pool. */
function makeTargetPicker(cfg: AgentConfig): () => string[] {
  if (!cfg.rotateTargets || cfg.targetPool.length === 0) return () => cfg.targets;
  const pool = cfg.targetPool;
  const n = Math.min(cfg.targetsPerCycle, pool.length);
  let cursor = 0;
  return () => {
    const picked: string[] = [];
    for (let i = 0; i < n; i += 1) picked.push(pool[(cursor + i) % pool.length]);
    cursor = (cursor + n) % pool.length;
    return picked;
  };
}

/** Randomly jitters the interval (±pct) so probes don't land on round seconds. */
function jitteredMs(baseMs: number, pct: number): number {
  if (pct <= 0) return baseMs;
  return Math.max(1000, Math.round(baseMs + baseMs * pct * (Math.random() * 2 - 1)));
}

/** Self-rescheduling loop with jitter (first run after one interval, like setInterval). */
function scheduleLoop(fn: () => void, baseMs: number, pct: number): void {
  const tick = (): void => {
    fn();
    setTimeout(tick, jitteredMs(baseMs, pct));
  };
  setTimeout(tick, jitteredMs(baseMs, pct));
}

interface ReleaseManifest {
  version?: string;
  url?: string;
  sha256?: string;
  sig?: string;
}

/** Verifies a signed manifest: Ed25519 over `${version}.${url}.${sha256}` with the release key. */
function verifyManifest(m: ReleaseManifest, pubKeyBase64: string): boolean {
  if (!m.version || !m.url || !m.sha256 || !m.sig) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(pubKeyBase64, 'base64'), format: 'der', type: 'spki' });
    const message = Buffer.from(`${m.version}.${m.url}.${m.sha256}`);
    return verify(null, message, key, Buffer.from(m.sig, 'base64'));
  } catch {
    return false;
  }
}

async function checkRelease(cfg: AgentConfig): Promise<void> {
  try {
    const res = await getJson(`${cfg.ingestUrl}/agents/release`, pinOpts(cfg));
    if (res.status >= 300) return;
    const parsed = JSON.parse(res.body) as { data?: ReleaseManifest } & ReleaseManifest;
    const m = parsed.data ?? parsed;
    if (!m.version || m.version === cfg.version) return;

    // Signed manifest (native/SEA) → never trust the URL without a valid signature.
    if (m.url && m.sha256 && m.sig) {
      if (!cfg.releasePublicKey) {
        log(`Update ${m.version} available, but RELEASE_PUBLIC_KEY is not set — skipping self-update (Docker: update the image).`);
        return;
      }
      if (!verifyManifest(m, cfg.releasePublicKey)) {
        err(`Release manifest ${m.version} has an INVALID signature — ignoring.`);
        return;
      }
      log(`Verified update ${m.version} (signature OK): ${m.url} sha256=${m.sha256.slice(0, 12)}… — download, verify sha256, swap (see README).`);
      return;
    }
    log(`Agent update available: ${m.version} (you have ${cfg.version}). Update the image and restart the container.`);
  } catch {
    /* offline or no endpoint — skip */
  }
}

async function enrollIfNeeded(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (store.agentId) return;
  if (!cfg.claimCode) throw new Error('Agent is not enrolled and CLAIM_CODE is not set.');
  const body = Buffer.from(
    JSON.stringify({ claimCode: cfg.claimCode, publicKey: keys.publicKeyBase64(), version: cfg.version }),
  );
  const res = await postJson(`${cfg.ingestUrl}/agents/enroll`, { 'x-api-version': String(INGEST_API_VERSION) }, body, pinOpts(cfg));
  if (res.status >= 300) throw new Error(`Enrollment failed: ${res.status} ${res.body}`);
  const parsed = JSON.parse(res.body) as { data?: { agentId?: number }; agentId?: number };
  const agentId = parsed.data?.agentId ?? parsed.agentId;
  if (!agentId) throw new Error(`Enrollment response has no agentId: ${res.body}`);
  store.setAgentId(agentId);
  log(`Enrolled as agent #${agentId}`);
}

async function flush(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (store.pending() === 0) return;
  const batch = store.peekBatch(cfg.maxBatch);
  const rawBody = Buffer.from(JSON.stringify({ samples: batch }));
  const ts = String(Date.now());
  const seq = String(store.nextSeq());
  const signature = keys.sign(Buffer.concat([Buffer.from(`${ts}.${seq}.`), rawBody]));
  const headers = {
    'x-agent-id': String(store.agentId),
    'x-timestamp': ts,
    'x-sequence': seq,
    'x-signature': signature,
    'x-agent-version': cfg.version,
    'x-api-version': String(INGEST_API_VERSION),
  };
  const res = await postJson(`${cfg.ingestUrl}/ingest`, headers, rawBody, pinOpts(cfg));
  if (res.status >= 200 && res.status < 300) {
    store.dropBatch(batch.length);
    log(`Sent ${batch.length} samples (seq=${seq}); buffered: ${store.pending()}`);
  } else {
    lastError = `ingest ${res.status}`;
    err(`Ingest failed: ${res.status} ${res.body} — keeping ${batch.length} buffered`);
  }
}

async function sendDns(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (!store.agentId) return;
  const d = await measureDns(cfg.dnsTestDomain, cfg.dnsPublicServer, cfg.dohUrl);
  const res = await signedPost(cfg, keys, store, '/ingest/dns', d);
  if (res.status >= 200 && res.status < 300) {
    const flags = [d.nxdomainHijack ? 'NXDOMAIN-hijack' : '', d.dohBlocked ? 'DoH-blocked' : ''].filter(Boolean).join(', ');
    log(`DNS: isp ${d.ispResolveMs ?? '—'}ms / pub ${d.publicResolveMs ?? '—'}ms${flags ? ` [${flags}]` : ''}`);
  } else {
    err(`DNS send failed: ${res.status} ${res.body}`);
  }
}

async function sendHeartbeat(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (!store.agentId) return;
  const res = await signedPost(cfg, keys, store, '/ingest/heartbeat', {
    bufferPending: store.pending(),
    uptimeSec: Math.floor((Date.now() - startedAtMs) / 1000),
    lastError,
  });
  if (res.status < 200 || res.status >= 300) err(`Heartbeat failed: ${res.status}`);
}

function signedPost(
  cfg: AgentConfig,
  keys: AgentKeys,
  store: AgentStore,
  path: string,
  bodyObj: unknown,
): Promise<HttpResponse> {
  const rawBody = Buffer.from(JSON.stringify(bodyObj));
  const ts = String(Date.now());
  const seq = String(store.nextSeq());
  const signature = keys.sign(Buffer.concat([Buffer.from(`${ts}.${seq}.`), rawBody]));
  const headers = {
    'x-agent-id': String(store.agentId),
    'x-timestamp': ts,
    'x-sequence': seq,
    'x-signature': signature,
    'x-agent-version': cfg.version,
    'x-api-version': String(INGEST_API_VERSION),
  };
  return postJson(`${cfg.ingestUrl}${path}`, headers, rawBody, pinOpts(cfg));
}

async function sendTraceroute(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (!store.agentId) return;
  const hops = await traceroute(cfg.tracerouteTarget);
  if (hops.length === 0) return;
  const res = await signedPost(cfg, keys, store, '/ingest/traceroute', { target: cfg.tracerouteTarget, hops });
  if (res.status >= 200 && res.status < 300) log(`Traceroute ${cfg.tracerouteTarget}: ${hops.length} hops`);
  else err(`Traceroute send failed: ${res.status} ${res.body}`);
}

async function sendThroughput(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (!store.agentId) return;
  const bloatTarget = cfg.targets[0] ?? cfg.tracerouteTarget;

  // Baseline RTT before load, then ping concurrently DURING the download to capture RTT under load (bufferbloat).
  const idle = await ping(bloatTarget, 3);
  const idleRttMs = idle?.rttMs ?? null;
  const downloadPromise = measureThroughput(cfg.throughputUrl);
  const loadedPromise = ping(bloatTarget, cfg.pingCount);
  const [mbps, loaded] = await Promise.all([downloadPromise, loadedPromise]);
  if (mbps === null) return;

  const mbpsDown = Math.round(mbps * 10) / 10;
  const loadedRttMs = loaded?.rttMs ?? null;
  const bufferbloatMs =
    idleRttMs !== null && loadedRttMs !== null ? Math.round(Math.max(0, loadedRttMs - idleRttMs) * 10) / 10 : null;

  // Upload as a separate transfer after the download finishes, so down/up don't cannibalize each other.
  const up = await measureUpload(cfg.uploadUrl, cfg.uploadBytes);
  const mbpsUp = up === null ? null : Math.round(up * 10) / 10;

  const res = await signedPost(cfg, keys, store, '/ingest/throughput', {
    mbpsDown,
    declaredDownMbps: cfg.declaredDownMbps,
    idleRttMs,
    loadedRttMs,
    bufferbloatMs,
    mbpsUp,
    declaredUpMbps: cfg.declaredUpMbps,
  });
  if (res.status >= 200 && res.status < 300) {
    log(
      `Throughput: ↓${mbpsDown}${mbpsUp !== null ? ` / ↑${mbpsUp}` : ''} Mbit/s` +
        `${bufferbloatMs !== null ? `, bufferbloat +${bufferbloatMs}ms` : ''}`,
    );
  } else {
    err(`Throughput send failed: ${res.status} ${res.body}`);
  }
}

/** Overlay server-side config onto the current cfg. Unknown/absent keys keep env defaults. */
function applyRemoteConfig(cfg: AgentConfig, rc: RemoteConfig): boolean {
  let changed = false;
  if (typeof rc.intervalSec === 'number' && rc.intervalSec > 0) (cfg.intervalSec = rc.intervalSec), (changed = true);
  if (typeof rc.pingCount === 'number' && rc.pingCount > 0) (cfg.pingCount = rc.pingCount), (changed = true);
  if (Array.isArray(rc.targets) && rc.targets.length) (cfg.targets = rc.targets), (changed = true);
  if (typeof rc.rotateTargets === 'boolean') (cfg.rotateTargets = rc.rotateTargets), (changed = true);
  if (typeof rc.scheduleJitterPct === 'number') (cfg.scheduleJitterPct = rc.scheduleJitterPct), (changed = true);
  return changed;
}

/** Pull remote config (signed POST, empty body) and apply it. Silent on offline/errors. */
async function fetchRemoteConfig(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (!store.agentId) return;
  try {
    const res = await signedPost(cfg, keys, store, '/ingest/config', {});
    if (res.status < 200 || res.status >= 300) return;
    const parsed = JSON.parse(res.body) as { data?: RemoteConfig } & RemoteConfig;
    const rc = parsed.data ?? parsed;
    if (rc && applyRemoteConfig(cfg, rc)) {
      log(`Applied remote config: interval=${cfg.intervalSec}s, ping=${cfg.pingCount}, targets=[${cfg.targets.join(', ')}]`);
    }
  } catch {
    /* offline or no endpoint — keep the env config */
  }
}

async function sendIpv6(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (!store.agentId) return;
  const m = await measureIpv6(cfg.ipv6Target, cfg.ipv4Baseline);
  const res = await signedPost(cfg, keys, store, '/ingest/ipv6', {
    target: cfg.ipv6Target,
    reachable: m.reachable,
    ipv6RttMs: m.ipv6RttMs,
    ipv4RttMs: m.ipv4RttMs,
  });
  if (res.status >= 200 && res.status < 300) {
    log(`IPv6 ${cfg.ipv6Target}: ${m.reachable ? `${m.ipv6RttMs?.toFixed(1)}ms` : 'UNREACHABLE'} (v4 ${m.ipv4RttMs?.toFixed(1) ?? '—'}ms)`);
  } else {
    err(`IPv6 send failed: ${res.status} ${res.body}`);
  }
}

async function sendPorts(cfg: AgentConfig, keys: AgentKeys, store: AgentStore): Promise<void> {
  if (!store.agentId || cfg.portProbes.length === 0) return;
  const probes = await measurePorts(cfg.portProbes);
  const res = await signedPost(cfg, keys, store, '/ingest/ports', { probes });
  if (res.status >= 200 && res.status < 300) {
    const blocked = probes.filter((p) => !p.reachable).length;
    log(`Ports: ${probes.length - blocked}/${probes.length} reachable`);
  } else {
    err(`Ports send failed: ${res.status} ${res.body}`);
  }
}

async function cycle(
  cfg: AgentConfig,
  keys: AgentKeys,
  store: AgentStore,
  agentLive: AgentLive,
  state: LiveState,
  targets: string[],
): Promise<void> {
  const samples = await probeAll(targets, cfg.pingCount);
  const httpSample = await probeHttp(cfg.httpTarget);
  const all = [...samples, httpSample];
  store.append(all);
  const summary = samples
    .map((s) => `${s.target}=${s.reachable ? `${s.rttMs?.toFixed(1)}ms/${s.lossPct}%loss` : 'DOWN'}`)
    .join(', ');
  log(
    `Measured ${samples.length} targets + HTTP ${httpSample.target} ` +
      `(dns ${httpSample.dnsMs ?? '—'}ms, ttfb ${httpSample.ttfbMs ?? '—'}ms)`,
  );

  // State change → push immediately over WS (don't wait for the next batch).
  const status = agentStatus(all);
  if (status !== state.last) {
    state.last = status;
    agentLive.pushStatus(status);
    log(`State change → ${status} (live push)`);
  }

  await flush(cfg, keys, store);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const keys = AgentKeys.loadOrCreate(cfg.dataDir);
  const store = new AgentStore(cfg.dataDir);
  const targetsDesc = cfg.rotateTargets
    ? `rotating ${cfg.targetsPerCycle}/${cfg.targetPool.length} from pool`
    : `[${cfg.targets.join(', ')}]`;
  const jitterDesc = cfg.scheduleJitterPct > 0 ? `; jitter ±${Math.round(cfg.scheduleJitterPct * 100)}%` : '';
  log(`ispection agent v${cfg.version} → ${cfg.ingestUrl}; targets=${targetsDesc}; interval=${cfg.intervalSec}s${jitterDesc}`);
  await enrollIfNeeded(cfg, keys, store);

  // Remote config: fetch before building the loop (at startup), then refresh (some fields take effect next cycle).
  await fetchRemoteConfig(cfg, keys, store);
  scheduleLoop(() => void fetchRemoteConfig(cfg, keys, store), 15 * 60 * 1000, 0);

  void checkRelease(cfg);
  setInterval(() => void checkRelease(cfg), 24 * 60 * 60 * 1000);

  const agentLive = new AgentLive(cfg, keys, store.agentId ?? 0);
  if (store.agentId) agentLive.connect();
  const state: LiveState = { last: 'ok' };

  void sendTraceroute(cfg, keys, store).catch(() => undefined);
  scheduleLoop(
    () => void sendTraceroute(cfg, keys, store).catch((e: unknown) => err(`traceroute: ${(e as Error)?.message ?? e}`)),
    cfg.tracerouteIntervalSec * 1000,
    cfg.scheduleJitterPct,
  );

  void sendThroughput(cfg, keys, store).catch(() => undefined);
  scheduleLoop(
    () => void sendThroughput(cfg, keys, store).catch((e: unknown) => err(`throughput: ${(e as Error)?.message ?? e}`)),
    cfg.throughputIntervalSec * 1000,
    cfg.scheduleJitterPct,
  );

  void sendIpv6(cfg, keys, store).catch(() => undefined);
  scheduleLoop(
    () => void sendIpv6(cfg, keys, store).catch((e: unknown) => err(`ipv6: ${(e as Error)?.message ?? e}`)),
    cfg.ipv6IntervalSec * 1000,
    cfg.scheduleJitterPct,
  );

  void sendPorts(cfg, keys, store).catch(() => undefined);
  scheduleLoop(
    () => void sendPorts(cfg, keys, store).catch((e: unknown) => err(`ports: ${(e as Error)?.message ?? e}`)),
    cfg.portProbeIntervalSec * 1000,
    cfg.scheduleJitterPct,
  );

  void sendDns(cfg, keys, store).catch(() => undefined);
  scheduleLoop(
    () => void sendDns(cfg, keys, store).catch((e: unknown) => err(`dns: ${(e as Error)?.message ?? e}`)),
    cfg.dnsCheckIntervalSec * 1000,
    cfg.scheduleJitterPct,
  );

  const pickTargets = makeTargetPicker(cfg);
  const run = (): void => {
    void cycle(cfg, keys, store, agentLive, state, pickTargets()).catch((e: unknown) => {
      lastError = `cycle: ${(e as Error)?.message ?? String(e)}`;
      err(lastError);
    });
  };
  run();
  scheduleLoop(run, cfg.intervalSec * 1000, cfg.scheduleJitterPct);

  void sendHeartbeat(cfg, keys, store).catch(() => undefined);
  scheduleLoop(() => void sendHeartbeat(cfg, keys, store).catch(() => undefined), 60 * 1000, 0);
}

main().catch((e: unknown) => {
  err(`fatal: ${(e as Error)?.message ?? String(e)}`);
  process.exit(1);
});
