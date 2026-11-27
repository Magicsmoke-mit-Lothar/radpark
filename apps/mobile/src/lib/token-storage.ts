import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Speichert das Login-Token dauerhaft – auf dem Handy VERSCHLÜSSELT (Android Keystore),
 * damit andere Apps es nicht auslesen können. Im Browser (nur zum Entwickeln) im localStorage.
 */
const KEY = 'radpark.authToken';

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY);
}

export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === 'web') return globalThis.localStorage?.setItem(KEY, token);
  await SecureStore.setItemAsync(KEY, token);
}

export async function deleteToken(): Promise<void> {
  if (Platform.OS === 'web') return globalThis.localStorage?.removeItem(KEY);
  await SecureStore.deleteItemAsync(KEY);
}
