import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isValidHost } from '../validate';

const exec = promisify(execFile);

export interface Hop {
  hop: number;
  ip: string | null; // null = '*' (no reply)
  rttMs: number | null;
}

/** Traceroute to the target (numeric, 1 query/hop). Returns [] when the tool is unavailable. */
export async function traceroute(target: string): Promise<Hop[]> {
  if (!isValidHost(target)) return []; // never hand a flag-like value to the traceroute binary
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'tracert' : 'traceroute';
  // '--' ends option parsing (POSIX traceroute; Windows tracert doesn't support it).
  const args = isWin
    ? ['-d', '-w', '2000', '-h', '30', target]
    : ['-n', '-q', '1', '-w', '2', '-m', '30', '--', target];
  try {
    const { stdout } = await exec(cmd, args, { timeout: 90_000 });
    return parse(stdout);
  } catch (e: unknown) {
    const out = (e as { stdout?: string }).stdout;
    return out ? parse(out) : [];
  }
}

export function parse(out: string): Hop[] {
  const hops: Hop[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const rest = m[2];
    const ipMatch = rest.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    const rttMatch = rest.match(/([\d.]+)\s*ms/); // first RTT in the line
    hops.push({
      hop: Number(m[1]),
      ip: ipMatch ? ipMatch[1] : null,
      rttMs: rttMatch ? Number(rttMatch[1]) : null,
    });
  }
  return hops;
}
