/** Übersicht: die wichtigsten Kennzahlen + "Was braucht gerade Aufmerksamkeit?" */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { EventList } from '../components/EventList';
import { ago, errorText, money } from '../format';

export function OverviewPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 5000 });
  const stations = useQuery({ queryKey: ['stations'], queryFn: api.stations, refetchInterval: 5000 });
  const events = useQuery({ queryKey: ['events', ''], queryFn: () => api.events(''), refetchInterval: 5000 });

  if (overview.isError) return <p className="error">{errorText(overview.error)}</p>;
  const o = overview.data;
  if (!o) return <p className="muted">Lädt …</p>;

  const offline = stations.data?.filter((s) => !s.online) ?? [];
  const blocked = stations.data?.flatMap((s) => s.docks.filter((d) => d.status === 'out_of_service').map((d) => ({ s, d }))) ?? [];
  const totalDocks = o.docks.available + o.docks.reserved + o.docks.occupied + o.docks.out_of_service;

  return (
    <div className="stack">
      <section className="tiles">
        <Tile label="Stationen online" value={`${o.stations.online} / ${o.stations.total}`} tone={o.stations.online < o.stations.total ? 'danger' : 'ok'} />
        <Tile label="Freie Plätze" value={`${o.docks.available} / ${totalDocks}`} />
        <Tile label="Belegt / reserviert" value={`${o.docks.occupied} / ${o.docks.reserved}`} />
        <Tile label="Gesperrte Docks" value={String(o.docks.out_of_service)} tone={o.docks.out_of_service > 0 ? 'warning' : undefined} />
        <Tile label="Laufende Parkvorgänge" value={String(o.openSessions)} />
        <Tile label="Umsatz heute" value={money(o.today.revenueCents)} />
        <Tile label="Parkvorgänge heute" value={String(o.today.completedSessions)} />
        <Tile label="Neue Nutzer heute" value={String(o.today.newUsers)} />
        <Tile label="Aufladungen heute" value={`${money(o.today.topupCents)} (${o.today.topups}×)`} />
        <Tile label="Kundenguthaben gesamt" value={money(o.wallet.totalBalanceCents)} />
      </section>

      <section className="panel">
        <h2>Braucht Aufmerksamkeit</h2>
        {offline.length === 0 && blocked.length === 0 && <p className="muted">Alles in Ordnung ✅</p>}
        <ul className="alerts">
          {offline.map((s) => (
            <li key={s.id} className="alert danger">
              <strong>{s.code}</strong> {s.name} ist <strong>offline</strong> · zuletzt gesehen {ago(s.lastSeenAt)}
            </li>
          ))}
          {blocked.map(({ s, d }) => (
            <li key={d.id} className="alert warning">
              <strong>
                {s.code} · Dock {d.number}
              </strong>{' '}
              gesperrt{d.fault ? ` – Hardware meldet: ${d.fault}` : ''} → <a href="#stationen">zu den Stationen</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Letzte Ereignisse</h2>
        <EventList events={events.data?.slice(0, 8) ?? []} />
      </section>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warning' | 'danger' }) {
  return (
    <div className={`tile ${tone ?? ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
    </div>
  );
}
