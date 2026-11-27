/**
 * Login in zwei Schritten: 1. E-Mail eingeben → 2. Code aus der E-Mail eingeben.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { AppText, Banner } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/format';

export default function LoginScreen() {
  const c = useTheme();
  const { signIn } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }];

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestCode(email);
      setDevCode(res.devCode ?? null);
      setCode('');
      setStep('code');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.verifyCode(email, value);
      await signIn(token, user); // → Expo Router wechselt automatisch zur Karte
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
      {/*
        Tastatur-Handling: Android-Apps laufen "edge-to-edge" – das Fenster wird beim Öffnen der
        Tastatur NICHT mehr kleiner. Deshalb auf beiden Plattformen behavior="padding": der Inhalt
        rutscht nach oben. Die ScrollView sorgt dafür, dass man auf kleinen Handys trotzdem alles
        erreicht (und Tippen auf Knöpfe die Tastatur nicht erst schließen muss).
      */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <View style={styles.header}>
            <AppText style={styles.logo}>🚲</AppText>
            <AppText variant="title">RadPark</AppText>
            <AppText variant="secondary">Dein Rad. Sicher geparkt.</AppText>
          </View>

          {step === 'email' ? (
            <View style={styles.form}>
              <AppText variant="heading">Anmelden</AppText>
              <AppText variant="secondary">Wir schicken dir einen Code per E-Mail – ganz ohne Passwort.</AppText>
              <TextInput
                style={inputStyle}
                placeholder="deine@email.de"
                placeholderTextColor={c.muted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={requestCode}
                accessibilityLabel="E-Mail-Adresse"
              />
              {error && <Banner>{error}</Banner>}
              <Button title="Code senden" onPress={requestCode} loading={busy} disabled={!email.includes('@')} />
            </View>
          ) : (
            <View style={styles.form}>
              <AppText variant="heading">Code eingeben</AppText>
              <AppText variant="secondary">Wir haben einen 6-stelligen Code an {email.trim()} geschickt.</AppText>
              {devCode && (
                <Pressable onPress={() => verify(devCode)} accessibilityRole="button">
                  <Banner tone="warning">{`Entwicklungsmodus: Dein Code ist ${devCode} – tippen zum Einsetzen`}</Banner>
                </Pressable>
              )}
              <TextInput
                style={[inputStyle, styles.codeInput]}
                placeholder="000000"
                placeholderTextColor={c.muted}
                value={code}
                onChangeText={(v) => {
                  const digits = v.replace(/\D/g, '').slice(0, 6);
                  setCode(digits);
                  if (digits.length === 6) verify(digits); // automatisch prüfen, sobald 6 Ziffern da sind
                }}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                autoFocus
                maxLength={6}
                accessibilityLabel="Login-Code"
              />
              {error && <Banner>{error}</Banner>}
              <Button title="Anmelden" onPress={() => verify()} loading={busy} disabled={code.length !== 6} />
              <Button
                title="Andere E-Mail verwenden"
                variant="secondary"
                onPress={() => {
                  setStep('email');
                  setError(null);
                }}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: Spacing.lg, justifyContent: 'center', gap: Spacing.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { alignItems: 'center', gap: Spacing.xs },
  logo: { fontSize: 56, lineHeight: 68 },
  form: { gap: Spacing.md },
  input: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md, minHeight: 52, fontSize: 17 },
  codeInput: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: '700' },
});
