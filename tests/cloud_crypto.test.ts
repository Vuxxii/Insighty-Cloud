import { describe, expect, it } from 'vitest';
import {
  createAccountKeys,
  decryptString,
  encryptString,
  generateRecoveryKey,
  normaliseRecoveryKey,
  recoverWithRecoveryKey,
  unlockWithPassword,
  validatePasswordStrength,
} from '../src/cloud/crypto';

// KDF iterations make each derivation ~0.5s; these tests accept that on purpose —
// they exercise the REAL parameters, not weakened ones.

describe('E2E crypto: account key envelope', () => {
  it('signup → login round-trip: password unwraps the master key and data decrypts', async () => {
    const { bundle, authHash, mk } = await createAccountKeys('correct horse 99');

    const sealed = await encryptString('sensitive insight — نص سري', mk);
    expect(sealed.data).not.toContain('sensitive');

    const unlocked = await unlockWithPassword('correct horse 99', bundle);
    expect(unlocked.authHash).toBe(authHash);
    expect(await decryptString(sealed, unlocked.mk)).toBe('sensitive insight — نص سري');
  }, 30_000);

  it('the wrong password fails to unwrap — and never yields a key', async () => {
    const { bundle } = await createAccountKeys('correct horse 99');
    await expect(unlockWithPassword('wrong horse 99', bundle)).rejects.toThrow();
  }, 30_000);

  it('auth hash and encryption key are independent: the server-visible hash cannot decrypt', async () => {
    const { bundle, authHash, mk } = await createAccountKeys('correct horse 99');
    const sealed = await encryptString('secret', mk);
    // Treat the (server-visible) authHash as a password: it must NOT unlock the vault.
    await expect(
      unlockWithPassword(authHash, { ...bundle }),
    ).rejects.toThrow();
    void sealed;
  }, 30_000);

  it('recovery key unwraps the master key and re-wraps under a new password', async () => {
    const { bundle, mk, recoveryKey } = await createAccountKeys('original pass 1');
    const sealed = await encryptString('survives recovery', mk);

    const recovered = await recoverWithRecoveryKey(recoveryKey, 'brand new pass 2', bundle);
    expect(await decryptString(sealed, recovered.mk)).toBe('survives recovery');

    // New password now unlocks; old one does not.
    const relocked = await unlockWithPassword('brand new pass 2', recovered.bundle);
    expect(await decryptString(sealed, relocked.mk)).toBe('survives recovery');
    await expect(unlockWithPassword('original pass 1', recovered.bundle)).rejects.toThrow();
  }, 60_000);

  it('a wrong recovery key fails', async () => {
    const { bundle } = await createAccountKeys('original pass 1');
    await expect(
      recoverWithRecoveryKey(generateRecoveryKey(), 'new pass 22', bundle),
    ).rejects.toThrow();
  }, 30_000);
});

describe('E2E crypto: primitives', () => {
  it('every encryption uses a fresh IV', async () => {
    const { mk } = await createAccountKeys('some password 1');
    const a = await encryptString('same plaintext', mk);
    const b = await encryptString('same plaintext', mk);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  }, 30_000);

  it('recovery keys format as 8 hex groups and normalise forgivingly', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
    expect(normaliseRecoveryKey(key.toLowerCase().replaceAll('-', ' '))).toBe(
      key.replaceAll('-', ''),
    );
  });

  it('password strength gate', () => {
    expect(validatePasswordStrength('short1')).toMatch(/at least 10/);
    expect(validatePasswordStrength('longenoughbutnodigits')).toMatch(/letters and numbers/);
    expect(validatePasswordStrength('long enough 42')).toBeNull();
  });
});
