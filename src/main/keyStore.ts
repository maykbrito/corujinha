// src/main/keyStore.ts
import type { KeyStatus } from "@shared/types";

export interface CryptoPort {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}
export interface DiskPort { write(b: Buffer): void; read(): Buffer | null; exists(): boolean; }

export class KeyStore {
  constructor(private ports: { crypto: CryptoPort; disk: DiskPort }) {}
  status(): KeyStatus { return { hasKey: this.ports.disk.exists() }; }
  set(key: string): void {
    if (!this.ports.crypto.isEncryptionAvailable()) throw new Error("Encryption unavailable");
    this.ports.disk.write(this.ports.crypto.encryptString(key));
  }
  get(): string | null {
    const b = this.ports.disk.read();
    return b ? this.ports.crypto.decryptString(b) : null;
  }
}

import { safeStorage, app } from "electron";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export function makeElectronKeyStore(): KeyStore {
  const file = join(app.getPath("userData"), "openai-key.bin");
  return new KeyStore({
    crypto: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s) => safeStorage.encryptString(s),
      decryptString: (b) => safeStorage.decryptString(b),
    },
    disk: {
      write: (b) => writeFileSync(file, b),
      read: () => (existsSync(file) ? readFileSync(file) : null),
      exists: () => existsSync(file),
    },
  });
}
