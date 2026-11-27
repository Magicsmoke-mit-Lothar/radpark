import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * Fragt (einmalig) nach der Standort-Erlaubnis und liefert die aktuelle Position.
 * Sagt der Nutzer "Nein", funktioniert die App trotzdem – nur ohne Entfernungsangaben.
 */
export function useUserLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch {
        // z. B. GPS aus – kein Problem
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return coords;
}

/** Entfernung zweier Punkte in Metern (Haversine-Formel, Erde als Kugel) */
export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
