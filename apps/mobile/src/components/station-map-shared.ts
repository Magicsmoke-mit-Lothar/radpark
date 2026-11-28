/** Gemeinsam genutzt von station-map.tsx (Handy) und station-map.web.tsx (Browser) */
import type { ThemeColors } from '@/constants/theme';
import type { Station } from '@/lib/api';

export interface StationMapProps {
  stations: Station[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  /** Platz unten für die Stationskarte, damit der Kartenmittelpunkt nicht dahinter verschwindet */
  bottomPadding?: number;
  /** Eigenen Standort anzeigen (nur wenn die Standort-Erlaubnis erteilt wurde) */
  showUserLocation?: boolean;
}

/** grün = genug frei, orange = fast voll, rot = voll, grau = offline */
export function markerColor(s: Station, c: ThemeColors) {
  if (!s.online) return c.muted;
  if (s.freeDocks === 0) return c.danger;
  if (s.freeDocks <= 2) return c.warning;
  return c.success;
}
