import { useCallback, useEffect, useState } from 'react';
import { api, monthLabel, shiftMonth } from './api.ts';
import type { MonthData, Me } from './types.ts';
import { Overview } from './pages/Overview.tsx';
import { People } from './pages/People.tsx';
import { Subs } from './pages/Subs.tsx';
import { Projects } from './pages/Projects.tsx';
import { Year } from './pages/Year.tsx';
import { Costs } from './pages/Costs.tsx';
import { Bwa } from './pages/Bwa.tsx';
import { Settings } from './pages/Settings.tsx';

const TABS = ['Übersicht', 'Mitarbeiter', 'Subs', 'Projekte', 'Jahr', 'Kosten', 'BWA/SuSa', 'Einstellungen'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('Übersicht');
  const [month, setMonth] = useState('');
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Me>('/api/me').then((m) => { setMe(m); setMonth(m.today.slice(0, 7)); }).catch((e) => setError(e.message));
  }, []);
  const load = useCallback(() => {
    if (!month) return;
    setError('');
    api<MonthData>(`/api/month?month=${month}`).then(setData).catch((e) => setError(e.message));
  }, [month]);
  useEffect(load, [load]);

  const refresh = async () => {
    setBusy(true);
    try { await api('/api/refresh', { method: 'POST', json: { month } }); load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const canWrite = me?.role === 'gf' || me?.role === 'buchhaltung';
  const needsMonth = tab !== 'Jahr' && tab !== 'Einstellungen' && tab !== 'BWA/SuSa';

  return (
    <>
      <header>
        <img src="/daso-logo.png" alt="DaSO" />
        <nav>{TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
        <span className="spacer" />
        {month && <>
          <button className="btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Vormonat">‹</button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Monat" />
          <button className="btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Folgemonat">›</button>
        </>}
        {canWrite && <button className="btn" onClick={refresh} disabled={busy || !month}>{busy ? 'Aktualisiere…' : 'Aktualisieren'}</button>}
      </header>
      <main>
        {error && <div className="warn err">{error}</div>}
        {!data && !error && month && needsMonth && <div className="card">Lade {monthLabel(month)}…</div>}
        {tab === 'Übersicht' && data && <Overview d={data} month={month} />}
        {tab === 'Mitarbeiter' && data && <People d={data} month={month} />}
        {tab === 'Subs' && data && <Subs d={data} month={month} />}
        {tab === 'Projekte' && data && <Projects d={data} month={month} />}
        {tab === 'Jahr' && me && <Year year={Number((month || me.today).slice(0, 4))} />}
        {tab === 'Kosten' && me && <Costs me={me} month={month} onChange={load} />}
        {tab === 'BWA/SuSa' && me && <Bwa me={me} month={month} onChange={load} />}
        {tab === 'Einstellungen' && me && <Settings me={me} month={month} />}
      </main>
    </>
  );
}
