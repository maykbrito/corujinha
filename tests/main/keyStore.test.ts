// tests/main/keyStore.test.ts
import { describe, it, expect } from "vitest";
import { KeyStore } from "../../src/main/keyStore";

// In-memory fake of the safeStorage + disk ports.
function fakePorts() {
  let file: Buffer | null = null;
  return {
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from("enc:" + s),
      decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
    },
    disk: {
      write: (b: Buffer) => { file = b; },
      read: () => file,
      exists: () => file !== null,
    },
  };
}

describe("KeyStore", () => {
  it("reports no key before set", () => {
    const ks = new KeyStore(fakePorts());
    expect(ks.status().hasKey).toBe(false);
  });
  it("round-trips an encrypted key", () => {
    const ks = new KeyStore(fakePorts());
    ks.set("sk-test-123");
    expect(ks.status().hasKey).toBe(true);
    expect(ks.get()).toBe("sk-test-123");
  });
});
