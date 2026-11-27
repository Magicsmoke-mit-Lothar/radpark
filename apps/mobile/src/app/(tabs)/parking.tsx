/**
 * Tab "Mein Rad": zeigt Schritt für Schritt, was gerade passiert.
 *
 *  reserviert            → "Bügel an Dock 3 ist offen – stell dein Rad ein"
 *  aktiv                 → laufende Uhr + Kosten, Knopf "Rad abholen"
 *  aktiv + Abholung läuft → "Bügel offen – nimm dein Rad heraus"
 *  gerade beendet        → Zusammenfassung mit Preis
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { DevSimButton } from '@/components/dev-sim-button';
import { AppText, Banner, Card } from '@/components/ui';
import { Spacing, WebTabInset } from '@/constants/theme';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import type { Parking } from '@/lib/api';
import { endReasonText, errorMessage, formatClock, formatDuration, formatMoney } from '@/lib/format';
import { useCancelParking, useCurrentParking, useHistory, usePickup, useWallet } from '@/lib/queries';

export default function ParkingScreen() {
  const c = useTheme();
  const current = useCurrentParking();
  const parking = current.data ?? null;

  // Merken, welcher Vorgang zuletzt lief – verschwindet er, ist er gerade zu Ende gegangen.
  // (Zustand direkt beim Rendern anpassen statt in einem Effekt – so empfiehlt es React.)
  const [lastId, setLastId] = useState<string | null>(null);
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const currentId = parking?.id ?? null;
  if (currentId !== lastId) {
    setFinishedId(currentId === null ? lastId : null);
    setLastId(currentId);
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={current.isRefetching} onRefresh={() => void current.refetch()} />}>
        <AppText variant="title">Mein Rad</AppText>
        {current.isError && <Banner>{errorMessage(current.error)}</Banner>}

        {parking?.status === 'reserved' && <Reserved parking={parking} />}
        {parking?.status === 'active' && <Active parking={parking} />}
        {!parking && finishedId && <Finished id={finishedId} onDone={() => setFinishedId(null)} />}
        {!parking && !finishedId && current.isSuccess && (
          <Card style={styles.center}>
            <AppText style={styles.emoji}>🅿️</AppText>
            <AppText variant="heading">Kein Rad geparkt</AppText>
            <AppText variant="secondary" style={styles.centerText}>
              Such dir auf der Karte eine Station mit freien Plätzen aus.
            </AppText>
            <Button title="Zur Karte" onPress={() => router.navigate('/')} style={styles.fullWidth} />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Reserved({ parking }: { parking: Parking }) {
  const cancel = useCancelParking();
  return (
    <Card style={styles.center}>
      <AppText variant="secondary">{parking.stationName}</AppText>
      <DockNumber n={parking.dockNumber} />
      <AppText variant="heading" style={styles.centerText}>
        Der Bügel ist offen
      </AppText>
      <AppText variant="secondary" style={styles.centerText}>
        Stell dein Rad in Platz {parking.dockNumber}. Sobald es erkannt wird, schließt der Bügel und die Parkzeit startet.
      </AppText>
      <AppText variant="small" style={styles.centerText}>
        Kommt kein Rad, schließt der Bügel nach etwa einer Minute wieder und die Reservierung endet.
      </AppText>
      <DevSimButton stationCode={parking.stationCode} dock={parking.dockNumber} action="park" />
      {cancel.isError && <Banner>{errorMessage(cancel.error)}</Banner>}
      <Button
        title="Abbrechen"
        variant="secondary"
        loading={cancel.isPending}
        onPress={() => cancel.mutate(parking.id)}
        style={styles.fullWidth}
      />
    </Card>
  );
}

function Active({ parking }: { parking: Parking }) {
  const c = useTheme();
  const now = useNow();
  const pickup = usePickup();
  const elapsed = now - new Date(parking.startedAt ?? parking.reservedAt).getTime();

  if (parking.pickupRequestedAt) {
    return (
      <Card style={styles.center}>
        <DockNumber n={parking.dockNumber} />
        <AppText variant="heading" style={styles.centerText}>
          Bügel offen – nimm dein Rad heraus
        </AppText>
        <AppText variant="secondary" style={styles.centerText}>
          Sobald dein Rad entnommen ist, wird der Parkvorgang automatisch beendet.
        </AppText>
        <DevSimButton stationCode={parking.stationCode} dock={parking.dockNumber} action="take" />
      </Card>
    );
  }

  return (
    <Card style={styles.center}>
      <AppText variant="secondary">
        {parking.stationName} · Platz {parking.dockNumber}
      </AppText>
      <AppText style={[styles.clock, { color: c.text }]}>{formatClock(elapsed)}</AppText>
      <AppText variant="secondary">Parkzeit</AppText>
      <AppText variant="heading">{formatMoney(parking.runningPriceCents ?? 0, parking.currency)} bisher</AppText>
      <AppText variant="small" style={styles.centerText}>
        {formatMoney(parking.pricePerHourCents, parking.currency)} je angefangene Stunde · erste 5 Min. gratis
      </AppText>
      {pickup.isError && <Banner>{errorMessage(pickup.error)}</Banner>}
      <Button title="Rad abholen" loading={pickup.isPending} onPress={() => pickup.mutate(parking.id)} style={styles.fullWidth} />
    </Card>
  );
}

function Finished({ id, onDone }: { id: string; onDone: () => void }) {
  const history = useHistory();
  const wallet = useWallet();
  const { refetch } = history;
  const { refetch: refetchWallet } = wallet;
  // Verlauf & Guthaben frisch laden – der beendete Vorgang soll mit Endpreis und Abbuchung erscheinen
  useEffect(() => {
    refetch();
    refetchWallet();
  }, [id, refetch, refetchWallet]);
  const p = history.data?.find((h) => h.id === id);
  if (!p) return null;

  const completed = p.status === 'completed';
  const duration = p.startedAt && p.endedAt ? new Date(p.endedAt).getTime() - new Date(p.startedAt).getTime() : null;
  const reason = endReasonText(p.endReason);

  return (
    <Card style={styles.center}>
      <AppText style={styles.emoji}>{completed ? '✅' : 'ℹ️'}</AppText>
      <AppText variant="heading">{completed ? 'Gute Fahrt!' : 'Parkvorgang beendet'}</AppText>
      {reason && <AppText variant="secondary">{reason}</AppText>}
      {completed && (
        <>
          {duration !== null && <AppText variant="secondary">Parkdauer: {formatDuration(duration)}</AppText>}
          <AppText variant="title">{formatMoney(p.priceCents ?? 0, p.currency)}</AppText>
          {(p.priceCents ?? 0) > 0 && <AppText variant="secondary">wurde von deinem Guthaben abgebucht</AppText>}
          {wallet.data && <AppText variant="small">Neues Guthaben: {formatMoney(wallet.data.balanceCents, wallet.data.currency)}</AppText>}
        </>
      )}
      <Button title="OK" onPress={onDone} style={styles.fullWidth} />
    </Card>
  );
}

function DockNumber({ n }: { n: number }) {
  const c = useTheme();
  return (
    <View style={[styles.dock, { borderColor: c.primary }]}>
      <AppText variant="small">Platz</AppText>
      <AppText style={[styles.dockNumber, { color: c.primary }]}>{n}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.md, paddingTop: Spacing.md + WebTabInset, gap: Spacing.md, maxWidth: 560, width: '100%', alignSelf: 'center' },
  center: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.lg },
  centerText: { textAlign: 'center' },
  fullWidth: { alignSelf: 'stretch' },
  emoji: { fontSize: 48, lineHeight: 58 },
  clock: { fontSize: 56, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dock: { width: 110, height: 110, borderRadius: 55, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  dockNumber: { fontSize: 48, fontWeight: '900', lineHeight: 54 },
});
