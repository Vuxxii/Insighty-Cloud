import { getSupabase } from './supabase';
import {
  createAccountKeys,
  deriveAuthHash,
  fromB64,
  recoverWithRecoveryKey,
  unlockWithPassword,
  validatePasswordStrength,
  type AccountKeyBundle,
} from './crypto';
import { getMeta, updateMeta } from '../db/db';

/**
 * The unlocked master key lives ONLY in memory. Sign-out, reload, or tab close
 * drops it; unlocking re-derives it from the password. Nothing key-like ever
 * touches localStorage/sessionStorage.
 */
let masterKey: CryptoKey | null = null;
let currentUserId: string | null = null;
let currentEmail: string | null = null;

export function getMasterKey(): CryptoKey | null {
  return masterKey;
}

export function getUserId(): string | null {
  return currentUserId;
}

export function getUserEmail(): string | null {
  return currentEmail;
}

export function isUnlocked(): boolean {
  return masterKey !== null && currentUserId !== null;
}

export function lock(): void {
  masterKey = null;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

async function fetchKeyBundle(userId: string): Promise<AccountKeyBundle> {
  const { data, error } = await getSupabase()
    .from('user_keys')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new AuthError('Could not load your encryption keys.');
  return data as unknown as AccountKeyBundle;
}

/** Cache the (already-encrypted) key bundle locally so future logins can unwrap
 * offline and so the salts don't need a pre-auth fetch. Safe: it is ciphertext. */
async function cacheBundle(email: string, bundle: AccountKeyBundle): Promise<void> {
  await updateMeta({ cloud_key_cache: { email: email.toLowerCase(), bundle } });
}

export async function signUp(
  email: string,
  password: string,
): Promise<{ recoveryKey: string; needsEmailConfirm: boolean }> {
  const weak = validatePasswordStrength(password);
  if (weak) throw new AuthError(weak);
  const supabase = getSupabase();

  const { bundle, authHash, mk, recoveryKey } = await createAccountKeys(password);

  const { data, error } = await supabase.auth.signUp({ email, password: authHash });
  if (error) throw new AuthError(error.message);
  const user = data.user;
  if (!user) throw new AuthError('Sign-up did not return an account.');

  // If email confirmation is on, there is no session yet — the key bundle upload
  // happens on first login instead (bundle is cached locally until then).
  if (data.session) {
    const { error: keyError } = await supabase.from('user_keys').insert({
      user_id: user.id,
      ...bundle,
    });
    if (keyError) throw new AuthError(`Account created but key upload failed: ${keyError.message}`);
    masterKey = mk;
    currentUserId = user.id;
    currentEmail = email;
  }
  await cacheBundle(email, bundle);
  await updateMeta({ cloud_pending_bundle: data.session ? null : { email: email.toLowerCase(), bundle } });
  return { recoveryKey, needsEmailConfirm: !data.session };
}

async function resolveLoginBundle(email: string): Promise<AccountKeyBundle | null> {
  const meta = await getMeta();
  const cached = meta.cloud_key_cache;
  if (cached && cached.email === email.toLowerCase()) return cached.bundle;
  const pending = meta.cloud_pending_bundle;
  if (pending && pending.email === email.toLowerCase()) return pending.bundle;
  return null;
}

export async function signIn(email: string, password: string): Promise<void> {
  const supabase = getSupabase();

  // Salts come from the local cache when this device has seen the account before,
  // otherwise from the pre-auth RPC (exposes salts only — standard for E2E login).
  let bundle = await resolveLoginBundle(email);
  let authHash: string;
  if (bundle) {
    ({ authHash } = await unlockWithPassword(password, bundle).catch(() => {
      throw new AuthError('Wrong password.');
    }));
  } else {
    const { data: params, error } = await supabase.rpc('get_login_params', { p_email: email });
    const row = Array.isArray(params) ? params[0] : params;
    if (error || !row) throw new AuthError('No account found for that email.');
    authHash = await deriveAuthHash(password, fromB64(row.auth_salt), row.kdf_iterations);
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: authHash });
  if (error) throw new AuthError(error.message);
  const user = data.user;
  if (!user) throw new AuthError('Login did not return an account.');

  // First login after an email-confirmation signup: upload the pending bundle.
  const meta = await getMeta();
  if (meta.cloud_pending_bundle?.email === email.toLowerCase()) {
    await supabase.from('user_keys').upsert({ user_id: user.id, ...meta.cloud_pending_bundle.bundle });
    await updateMeta({ cloud_pending_bundle: null });
  }

  if (!bundle) {
    bundle = await fetchKeyBundle(user.id);
    await cacheBundle(email, bundle);
  }
  const { mk } = await unlockWithPassword(password, bundle).catch(() => {
    throw new AuthError('Wrong password.');
  });
  masterKey = mk;
  currentUserId = user.id;
  currentEmail = email;
}

