/**
 * Tab "Karte": alle Stationen mit freien Plätzen. Tippen auf eine Station → Infokarte
 * unten mit "Hier parken".
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { StationMap } from '@/components/station-map';
import { markerColor } from '@/components/station-map-shared';
import { AppText, Banner, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { distanceMeters, useUserLocation } from '@/hooks/use-user-location';
import type { Parking, Station } from '@/lib/api';
import { errorMessage, formatDistance, formatMoney } from '@/lib/format';
import { useCurrentParking, useStartParking, useStations, useWallet } from '@/lib/queries';

const CARD_HEIGHT = 230;

export default function MapScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const stations = useStations();
  const current = useCurrentParking();
  const location = useUserLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = stations.data?.find((s) => s.id === selectedId) ?? null;

  if (stations.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  if (stations.isError && !stations.data) {
    return (
      <View style={[styles.center, { backgroundColor: c.background, padding: Spacing.lg, gap: Spacing.md }]}>
        <Banner>{errorMessage(stations.error)}</Banner>
        <Button title="Erneut versuchen" onPress={() => stations.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <StationMap
        stations={stations.data ?? []}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDeselect={() => setSelectedId(null)}
        bottomPadding={selected ? CARD_HEIGHT : 0}
        showUserLocation={location !== null}
      />

      {stations.isError && (
        <View style={[styles.topBanner, { top: insets.top + Spacing.sm }]}>
          <Banner tone="warning">Verbindung unterbrochen – Anzeige evtl. nicht aktuell</Banner>
        </View>
      )}

      {selected && (
        <View style={styles.bottom}>
          <StationCard
            station={selected}
            distance={location ? distanceMeters(location, { latitude: selected.lat, longitude: selected.lng }) : null}
            current={current.data ?? null}
          />
        </View>
      )}
    </View>
  );
}

function StationCard({ station, distance, current }: { station: Station; distance: number | null; current: Parking | null }) {
  const c = useTheme();
  const start = useStartParking();
  const wallet = useWallet();
  const balanceTooLow = wallet.data ? wallet.data.balanceCents < wallet.data.minStartBalanceCents : false;

  let button: { title: string; disabled?: boolean; onPress: () => void };
  if (current) {
    button = { title: 'Zu meinem Rad', onPress: () => router.navigate('/parking') };
  } else if (!station.online) {
    button = { title: 'Station gerade offline', disabled: true, onPress: () => {} };
  } else if (station.freeDocks === 0) {
    button = { title: 'Kein Platz frei', disabled: true, onPress: () => {} };
  } else if (balanceTooLow) {
    button = { title: 'Erst Guthaben aufladen', onPress: () => router.navigate('/profile') };
  } else {
    button = {
      title: 'Hier parken',
      onPress: () =>
        start.mutate(station.id, {
          onSuccess: () => router.navigate('/parking'),
        }),
    };
  }

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{station.name}</AppText>
          {station.address && <AppText variant="secondary">{station.address}</AppText>}
        </View>
        <View style={[styles.badge, { backgroundColor: markerColor(station, c) }]}>
          <AppText style={styles.badgeText}>{station.online ? `${station.freeDocks}/${station.totalDocks}` : 'offline'}</AppText>
          {station.online && <AppText style={styles.badgeSub}>frei</AppText>}
        </View>
      </View>
      <AppText variant="secondary">
        {formatMoney(station.pricePerHourCents, station.currency)} pro Stunde · erste 5 Min. gratis
        {distance !== null ? ` · ${formatDistance(distance)} entfernt` : ''}
      </AppText>
      {wallet.data && (
        <AppText variant="small" style={{ color: balanceTooLow ? c.danger : c.textSecondary }}>
          Dein Guthaben: {formatMoney(wallet.data.balanceCents, wallet.data.currency)}
        </AppText>
      )}
      {start.isError && <Banner>{errorMessage(start.error)}</Banner>}
      <Button title={button.title} onPress={button.onPress} disabled={button.disabled} loading={start.isPending} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBanner: { position: 'absolute', left: Spacing.md, right: Spacing.md },
  bottom: { position: 'absolute', left: Spacing.md, right: Spacing.md, bottom: Spacing.md },
  card: { gap: Spacing.md, maxWidth: 560, width: '100%', alignSelf: 'center' },
  cardHeader: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center', minWidth: 56 },
  badgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 17 },
  badgeSub: { color: '#FFFFFF', fontSize: 12, marginTop: -2 },
});
