/**
 * Die Karte mit allen Stationen (Android & iOS).
 * Jede Station ist eine kleine "Blase" mit der Zahl der freien Plätze:
 * grün = genug frei, orange = fast voll, rot = voll, grau = offline.
 * (Für den Browser gibt es station-map.web.tsx – dort ersetzt eine Liste die Karte.)
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { Station } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';
import { markerColor, type StationMapProps } from './station-map-shared';

/** Kartenausschnitt so wählen, dass alle Stationen zu sehen sind */
function regionFor(stations: Station[]): Region {
  const lats = stations.map((s) => s.lat);
  const lngs = stations.map((s) => s.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.6),
  };
}

export function StationMap({ stations, selectedId, onSelect, onDeselect, bottomPadding = 0 }: StationMapProps) {
  const c = useTheme();
  // Nur beim ersten Anzeigen berechnen – danach darf der Nutzer frei verschieben
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialRegion = useMemo(() => regionFor(stations), []);

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      showsUserLocation
      showsMyLocationButton
      toolbarEnabled={false}
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomPadding }}
      onPress={(e) => {
        // Auf Android löst ein Tipp auf einen Marker AUCH einen Karten-Tipp aus → ignorieren
        if (e.nativeEvent.action !== 'marker-press') onDeselect();
      }}>
      {stations.map((s) => {
        const selected = s.id === selectedId;
        const color = markerColor(s, c);
        return (
          <Marker
            // Neuer key bei jeder Änderung → Marker wird neu gezeichnet (nötig wegen tracksViewChanges=false)
            key={`${s.id}-${s.freeDocks}-${s.online}-${selected}`}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            onPress={() => onSelect(s.id)}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 1 }}
            accessibilityLabel={`${s.name}, ${s.freeDocks} von ${s.totalDocks} frei`}>
            <View style={styles.markerWrap}>
              <View style={[styles.bubble, { backgroundColor: color, transform: [{ scale: selected ? 1.2 : 1 }] }]}>
                <Text style={styles.bubbleText}>{s.online ? s.freeDocks : '–'}</Text>
              </View>
              <View style={[styles.arrow, { borderTopColor: color }]} />
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  markerWrap: { alignItems: 'center', padding: 4 },
  bubble: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  bubbleText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
});
