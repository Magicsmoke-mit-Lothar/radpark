/**
 * Browser-Ersatz für die Karte (nur zum Entwickeln/Testen am Rechner):
 * react-native-maps funktioniert nicht im Browser, deshalb zeigen wir hier eine Liste.
 * Expo wählt automatisch: auf dem Handy station-map.tsx, im Browser diese Datei.
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui';
import { Radius, Spacing, WebTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { markerColor, type StationMapProps } from './station-map-shared';

export function StationMap({ stations, selectedId, onSelect, bottomPadding = 0 }: StationMapProps) {
  const c = useTheme();
  return (
    <ScrollView
      style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]}
      contentContainerStyle={{ padding: Spacing.md, paddingTop: WebTabInset, paddingBottom: bottomPadding + Spacing.md, gap: Spacing.sm }}>
      <AppText variant="small">Browser-Vorschau: Die Karte gibt es nur in der Handy-App.</AppText>
      {stations.map((s) => (
        <Pressable
          key={s.id}
          accessibilityRole="button"
          accessibilityLabel={`Station ${s.name}`}
          onPress={() => onSelect(s.id)}
          style={[
            styles.row,
            { backgroundColor: c.card, borderColor: s.id === selectedId ? c.primary : c.border },
          ]}>
          <View style={[styles.dot, { backgroundColor: markerColor(s, c) }]}>
            <AppText style={styles.dotText}>{s.online ? s.freeDocks : '–'}</AppText>
          </View>
          <AppText variant="heading" style={{ flex: 1 }}>
            {s.name}
          </AppText>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 2,
  },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dotText: { color: '#FFFFFF', fontWeight: '800' },
});