/** Restore the Supabase session after a reload. The vault stays LOCKED until the
 * user re-enters their password (E2E: the key is never persisted). */
export async function restoreSession(): Promise<{ email: string } | null> {
  const { data } = await getSupabase().auth.getSession();
  const session = data.session;
  if (!session?.user) return null;
  currentUserId = session.user.id;
  currentEmail = session.user.email ?? null;
  return { email: session.user.email ?? '' };
}

/** Unlock after a session restore (user is authenticated but the MK is gone). */
export async function unlockVault(password: string): Promise<void> {
  if (!currentUserId || !currentEmail) throw new AuthError('Not signed in.');
  let bundle = await resolveLoginBundle(currentEmail);
  if (!bundle) {
    bundle = await fetchKeyBundle(currentUserId);
    await cacheBundle(currentEmail, bundle);
  }
  const { mk } = await unlockWithPassword(password, bundle).catch(() => {
    throw new AuthError('Wrong password.');
  });
  masterKey = mk;
}

/** Forgotten password: recovery key unwraps the MK, a new password re-wraps it,
 * and the Supabase login password is rotated to the new auth hash. */
export async function recoverAccount(
  email: string,
  recoveryKey: string,
  newPassword: string,
): Promise<void> {
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new AuthError(weak);
  const supabase = getSupabase();

  let bundle = await resolveLoginBundle(email);
  if (!bundle) {
    // Without a session we cannot read user_keys (RLS) — recovery on a brand-new
    // device requires the Supabase email reset flow first. With the cached bundle
    // (any previously-used device) it works fully offline from the server's view.
    throw new AuthError(
      'Recovery needs a device this account has been used on, or complete the ' +
        '"email reset" path first (see Account help).',
    );
  }
  const {
    bundle: newBundle,
    authHash,
    mk,
  } = await recoverWithRecoveryKey(recoveryKey, newPassword, bundle).catch(() => {
    throw new AuthError('That recovery key does not match.');
  });

  // Sign in using the recovered credentials is impossible (old authHash unknown), so
  // rotate via the email-reset session if present, else require an active session.
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw new AuthError(
      'Open the password-reset link from your email first, then enter the recovery key.',
    );
  }
  const userId = data.session.user.id;
  const { error: pwError } = await supabase.auth.updateUser({ password: authHash });
  if (pwError) throw new AuthError(pwError.message);
  const { error: keyError } = await supabase
    .from('user_keys')
    .update({ ...newBundle })
    .eq('user_id', userId);
  if (keyError) throw new AuthError(keyError.message);

  await cacheBundle(email, newBundle);
  masterKey = mk;
  currentUserId = userId;
  currentEmail = email;
}

/** Send the Supabase reset email (step 1 of new-device recovery). */
export async function requestEmailReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw new AuthError(error.message);
}

export async function signOut(): Promise<void> {
  masterKey = null;
  currentUserId = null;
  currentEmail = null;
  await getSupabase().auth.signOut();
}
