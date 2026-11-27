/**
 * Guthaben-Karte (im Profil): Kontostand, Aufladen, letzte Buchungen.
 * Alles im TESTMODUS – es fließt kein echtes Geld.
 */
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { AppText, Banner, Card } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage, formatDateTime, formatMoney } from '@/lib/format';
import { useTopup, useWallet } from '@/lib/queries';

export function WalletCard() {
  const c = useTheme();
  const wallet = useWallet();
  const topup = useTopup();
  const w = wallet.data;

  if (wallet.isError) return <Banner>{errorMessage(wallet.error)}</Banner>;
  if (!w) return null;

  const negative = w.balanceCents < 0;
  const tooLow = w.balanceCents < w.minStartBalanceCents;

  return (
    <Card style={{ gap: Spacing.md }}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <AppText variant="small">Guthaben</AppText>
          <AppText variant="title" style={{ color: negative ? c.danger : c.text }} accessibilityLabel={`Guthaben ${formatMoney(w.balanceCents)}`}>
            {formatMoney(w.balanceCents, w.currency)}
          </AppText>
        </View>
        <View style={[styles.testBadge, { borderColor: c.warning }]}>
          <AppText style={{ color: c.warning, fontWeight: '700', fontSize: 12 }}>TESTMODUS</AppText>
        </View>
      </View>

      {tooLow && (
        <Banner tone="warning">
          {negative
            ? 'Dein Guthaben ist im Minus. Bitte lade auf, um wieder parken zu können.'
            : `Zum Parken brauchst du mindestens ${formatMoney(w.minStartBalanceCents)}.`}
        </Banner>
      )}

      <AppText variant="heading" style={{ fontSize: 17 }}>
        Aufladen
      </AppText>
      <View style={styles.row}>
        {w.topupOptions.map((cents) => (
          <Button
            key={cents}
            title={formatMoney(cents)}
            variant="secondary"
            style={{ flex: 1, paddingHorizontal: 0 }}
            loading={topup.isPending && topup.variables === cents}
            disabled={topup.isPending}
            onPress={() => topup.mutate(cents)}
          />
        ))}
      </View>
      <AppText variant="small">
        {w.provider === 'stripe'
          ? 'Stripe-Testmodus: Bezahle mit der Testkarte 4242 4242 4242 4242, beliebiges Ablaufdatum in der Zukunft und beliebige Prüfziffer. Es wird kein echtes Geld abgebucht.'
          : 'Testgutschrift: Das Guthaben wird sofort gutgeschrieben, ohne Bezahlung.'}
      </AppText>
      {topup.isError && <Banner>{errorMessage(topup.error)}</Banner>}
      {topup.isSuccess && topup.data.status === 'succeeded' && <Banner tone="success">Aufladung erfolgreich ✅</Banner>}
      {topup.isSuccess && topup.data.status !== 'succeeded' && (
        <Banner tone="warning">Zahlung noch nicht bestätigt – das Guthaben erscheint, sobald Stripe die Zahlung bestätigt.</Banner>
      )}

      {w.transactions.length > 0 && (
        <View style={{ gap: Spacing.sm }}>
          <AppText variant="heading" style={{ fontSize: 17 }}>
            Letzte Buchungen
          </AppText>
          {w.transactions.slice(0, 10).map((t) => (
            <View key={t.id} style={[styles.tx, { borderColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="secondary" numberOfLines={1}>
                  {t.description}
                </AppText>
                <AppText variant="small">{formatDateTime(t.createdAt)}</AppText>
              </View>
              <AppText style={{ fontWeight: '700', color: t.amountCents < 0 ? c.text : c.success }}>
                {t.amountCents > 0 ? '+' : ''}
                {formatMoney(t.amountCents)}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  testBadge: { borderWidth: 1.5, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  tx: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
