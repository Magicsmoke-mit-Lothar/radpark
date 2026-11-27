/** Alle gerade laufenden Parkvorgänge */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ago, duration, errorText, money } from '../format';

export function SessionsPage() {
  const sessions = useQuery({ queryKey: ['sessions', 'open'], queryFn: api.openSessions, refetchInterval: 5000 });

  if (sessions.isError) return <p className="error">{errorText(sessions.error)}</p>;
  if (!sessions.data) return <p className="muted">Lädt …</p>;
  if (sessions.data.length === 0) return <p className="muted">Gerade parkt niemand.</p>;

  return (
    <section className="panel">
      <table className="table">
        <thead>
          <tr>
            <th>Nutzer</th>
            <th>Station</th>
            <th>Dock</th>
            <th>Status</th>
            <th>Dauer</th>
            <th>Bisher</th>
          </tr>
        </thead>
        <tbody>
          {sessions.data.map((s) => (
            <tr key={s.id}>
              <td>{s.userEmail}</td>
              <td>
                {s.stationCode} · {s.stationName}
              </td>
              <td>{s.dockNumber}</td>
              <td>
                {s.status === 'reserved' ? (
                  <span className="pill warning">reserviert {ago(s.reservedAt)}</span>
                ) : s.pickupRequestedAt ? (
                  <span className="pill warning">holt gerade ab</span>
                ) : (
                  <span className="pill ok">parkt</span>
                )}
              </td>
              <td>{s.startedAt ? duration(s.startedAt) : '–'}</td>
              <td className="mono">{money(s.runningPriceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
