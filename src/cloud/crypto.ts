/**
 * End-to-end encryption core.
 *
 * Model (Bitwarden-style envelope):
 *  - A random 256-bit MASTER KEY (MK) encrypts all content (AES-GCM-256).
 *  - The user's password never leaves the device. Two INDEPENDENT keys are derived
 *    from it with PBKDF2-SHA256 (600k iterations) using purpose-separated salts:
 *      · AUTH HASH  → used as the Supabase login "password" (server sees only this)
 *      · KEK        → wraps (encrypts) the MK; never transmitted
 *  - A one-time RECOVERY KEY (random, shown once) also wraps the MK, so a forgotten
 *    password is survivable without weakening E2E.
 *  - The server stores only: salts, KDF params, and the two wrapped MKs.
 *    Ciphertext everywhere else. A full server breach yields nothing readable.
 */

export const KDF_ITERATIONS = 600_000;
const AUTH_PURPOSE = 'insightyyy/auth/v1';
const ENC_PURPOSE = 'insightyyy/enc/v1';

const te = new TextEncoder();
const td = new TextDecoder();

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    bin += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pbkdf2Bits(
  password: string,
  salt: Uint8Array,
  purpose: string,
  iterations: number,
): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey(
    'raw',
    te.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  // Purpose string is mixed into the salt so auth and encryption derivations can
  // never collide even if the stored salts were somehow reused.
  const fullSalt = new Uint8Array([...te.encode(purpose), ...salt]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fullSalt, iterations },
    material,
    256,
  );
}

/** The string sent to Supabase as the account password. The real password and the
 * KEK cannot be recovered from it. */
export async function deriveAuthHash(
  password: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS,
): Promise<string> {
  return toB64(await pbkdf2Bits(password, salt, AUTH_PURPOSE, iterations));
}

/** The key-encryption-key that wraps the master key. Never leaves the device. */
export async function deriveKek(
  password: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const bits = await pbkdf2Bits(password, salt, ENC_PURPOSE, iterations);
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export interface WrappedKey {
  iv: string; // base64
  data: string; // base64 ciphertext of the raw MK bytes
}

export async function wrapMasterKey(mk: CryptoKey, kek: CryptoKey): Promise<WrappedKey> {
  const raw = await crypto.subtle.exportKey('raw', mk);
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: toB64(iv), data: toB64(data) };
}

export async function unwrapMasterKey(wrapped: WrappedKey, kek: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(wrapped.iv) },
    kek,
    fromB64(wrapped.data),
  );
  // extractable: MK must be re-wrappable on password change / recovery-key rotation.
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export interface CipherEnvelope {
  iv: string; // base64, 12 bytes, random per encryption — never reused
  data: string; // base64 AES-GCM ciphertext (includes auth tag)
}

export async function encryptString(plaintext: string, mk: CryptoKey): Promise<CipherEnvelope> {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, mk, te.encode(plaintext));
  return { iv: toB64(iv), data: toB64(data) };
}

export async function decryptString(envelope: CipherEnvelope, mk: CryptoKey): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv) },
    mk,
    fromB64(envelope.data),
  );
  return td.decode(plain);
}

/** Human-manageable recovery key: 128 bits as 8 groups of 4 hex chars.
 * Format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(16);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.toUpperCase().match(/.{4}/g)!.join('-');
}

export function normaliseRecoveryKey(input: string): string {
  return input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/** A recovery key acts as a password with its own derivation. */
export async function deriveRecoveryKek(
  recoveryKey: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS,
): Promise<CryptoKey> {
  return deriveKek(normaliseRecoveryKey(recoveryKey), salt, iterations);
}

export interface AccountKeyBundle {
  kdf_iterations: number;
  auth_salt: string;
  enc_salt: string;
  wrapped_mk: WrappedKey;
  recovery_salt: string;
  wrapped_mk_recovery: WrappedKey;
}

/** Everything created at signup. `recoveryKey` is shown ONCE and never stored. */
export async function createAccountKeys(
  password: string,
): Promise<{ bundle: AccountKeyBundle; authHash: string; mk: CryptoKey; recoveryKey: string }> {
  const authSalt = randomBytes(16);
  const encSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const mk = await generateMasterKey();
  const recoveryKey = generateRecoveryKey();

  const [authHash, kek, recoveryKek] = await Promise.all([
    deriveAuthHash(password, authSalt),
    deriveKek(password, encSalt),
    deriveRecoveryKek(recoveryKey, recoverySalt),
  ]);
  const [wrapped, wrappedRecovery] = await Promise.all([
    wrapMasterKey(mk, kek),
    wrapMasterKey(mk, recoveryKek),
  ]);

  return {
    bundle: {
      kdf_iterations: KDF_ITERATIONS,
      auth_salt: toB64(authSalt),
      enc_salt: toB64(encSalt),
      wrapped_mk: wrapped,
      recovery_salt: toB64(recoverySalt),
      wrapped_mk_recovery: wrappedRecovery,
    },
    authHash,
    mk,
    recoveryKey,
  };
}

/** Login: recompute the auth hash for Supabase and unwrap the MK locally. */
export async function unlockWithPassword(
  password: string,
  bundle: AccountKeyBundle,
): Promise<{ authHash: string; mk: CryptoKey }> {
  const [authHash, kek] = await Promise.all([
    deriveAuthHash(password, fromB64(bundle.auth_salt), bundle.kdf_iterations),
    deriveKek(password, fromB64(bundle.enc_salt), bundle.kdf_iterations),
  ]);
  const mk = await unwrapMasterKey(bundle.wrapped_mk, kek); // throws on wrong password
  return { authHash, mk };
}

/** Recovery path: unwrap the MK with the recovery key, then re-wrap under a new
 * password. Returns the updated bundle to persist. */
export async function recoverWithRecoveryKey(
  recoveryKey: string,
  newPassword: string,
  bundle: AccountKeyBundle,
): Promise<{ bundle: AccountKeyBundle; authHash: string; mk: CryptoKey }> {
  const recoveryKek = await deriveRecoveryKek(
    recoveryKey,
    fromB64(bundle.recovery_salt),
    bundle.kdf_iterations,
  );
  const mk = await unwrapMasterKey(bundle.wrapped_mk_recovery, recoveryKek);

  const authSalt = randomBytes(16);
  const encSalt = randomBytes(16);
  const [authHash, kek] = await Promise.all([
    deriveAuthHash(newPassword, authSalt),
    deriveKek(newPassword, encSalt),
  ]);
  const wrapped = await wrapMasterKey(mk, kek);
  return {
    bundle: {
      ...bundle,
      auth_salt: toB64(authSalt),
      enc_salt: toB64(encSalt),
      wrapped_mk: wrapped,
    },
    authHash,
    mk,
  };
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain letters and numbers.';
  }
  return null;
}
