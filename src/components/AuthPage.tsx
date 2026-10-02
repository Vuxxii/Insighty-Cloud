import { useState } from 'react';
import './auth.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/700.css';
import {
  recoverAccount,
  requestEmailReset,
  signIn,
  signUp,
  unlockVault,
} from '../cloud/auth';

type Mode = 'signin' | 'signup' | 'recover' | 'unlock';

/**
 * The credentials screen ("warm paper" family). Gates the app when cloud is
 * configured. E2E model shown to the user honestly: we cannot read their data, and
 * the recovery key is the only fallback for a forgotten password.
 */
export function AuthPage({
  initialMode,
  lockedEmail,
  onAuthed,
  onUseOffline,
  onBack,
}: {
  initialMode?: Mode;
  /** Set when a session was restored but the vault is locked. */
  lockedEmail?: string;
  onAuthed: () => void;
  onUseOffline: () => void;
  /** Present when the landing page is behind this screen. */
  onBack?: () => void;
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

  const brandRow = (
    <div className="brand-row">
      <span className="logo">Insightyyy</span>
      <span className="stamp">H.H. HAKAMI</span>
    </div>
  );

  // Post-signup: the recovery key is shown EXACTLY once.
  if (newRecoveryKey) {
    return (
      <div className="ap">
        <div className="center">
          <div className="card">
            {brandRow}
            <h2>Save your recovery key now</h2>
            <p className="intro">
              Your insights are end-to-end encrypted. If you forget your password, this key is the{' '}
              <b>only</b> way to recover your library — we cannot reset it for you, by design.
            </p>
            <div className="keycard">
              <small>RECOVERY KEY — SHOWN ONCE</small>
              <span className="key">{newRecoveryKey}</span>
            </div>
            <div className="keyrow">
              <button
                type="button"
                className="btn-soft"
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
                ⬇ Download file
              </button>
              <button
                type="button"
                className="btn-soft"
                onClick={() => void navigator.clipboard?.writeText(newRecoveryKey)}
              >
                ⧉ Copy
              </button>
            </div>
            <label className="ack">
              <input
                type="checkbox"
                checked={recoveryAcknowledged}
                onChange={(e) => setRecoveryAcknowledged(e.target.checked)}
              />
              <span>I saved my recovery key somewhere safe (not only on this device).</span>
            </label>
            {notice && <p className="notice">{notice}</p>}
            <button
              type="button"
              className="btn-main"
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
          <p className="product-line">A H.H. HAKAMI PRODUCT</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ap">
      <div className="center">
        <div className="card">
          {brandRow}

          <h2>
            {mode === 'signin' && 'Welcome back.'}
            {mode === 'signup' && 'Start your first notebook.'}
            {mode === 'recover' && 'Recover access.'}
            {mode === 'unlock' && 'Unlock your library.'}
          </h2>

          {mode === 'signup' && (
            <div className="lock">
              🔒 Encrypted on your device — nobody else can read your insights. Not even us.
            </div>
          )}
          {mode === 'unlock' && (
            <p className="intro">
              Signed in as <b>{lockedEmail}</b>. Your encryption key lives only in memory — enter
              your password to unlock.
            </p>
          )}
          {mode === 'recover' && (
            <p className="intro">
              Your recovery key unwraps your library, then you choose a new password.
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
                style={{ fontFamily: "'Cascadia Code','SF Mono',Consolas,monospace", fontSize: 13.5 }}
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
              <p className="hint">At least 10 characters, with letters and numbers.</p>
            </>
          )}

          {error && <div className="error">{error}</div>}
          {notice && <p className="notice">{notice}</p>}

          <button type="button" className="btn-main" disabled={busy} onClick={() => void submit()}>
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

          <div className="links">
            {mode === 'signin' && (
              <>
                <button type="button" className="linkish" onClick={() => setMode('signup')}>
                  New here? <b>Create an account</b>
                </button>
                <button type="button" className="linkish" onClick={() => setMode('recover')}>
                  Forgot password? <b>Use your recovery key</b>
                </button>
              </>
            )}
            {mode !== 'signin' && mode !== 'unlock' && (
              <button type="button" className="linkish" onClick={() => setMode('signin')}>
                ← Back to sign in
              </button>
            )}
            {mode === 'recover' && (
              <button
                type="button"
                className="linkish"
                onClick={() =>
                  void run(async () => {
                    await requestEmailReset(email.trim());
                    setNotice('Reset email sent — open its link on this device, then return here.');
                  })
                }
              >
                New device? <b>Send the email reset first</b>
              </button>
            )}
            <div className="divider" />
            <button type="button" className="linkish" onClick={onUseOffline}>
              Use offline without an account (local-only, no sync)
            </button>
            {onBack && (
              <button type="button" className="linkish" onClick={onBack}>
                ← Back to the homepage
              </button>
            )}
          </div>
        </div>
        <p className="product-line">A H.H. HAKAMI PRODUCT</p>
      </div>
    </div>
  );
}
