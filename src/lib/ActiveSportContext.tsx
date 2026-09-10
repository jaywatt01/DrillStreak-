import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { getActiveSport, listSportsForAccount, setActiveSport as persistActiveSport, SportOption } from './activeSport';

type ActiveSportContextValue = {
  sport: string;
  // True only until the very first load resolves — screens that filter
  // by sport should wait for this before fetching their own data, so a
  // player list never briefly flashes unfiltered (or empty) before the
  // real active sport is known.
  loading: boolean;
  sports: SportOption[];
  switchSport: (sport: string) => Promise<void>;
  refreshSports: () => Promise<void>;
};

const ActiveSportContext = createContext<ActiveSportContextValue | null>(null);

// Wraps the signed-in app (see App.tsx) so every screen shares one live
// active-sport value — switching anywhere updates everywhere immediately,
// no per-screen refetch of profiles.active_sport needed. Mounted fresh on
// every sign-in (it's inside the `session` branch in App.tsx), so a
// different account never inherits a stale sport from whoever used the
// device last.
export function ActiveSportProvider({ children }: { children: ReactNode }) {
  const [sport, setSport] = useState('basketball');
  const [loading, setLoading] = useState(true);
  const [sports, setSports] = useState<SportOption[]>([]);

  const refreshSports = useCallback(async () => {
    setSports(await listSportsForAccount());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [active] = await Promise.all([getActiveSport(), refreshSports()]);
      if (!cancelled) {
        setSport(active);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSports]);

  const switchSport = useCallback(
    async (newSport: string) => {
      await persistActiveSport(newSport);
      setSport(newSport);
      // Re-derive which sports have data — switching into a sport with no
      // player/team yet, then adding one, should make it show as "has
      // data" the next time the switcher opens.
      await refreshSports();
    },
    [refreshSports]
  );

  return (
    <ActiveSportContext.Provider value={{ sport, loading, sports, switchSport, refreshSports }}>
      {children}
    </ActiveSportContext.Provider>
  );
}

export function useActiveSport(): ActiveSportContextValue {
  const ctx = useContext(ActiveSportContext);
  if (!ctx) throw new Error('useActiveSport must be called within an ActiveSportProvider');
  return ctx;
}
