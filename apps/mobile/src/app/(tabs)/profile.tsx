/** Tab "Profil": Konto, Abmelden und ein paar technische Infos für die Entwicklung */
import Constants from 'expo-constants';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { AppText, Card } from '@/components/ui';
import { WalletCard } from '@/components/wallet-card';
import { Spacing, WebTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';

export default function ProfileScreen() {
  const c = useTheme();
  const { state, signOut } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;

  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="title">Profil</AppText>
        <Card>
          <AppText variant="small">Angemeldet als</AppText>
          <AppText variant="heading">{user?.email ?? '…'}</AppText>
        </Card>
        <WalletCard />
        <Card>
          <AppText variant="small">Bald hier: Abzeichen & deine CO₂-Bilanz 🌱</AppText>
        </Card>
        <Button title="Abmelden" variant="secondary" onPress={signOut} />
        <AppText variant="small" style={styles.tech}>
          Version {Constants.expoConfig?.version} · Server {API_URL}
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.md, paddingTop: Spacing.md + WebTabInset, gap: Spacing.md, maxWidth: 560, width: '100%', alignSelf: 'center' },
  tech: { textAlign: 'center', marginTop: Spacing.lg },
});
