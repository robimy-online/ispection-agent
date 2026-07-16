import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Per-agent Ed25519 identity, generated once on first run and stored locally (0600). */
export class AgentKeys {
  private constructor(
    private readonly privateKey: KeyObject,
    private readonly publicKey: KeyObject,
  ) {}

  static loadOrCreate(dir: string): AgentKeys {
    mkdirSync(dir, { recursive: true });
    const keyPath = path.join(dir, 'agent-key.pem');
    if (existsSync(keyPath)) {
      const priv = createPrivateKey(readFileSync(keyPath, 'utf8'));
      return new AgentKeys(priv, createPublicKey(priv));
    }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }) as string, { mode: 0o600 });
    return new AgentKeys(privateKey, publicKey);
  }

  publicKeyBase64(): string {
    return (this.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  }

  sign(message: Buffer): string {
    return sign(null, message, this.privateKey).toString('base64');
  }
}
