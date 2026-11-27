import { createContext, useContext } from 'react';
import type { User } from './api';

interface AuthValue {
  user: User;
  signOut: () => void;
}
export const AuthContext = createContext<AuthValue | null>(null);

/** Eingeloggter Admin + Abmelden – nur innerhalb von <AuthGate> nutzbar */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth nur innerhalb von <AuthGate>');
  return ctx;
}
