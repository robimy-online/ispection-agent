import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isValidHost } from '../validate';

const exec = promisify(execFile);

export interface PingResult {
  reachable: boolean;
  rttMs: number | null;
  lossPct: number;
  jitterMs: number | null;
  samples: number;
}

/**
 * RTT + packet loss via the system `ping` (ICMP). Shelling out keeps the agent
 * privilege-light and portable (raw ICMP sockets would need root/CAP_NET_RAW).
 * Returns null when the `ping` binary is absent → caller falls back to TCP connect.
 */
export async function ping(target: string, count: number): Promise<PingResult | null> {
  // Reject malformed / flag-like targets before they reach the ping binary (argument injection).
  if (!isValidHost(target)) return { reachable: false, rttMs: null, lossPct: 100, jitterMs: null, samples: count };
  const isWin = process.platform === 'win32';
  // '--' ends option parsing so a target can never be read as a flag (POSIX ping; not supported by Windows ping).
  const safe = Math.max(1, Math.trunc(count) || 1);
  const args = isWin ? ['-n', String(safe), target] : ['-c', String(safe), '-w', '5', '--', target];
  try {
    const { stdout } = await exec('ping', args, { timeout: 15_000 });
    return parse(stdout, safe);
  } catch (e: unknown) {
    const errObj = e as { code?: string; stdout?: string; stderr?: string };
    if (errObj.code === 'ENOENT') return null; // no ping binary → fall back to TCP connect
    // No privilege for ICMP (non-root, no cap_net_raw / ping_group_range) → fall back to TCP connect
    // instead of falsely reporting the target DOWN.
    const detail = `${errObj.stderr ?? ''} ${(e as Error)?.message ?? ''}`.toLowerCase();
    if (errObj.code === 'EACCES' || errObj.code === 'EPERM' || detail.includes('not permitted') || detail.includes('permission denied')) {
      return null;
    }
    if (errObj.stdout) {
      const parsed = parse(errObj.stdout, safe);
      if (parsed) return parsed;
    }
    return { reachable: false, rttMs: null, lossPct: 100, jitterMs: null, samples: safe };
  }
}

export function parse(out: string, count: number): PingResult {
  // loss: linux/mac "0% packet loss"; windows "(0% loss)"
  const lossM = out.match(/([\d.]+)%\s*packet loss/i) ?? out.match(/\(([\d.]+)%\s*loss\)/i);
  // rtt: linux "= min/avg/max/mdev", mac "= min/avg/max/stddev"
  const rttM = out.match(/=\s*[\d.]+\/([\d.]+)\/[\d.]+\/([\d.]+)/);
  let rttMs: number | null = rttM ? Number(rttM[1]) : null;
  const jitterMs: number | null = rttM ? Number(rttM[2]) : null;
  if (rttMs === null) {
    const winAvg = out.match(/Average\s*=\s*(\d+)\s*ms/i); // windows summary
    if (winAvg) rttMs = Number(winAvg[1]);
  }
  const lossPct = lossM ? Number(lossM[1]) : rttMs !== null ? 0 : 100;
  return { reachable: lossPct < 100, rttMs, lossPct, jitterMs, samples: count };
}
