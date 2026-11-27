/**
 * Wurzel der App: stellt Datenabruf (TanStack Query), Login-Zustand und Navigation bereit.
 *
 * Navigation mit "Stack.Protected":
 *  - eingeloggt   → nur die Tabs (Karte, Mein Rad, Verlauf, Profil) sind erreichbar
 *  - ausgeloggt   → nur der Login-Bildschirm
 * Expo Router leitet automatisch um, wenn sich der Login-Zustand ändert.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';

// Startbildschirm (Logo) so lange zeigen, bis wir wissen, ob jemand eingeloggt ist
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const { state } = useAuth();
  const scheme = useColorScheme();

  useEffect(() => {
    if (state.status !== 'loading') SplashScreen.hideAsync();
  }, [state.status]);

  if (state.status === 'loading') return null;
  const signedIn = state.status === 'signedIn';

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
