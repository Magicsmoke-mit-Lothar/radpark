/** Ereignis-Protokoll mit Filter – live aktualisiert */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { EventList } from '../components/EventList';
import { errorText } from '../format';

const FILTERS = [
  { value: '', label: 'Alle' },
  { value: 'session.', label: 'Parkvorgänge' },
  { value: 'dock.', label: 'Docks' },
  { value: 'station.', label: 'Stationen' },
  { value: 'command.', label: 'Befehle' },
  { value: 'user.', label: 'Nutzer' },
  { value: 'wallet.', label: 'Guthaben' },
  { value: 'dock.fault', label: 'Nur Störungen' },
];

export function EventsPage() {
  const [type, setType] = useState('');
  const events = useQuery({ queryKey: ['events', type], queryFn: () => api.events(type), refetchInterval: 5000 });

  return (
    <div className="stack">
      <div className="filters" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.value} className={`chip ${f.value === type ? 'active' : ''}`} onClick={() => setType(f.value)} aria-pressed={f.value === type}>
            {f.label}
          </button>
        ))}
      </div>
      <section className="panel">
        {events.isError ? <p className="error">{errorText(events.error)}</p> : <EventList events={events.data ?? []} />}
      </section>
    </div>
  );
}
