/**
 * Die Karte mit allen Stationen (Android & iOS) – OpenStreetMap über MapLibre.
 *
 * Kartenbilder: OpenFreeMap (kostenlos, ohne API-Schlüssel, Daten von OpenStreetMap).
 * Die Pflicht-Quellenangabe ("© OpenStreetMap") blendet MapLibre automatisch ein (ⓘ oben rechts).
 *
 * Die Stationen sind EINE Datenquelle (GeoJSON) mit zwei Ebenen: farbige Kreise + Zahl der freien
 * Plätze. Das zeichnet die Karten-Engine selbst – bleibt auch bei tausenden Stationen flüssig.
 * grün = genug frei, orange = fast voll, rot = voll, grau = offline.
 *
 * Achtung: MapLibre enthält eigenen nativen Code → läuft NICHT in Expo Go, nur in einer eigenen
 * App (Entwickler- oder Test-APK). Im Browser gibt es stattdessen station-map.web.tsx (Liste).
 */
import { Camera, GeoJSONSource, Layer, Map, UserLocation, type InitialViewState } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { Station } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';
import { markerColor, type StationMapProps } from './station-map-shared';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
/** Schrift für die Zahlen – muss im Kartenstil vorhanden sein (OpenFreeMap: Noto Sans) */
const LABEL_FONT = ['Noto Sans Bold'];

/** Kartenausschnitt so wählen, dass alle Stationen zu sehen sind */
function viewFor(stations: Station[]): InitialViewState {
  if (stations.length === 0) return { center: [13.405, 52.52], zoom: 11 }; // Berlin als Notlösung
  if (stations.length === 1) return { center: [stations[0]!.lng, stations[0]!.lat], zoom: 14 };
  const lngs = stations.map((s) => s.lng);
  const lats = stations.map((s) => s.lat);
  return {
    bounds: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
    padding: { top: 80, right: 50, bottom: 80, left: 50 },
  };
}

export function StationMap({ stations, selectedId, onSelect, onDeselect, bottomPadding = 0, showUserLocation }: StationMapProps) {
  const c = useTheme();
  // Nur beim ersten Anzeigen berechnen – danach darf der Nutzer frei verschieben/zoomen
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialViewState = useMemo(() => viewFor(stations), []);

  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: stations.map((s) => ({
        type: 'Feature',
        id: s.id,
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          label: s.online ? String(s.freeDocks) : '–',
          color: markerColor(s, c),
          selected: s.id === selectedId,
        },
      })),
    }),
    [stations, selectedId, c],
  );

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE}
      contentInset={{ bottom: bottomPadding }}
      attributionPosition={{ top: 8, right: 8 }}
      logo={false}
      compass={false}
      // Tipp auf die leere Karte → Auswahl aufheben (Tipps auf Stationen fängt die Quelle unten ab)
      onPress={() => onDeselect()}>
      <Camera initialViewState={initialViewState} />
      {showUserLocation && <UserLocation accuracy />}

      <GeoJSONSource
        id="stations"
        data={data}
        hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}
        onPress={(e) => {
          e.stopPropagation(); // sonst käme der Tipp auch bei der Karte an (= Auswahl wieder weg)
          const id = e.nativeEvent.features[0]?.properties?.id;
          if (typeof id === 'string') onSelect(id);
        }}>
        <Layer
          type="circle"
          id="station-circles"
          paint={{
            'circle-color': ['get', 'color'],
            'circle-radius': ['case', ['get', 'selected'], 22, 17],
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': ['case', ['get', 'selected'], 4, 2.5],
          }}
        />
        <Layer
          type="symbol"
          id="station-labels"
          layout={{
            'text-field': ['get', 'label'],
            'text-font': LABEL_FONT,
            'text-size': ['case', ['get', 'selected'], 17, 15],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          }}
          paint={{ 'text-color': '#FFFFFF' }}
        />
      </GeoJSONSource>
    </Map>
  );
}
