/**
 * Login fürs Dashboard (gleicher E-Mail-Code wie in der App) – aber nur Admins kommen rein.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, setOnUnauthorized, tokenStore, type User } from './api';
import { AuthContext } from './auth-context';
import { errorText } from './format';

/** Zeigt das Login, bis ein Admin eingeloggt ist – danach die Kinder (das Dashboard) */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(() => tokenStore.get() !== null);

  const signOut = useCallback(() => {
    api.logout().catch(() => undefined);
    tokenStore.clear();
    qc.clear();
    setUser(null);
  }, [qc]);

  useEffect(() => setOnUnauthorized(signOut), [signOut]);

  // Gespeichertes Token beim Laden prüfen
  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .me()
      .then((u) => (u.role === 'admin' ? setUser(u) : signOut()))
      .catch(() => tokenStore.clear())
      .finally(() => setChecking(false));
  }, [signOut]);

  if (checking) return null;
  if (!user) return <LoginForm onSuccess={setUser} />;
  return <AuthContext.Provider value={{ user, signOut }}>{children}</AuthContext.Provider>;
}

function LoginForm({ onSuccess }: { onSuccess: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'email') {
        const r = await api.requestCode(email);
        setDevCode(r.devCode ?? null);
        setStep('code');
      } else {
        const r = await api.verify(email, code);
        if (r.user.role !== 'admin') {
          setError('Dieses Konto hat keine Admin-Rechte. (Freischalten: pnpm admin:grant <email>)');
          return;
        }
        tokenStore.set(r.token);
        onSuccess(r.user);
      }
    } catch (err) {
      // Gerade erst einen Code bekommen? Dann direkt zur Code-Eingabe – der erste ist noch gültig.
      if (step === 'email' && err instanceof ApiError && err.code === 'TOO_MANY_REQUESTS') setStep('code');
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/favicon.svg" alt="" width={48} height={48} />
        <h1>RadPark Admin</h1>
        <p className="muted">Betreiber-Dashboard</p>
        {step === 'email' ? (
          <label>
            E-Mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@radpark.dev" autoFocus required />
          </label>
        ) : (
          <>
            {devCode && (
              <button type="button" className="hint" onClick={() => setCode(devCode)}>
                Entwicklungsmodus: Code {devCode} – klicken zum Einsetzen
              </button>
            )}
            <p className="muted small">Wir haben dir einen Code per E-Mail geschickt (auch im Spam-Ordner nachsehen).</p>
            <label>
              Code aus der E-Mail
              <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" autoFocus required />
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {step === 'email' ? 'Code senden' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
