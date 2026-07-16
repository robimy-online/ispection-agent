import { tcpConnect } from './tcp';

export interface PortProbeResult {
  host: string;
  port: number;
  reachable: boolean;
  connectMs: number | null;
}

/** Probes each `host:port` via TCP connect. Neutrality signal: which ports connect, and how fast. */
export async function measurePorts(probes: Array<{ host: string; port: number }>): Promise<PortProbeResult[]> {
  return Promise.all(
    probes.map(async ({ host, port }) => {
      const r = await tcpConnect(host, port);
      return { host, port, reachable: r.reachable, connectMs: r.connectMs };
    }),
  );
}
