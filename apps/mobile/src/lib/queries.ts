/**
 * Daten laden & aktuell halten (mit TanStack Query).
 *
 * Statt in jedem Bildschirm selbst "laden, Fehler merken, neu laden" zu programmieren,
 * beschreiben wir hier nur WAS geladen wird und WIE OFT es aktualisiert werden soll.
 * Mehrere Bildschirme, die dieselben Daten brauchen, teilen sich automatisch eine Anfrage.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { api, type Parking } from './api';

export const keys = {
  stations: ['stations'] as const,
  current: ['parkings', 'current'] as const,
  history: ['parkings', 'history'] as const,
  wallet: ['wallet'] as const,
};

/** Stationen: alle 10 s aktualisieren (freie Plätze ändern sich) */
export function useStations() {
  return useQuery({ queryKey: keys.stations, queryFn: api.stations, refetchInterval: 10_000 });
}

/**
 * Laufender Parkvorgang. Während etwas passiert (Bügel offen, warten auf Rad),
 * fragen wir alle 2 s nach – sonst reichen 15 s.
 * (Später ersetzen wir das Nachfragen durch Live-Push über WebSockets.)
 */
export function useCurrentParking() {
  return useQuery({
    queryKey: keys.current,
    queryFn: api.currentParking,
    refetchInterval: (query) => {
      const p = query.state.data as Parking | null | undefined;
      const busy = p && (p.status === 'reserved' || p.pickupRequestedAt);
      return busy ? 2_000 : 15_000;
    },
  });
}

export function useHistory() {
  return useQuery({ queryKey: keys.history, queryFn: api.history });
}

/** Nach jeder Aktion: alles Parkbezogene + Stationen neu laden */
function useInvalidateParking() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['parkings'] }),
      qc.invalidateQueries({ queryKey: keys.stations }),
      qc.invalidateQueries({ queryKey: keys.wallet }),
    ]);
}

export function useStartParking() {
  const invalidate = useInvalidateParking();
  return useMutation({ mutationFn: api.startParking, onSettled: invalidate });
}

export function usePickup() {
  const invalidate = useInvalidateParking();
  return useMutation({ mutationFn: api.pickup, onSettled: invalidate });
}

export function useCancelParking() {
  const invalidate = useInvalidateParking();
  return useMutation({ mutationFn: api.cancel, onSettled: invalidate });
}

export function useWallet() {
  return useQuery({ queryKey: keys.wallet, queryFn: api.wallet });
}

/**
 * Guthaben aufladen:
 *  1. Backend legt die Aufladung an (bei Stripe: eine Bezahlseite)
 *  2. Bezahlseite im Browser öffnen – Stripe leitet danach zurück in die App (Profil-Tab)
 *  3. Backend fragt bei Stripe nach, ob wirklich bezahlt wurde → erst dann Gutschrift
 */
export function useTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (amountCents: number) => {
      const returnUrl = Linking.createURL('profile');
      const started = await api.startTopup(amountCents, returnUrl);
      if (started.checkoutUrl) {
        await WebBrowser.openAuthSessionAsync(started.checkoutUrl, returnUrl);
      }
      // Egal ob "zurück" oder "abgebrochen" – den echten Stand beim Backend abfragen
      return api.confirmTopup(started.topupId);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.wallet }),
  });
}
