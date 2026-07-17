export function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export function warn(msg: string): void {
  console.error(`[${new Date().toISOString()}] WARN ${msg}`);
}

/**
 * Sanitize server-controlled text before logging it: strip control chars (newlines, ANSI escapes)
 * and truncate. Stops a malicious/tampered collector response from injecting forged lines or
 * escape sequences into the agent's logs.
 */
export function clean(s: string, max = 300): string {
  // Replace C0 controls (incl. CR/LF and the ESC that starts ANSI sequences) and DEL with a space.
  const stripped = String(s).replace(/[\x00-\x1f\x7f]/g, ' ');
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
}

export function err(msg: string): void {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}`);
}
