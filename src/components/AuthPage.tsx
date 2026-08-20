import { useState } from 'react';
import {
  recoverAccount,
  requestEmailReset,
  signIn,
  signUp,
  unlockVault,
} from '../cloud/auth';

type Mode = 'signin' | 'signup' | 'recover' | 'unlock';

/**
 * The credentials page. Gates the app when cloud is configured. E2E model shown to
 * the user honestly: we cannot read their data, and the recovery key is the only
 * fallback for a forgotten password.
 */
export function AuthPage({
  initialMode,
  lockedEmail,
  onAuthed,
  onUseOffline,
}: {
  initialMode?: Mode;
  /** Set when a session was restored but the vault is locked. */
  lockedEmail?: string;
  onAuthed: () => void;
  onUseOffline: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode ?? 'signin');
  const [email, setEmail] = useState(lockedEmail ?? '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const submit = () =>
    run(async () => {
      if (mode === 'unlock') {
        await unlockVault(password);
        onAuthed();
      } else if (mode === 'signin') {
        await signIn(email.trim(), password);
        onAuthed();
      } else if (mode === 'signup') {
        if (password !== password2) throw new Error('Passwords do not match.');
        const { recoveryKey, needsEmailConfirm } = await signUp(email.trim(), password);
        setNewRecoveryKey(recoveryKey);
        if (needsEmailConfirm) {
          setNotice('Check your email to confirm the account, then sign in.');
        }
      } else if (mode === 'recover') {
        await recoverAccount(email.trim(), recoveryKeyInput, password);
        onAuthed();
      }
    });

  // Post-signup: the recovery key is shown EXACTLY once.
  if (newRecoveryKey) {
    return (
      <div className="error-overlay" style={{ position: 'static', minHeight: '100vh' }}>
        <div className="dialog">
          <h2>Save your recovery key now</h2>
          <p>
            Your insights are end-to-end encrypted. If you forget your password, this key is the{' '}
            <strong>only</strong> way to recover your library — we cannot reset it for you, by
            design.
          </p>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 18,
              padding: '14px 10px',
              background: 'var(--bg-input)',
              border: '1px solid var(--accent)',
              borderRadius: 8,
              textAlign: 'center',
              userSelect: 'all',
              overflowWrap: 'break-word',
            }}
          >
            {newRecoveryKey}
          </div>
          <div className="dialog-actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const blob = new Blob(
                  [`Insightyyy recovery key for ${email}\n\n${newRecoveryKey}\n`],
                  { type: 'text/plain' },
                );
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'insightyyy-recovery-key.txt';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
              }}
            >
              Download as file
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.clipboard?.writeText(newRecoveryKey)}
            >
              Copy
            </button>
          </div>
          <label style={{ color: 'inherit', marginTop: 14 }}>
            <input
              type="checkbox"
              checked={recoveryAcknowledged}
              onChange={(e) => setRecoveryAcknowledged(e.target.checked)}
            />{' '}
            I saved my recovery key somewhere safe (not only on this device).
          </label>
          {notice && <p className="muted">{notice}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!recoveryAcknowledged}
              onClick={() => {
                if (notice) setMode('signin');
                setNewRecoveryKey(null);
                if (!notice) onAuthed();
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="error-overlay" style={{ position: 'static', minHeight: '100vh' }}>
      <div className="dialog" style={{ maxWidth: 440 }}>
        <div className="brand" style={{ marginBottom: 12 }}>
          <span className="brand-name">Insightyyy</span>
          <span className="brand-stamp">HAKAMI</span>
        </div>

        <h2>
          {mode === 'signin' && 'Sign in'}
          {mode === 'signup' && 'Create your account'}
          {mode === 'recover' && 'Recover access'}
          {mode === 'unlock' && `Unlock — ${lockedEmail}`}
        </h2>

        {mode === 'signup' && (
          <p className="muted">
            Insights are encrypted on your device before upload. Nobody — including this service —
            can read them without your password.
          </p>
        )}
        {mode === 'unlock' && (
          <p className="muted">
            You are signed in, but the encryption key only lives in memory — enter your password to
            unlock your library.
          </p>
        )}

        {mode !== 'unlock' && (
          <>
            <label>Email</label>
            <input
              type="text"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </>
        )}

        {mode === 'recover' && (
          <>
            <label>Recovery key</label>
            <input
              type="text"
              value={recoveryKeyInput}
              onChange={(e) => setRecoveryKeyInput(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              style={{ fontFamily: 'var(--mono)' }}
            />
          </>
        )}

        <label>{mode === 'recover' ? 'New password' : 'Password'}</label>
        <input
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && mode !== 'signup') void submit();
          }}
        />
        {mode === 'signup' && (
          <>
            <label>Repeat password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
            <p className="muted">At least 10 characters, with letters and numbers.</p>
          </>
        )}

        {error && <div className="warning-box">{error}</div>}
        {notice && <p className="muted">{notice}</p>}

        <div className="dialog-actions" style={{ justifyContent: 'stretch' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy
              ? 'Working…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'recover'
                    ? 'Recover & set new password'
                    : 'Unlock'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14 }}>
          {mode !== 'signin' && mode !== 'unlock' && (
            <button type="button" className="btn btn-ghost" onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          )}
          {mode === 'signin' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('signup')}>
                New here? Create an account
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('recover')}>
                Forgot password? Use your recovery key
              </button>
            </>
          )}
          {mode === 'recover' && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                void run(async () => {
                  await requestEmailReset(email.trim());
                  setNotice('Reset email sent — open its link on this device, then return here.');
                })
              }
            >
              New device? Send the email reset first
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onUseOffline}>
            Use offline without an account (local-only, no sync)
          </button>
        </div>
      </div>
    </div>
  );
}
