/**
 * Stationen live: jedes Dock als farbige Kachel. Klick auf eine Kachel öffnet die
 * Detailansicht mit Aktionen (freigeben, sperren, entriegeln, LED blinken).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type AdminDock, type AdminStation, type DockCommand } from '../api';
import { ago, dockStatusLabel, duration, errorText, lockLabel, money } from '../format';

export function StationsPage() {
  const stations = useQuery({ queryKey: ['stations'], queryFn: api.stations, refetchInterval: 3000 });
  const [selected, setSelected] = useState<{ stationId: string; dockId: string } | null>(null);

  if (stations.isError) return <p className="error">{errorText(stations.error)}</p>;
  if (!stations.data) return <p className="muted">Lädt …</p>;

  const station = stations.data.find((s) => s.id === selected?.stationId);
  const dock = station?.docks.find((d) => d.id === selected?.dockId);

  return (
    <div className="with-aside">
      <div className="stack">
        <Legend />
        {stations.data.map((s) => (
          <StationCard key={s.id} station={s} selectedDockId={selected?.dockId} onSelect={(d) => setSelected({ stationId: s.id, dockId: d.id })} />
        ))}
      </div>
      {/* key = Dock-ID: beim Wechsel auf ein anderes Dock startet das Panel frisch (alte Meldungen weg) */}
      {station && dock && <DockPanel key={dock.id} station={station} dock={dock} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend small">
      <span><i className="dot available" /> frei</span>
      <span><i className="dot reserved" /> reserviert</span>
      <span><i className="dot occupied" /> belegt</span>
      <span><i className="dot out_of_service" /> gesperrt</span>
      <span>🚲 Rad erkannt · 🔓 Bügel offen · ⚠️ Störung</span>
    </div>
  );
}

function StationCard({ station: s, selectedDockId, onSelect }: { station: AdminStation; selectedDockId?: string; onSelect: (d: AdminDock) => void }) {
  return (
    <section className="panel">
      <header className="station-head">
        <div>
          <h2>
            <span className={`status-dot ${s.online ? 'on' : 'off'}`} aria-label={s.online ? 'online' : 'offline'} /> {s.code} · {s.name}
          </h2>
          <p className="muted small">
            {s.address} · {money(s.pricePerHourCents)}/h · {s.online ? 'online' : `offline – zuletzt gesehen ${ago(s.lastSeenAt)}`}
            {s.firmware ? ` · Firmware ${s.firmware}` : ''}
          </p>
        </div>
      </header>
      <div className="docks">
        {s.docks.map((d) => (
          <button
            key={d.id}
            className={`dock ${d.status} ${d.id === selectedDockId ? 'selected' : ''} ${s.online ? '' : 'stale'}`}
            onClick={() => onSelect(d)}
            aria-label={`Dock ${d.number}: ${dockStatusLabel[d.status]}`}>
            <span className="dock-no">{d.number}</span>
            <span className="dock-icons">
              {d.fault || d.lockState === 'jammed' ? '⚠️' : d.bikePresent ? '🚲' : d.lockState === 'unlocked' ? '🔓' : ''}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DockPanel({ station, dock, onClose }: { station: AdminStation; dock: AdminDock; onClose: () => void }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const action = useMutation({
    mutationFn: async (a: { kind: 'release' } | { kind: 'disable'; reason: string } | { kind: 'command'; type: DockCommand }) => {
      if (a.kind === 'release') return api.releaseDock(dock.id);
      if (a.kind === 'disable') return api.disableDock(dock.id, a.reason || undefined);
      return api.dockCommand(dock.id, a.type);
    },
    onSuccess: () => setMessage({ ok: true, text: 'Erledigt ✅' }),
    onError: (err) => setMessage({ ok: false, text: errorText(err) }),
    onSettled: () => qc.invalidateQueries(),
  });

  function disable() {
    const reason = window.prompt('Grund für die Sperrung (optional):');
    if (reason === null) return; // "Abbrechen" gedrückt → nichts tun
    action.mutate({ kind: 'disable', reason });
  }

  function unlock() {
    const warning = dock.userEmail
      ? `Achtung: In diesem Dock parkt ${dock.userEmail}. Entriegeln gibt das Rad frei! Wirklich entriegeln?`
      : `Dock ${dock.number} an ${station.code} entriegeln?`;
    if (window.confirm(warning)) action.mutate({ kind: 'command', type: 'unlock' });
  }

  return (
    <aside className="panel aside" aria-label={`Dock ${dock.number}`}>
      <header className="aside-head">
        <h2>
          {station.code} · Dock {dock.number}
        </h2>
        <button className="btn ghost small" onClick={onClose} aria-label="Schließen">
          ✕
        </button>
      </header>

      <dl className="facts">
        <dt>Status</dt>
        <dd><span className={`pill dock-${dock.status}`}>{dockStatusLabel[dock.status]}</span></dd>
        <dt>Schloss</dt>
        <dd>{lockLabel[dock.lockState]}</dd>
        <dt>Rad im Dock</dt>
        <dd>{dock.bikePresent ? 'ja' : 'nein'}</dd>
        <dt>Störung</dt>
        <dd>{dock.fault ?? '–'}</dd>
        <dt>Letzte Meldung</dt>
        <dd>{ago(dock.stateUpdatedAt)}</dd>
        {dock.sessionId && (
          <>
            <dt>Parkvorgang</dt>
            <dd>
              {dock.sessionStatus === 'active' ? 'läuft' : 'reserviert'} · {dock.userEmail}
              {dock.sessionStartedAt ? ` · seit ${duration(dock.sessionStartedAt)}` : ''}
            </dd>
          </>
        )}
      </dl>

      {message && <p className={message.ok ? 'success' : 'error'}>{message.text}</p>}

      <div className="actions">
        {dock.status === 'out_of_service' ? (
          <button className="btn primary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'release' })}>
            Wieder freigeben
          </button>
        ) : (
          <button className="btn" disabled={action.isPending || !!dock.sessionId} onClick={disable} title={dock.sessionId ? 'Gerade gebucht' : undefined}>
            Sperren
          </button>
        )}
        <button className="btn" disabled={action.isPending || !station.online} onClick={unlock}>
          Entriegeln (Service)
        </button>
        <button className="btn" disabled={action.isPending || !station.online} onClick={() => action.mutate({ kind: 'command', type: 'identify' })}>
          LED blinken
        </button>
      </div>
      {!station.online && <p className="muted small">Station offline – Befehle nicht möglich.</p>}
      {dock.status === 'out_of_service' && dock.fault && (
        <p className="muted small">Freigeben geht erst, wenn die Hardware keine Störung mehr meldet (Techniker vor Ort).</p>
      )}
    </aside>
  );
}
