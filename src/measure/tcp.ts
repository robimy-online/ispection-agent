import { connect } from 'node:net';

export interface TcpResult {
  reachable: boolean;
  connectMs: number | null;
}

/** Privilege-free reachability probe: measures TCP connect time to host:port. */
export function tcpConnect(host: string, port = 443, timeoutMs = 5_000): Promise<TcpResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = connect({ host, port });
    let done = false;
    const finish = (reachable: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ reachable, connectMs: reachable ? Date.now() - start : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
