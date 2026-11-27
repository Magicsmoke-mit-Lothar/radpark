import type { AdminEvent } from '../api';
import { clock, eventDetail, eventLabel, eventTone } from '../format';

export function EventList({ events }: { events: AdminEvent[] }) {
  if (events.length === 0) return <p className="muted">Keine Ereignisse.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Zeit</th>
          <th>Ereignis</th>
          <th>Ort</th>
          <th>Nutzer</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td className="mono">{clock(e.createdAt)}</td>
            <td>
              <span className={`pill ${eventTone(e.type, e.payload)}`}>{eventLabel(e.type)}</span>
            </td>
            <td>
              {e.stationCode ?? '–'}
              {e.dockNumber ? ` · ${e.dockNumber}` : ''}
            </td>
            <td className="small">{e.userEmail ?? '–'}</td>
            <td className="small">{eventDetail(e.type, e.payload)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
