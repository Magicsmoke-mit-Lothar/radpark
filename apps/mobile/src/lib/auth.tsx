/**
 * Login-Zustand der App.
 * Beim Start: gespeichertes Token laden und prüfen. Danach weiß jeder Bildschirm über
 * `useAuth()`, ob jemand eingeloggt ist.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setAuthToken, setOnUnauthorized, type User } from './api';
import { deleteToken, loadToken, saveToken } from './token-storage';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: User | null };

interface AuthContextValue {
  state: AuthState;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  const signOut = useCallback(async () => {
    api.logout().catch(() => undefined); // Server Bescheid geben – klappt es nicht, egal
    setAuthToken(null);
    await deleteToken();
    queryClient.clear(); // keine Daten des alten Nutzers im Speicher lassen
    setState({ status: 'signedOut' });
  }, [queryClient]);

  const signIn = useCallback(async (token: string, user: User) => {
    setAuthToken(token);
    await saveToken(token);
    setState({ status: 'signedIn', user });
  }, []);

  // Beim App-Start: gibt es ein gespeichertes Token, und ist es noch gültig?
  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (!token) return setState({ status: 'signedOut' });
      setAuthToken(token);
      try {
        setState({ status: 'signedIn', user: await api.me() });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          await deleteToken();
          setState({ status: 'signedOut' });
        } else {
          // Server gerade nicht erreichbar → trotzdem eingeloggt bleiben
          setState({ status: 'signedIn', user: null });
        }
      }
    })();
  }, []);

  // Sagt der Server irgendwann "Token ungültig" → automatisch ausloggen
  useEffect(() => setOnUnauthorized(() => void signOut()), [signOut]);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return ctx;
}
