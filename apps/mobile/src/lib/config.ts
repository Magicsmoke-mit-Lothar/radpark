import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Wo läuft das Backend?
 *
 * Während der Entwicklung läuft das Backend auf deinem Rechner. Das Handy kennt dessen
 * Adresse aber nicht als "localhost" – für das Handy ist "localhost" das Handy selbst!
 * Trick: Expo Go hat sich ohnehin schon mit deinem Rechner verbunden (um die App zu laden).
 * Diese Adresse (z. B. 192.168.1.20:8081) nehmen wir und tauschen nur den Port gegen 3000.
 *
 * Später (echter Server) setzt man einfach EXPO_PUBLIC_API_URL=https://api.radpark.de
 */
function resolveApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3000`;
  }

  const devServerHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (devServerHost) return `http://${devServerHost}:3000`;

  return 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();
