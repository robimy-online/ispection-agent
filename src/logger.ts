export function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export function warn(msg: string): void {
  console.error(`[${new Date().toISOString()}] WARN ${msg}`);
}

export function err(msg: string): void {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}`);
}
