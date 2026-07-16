import { ping } from './ping';
import { tcpConnect } from './tcp';
import type { MeasurementSample } from '../types';

/** One probe cycle against one target: ICMP ping, falling back to TCP connect where ping is unavailable. */
export async function probeTarget(target: string, pingCount: number): Promise<MeasurementSample> {
  const ts = new Date().toISOString();
  const p = await ping(target, pingCount);
  if (p) {
    return {
      ts,
      target,
      reachable: p.reachable,
      rttMs: p.rttMs,
      lossPct: p.lossPct,
      rttJitterMs: p.jitterMs,
      samples: p.samples,
    };
  }
  const t = await tcpConnect(target);
  return {
    ts,
    target,
    reachable: t.reachable,
    rttMs: t.connectMs,
    lossPct: t.reachable ? 0 : 100,
    rttJitterMs: null,
    samples: 1,
  };
}

export function probeAll(targets: string[], pingCount: number): Promise<MeasurementSample[]> {
  return Promise.all(targets.map((t) => probeTarget(t, pingCount)));
}

export type LiveStatus = 'ok' | 'degraded' | 'down';

/** Aggregate quality status from samples (matches the server's logic). */
export function agentStatus(samples: MeasurementSample[]): LiveStatus {
  if (samples.length === 0) return 'ok';
  if (samples.every((s) => !s.reachable)) return 'down';
  if (samples.some((s) => !s.reachable) || samples.some((s) => s.lossPct >= 5)) return 'degraded';
  return 'ok';
}
