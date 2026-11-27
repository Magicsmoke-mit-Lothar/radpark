/**
 * Grundgerüst: Seitenleiste + aktuelle Seite.
 * Die Seite steht in der Adresse (#stationen …) – so funktionieren Neuladen und Lesezeichen.
 */
import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { EventsPage } from './pages/Events';
import { OverviewPage } from './pages/Overview';
import { SessionsPage } from './pages/Sessions';
import { StationsPage } from './pages/Stations';

const PAGES = {
  uebersicht: { label: 'Übersicht', icon: '◱', Component: OverviewPage },
  stationen: { label: 'Stationen', icon: '▦', Component: StationsPage },
  parkvorgaenge: { label: 'Parkvorgänge', icon: '◷', Component: SessionsPage },
  ereignisse: { label: 'Ereignisse', icon: '☰', Component: EventsPage },
} as const;
type PageKey = keyof typeof PAGES;

function readHash(): PageKey {
  const h = window.location.hash.slice(1);
  return h in PAGES ? (h as PageKey) : 'uebersicht';
}

export default function App() {
  const { user, signOut } = useAuth();
  const [page, setPage] = useState<PageKey>(readHash);

  useEffect(() => {
    const onHash = () => setPage(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const { Component, label } = PAGES[page];

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Hauptnavigation">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>RadPark</span>
        </div>
        {(Object.keys(PAGES) as PageKey[]).map((key) => (
          <a key={key} href={`#${key}`} className={key === page ? 'nav active' : 'nav'} aria-current={key === page ? 'page' : undefined}>
            <span aria-hidden>{PAGES[key].icon}</span> {PAGES[key].label}
          </a>
        ))}
        <div className="sidebar-foot">
          <span className="muted small">{user.email}</span>
          <button className="btn ghost small" onClick={signOut}>
            Abmelden
          </button>
        </div>
      </nav>
      <main className="content">
        <h1>{label}</h1>
        <Component />
      </main>
    </div>
  );
}
