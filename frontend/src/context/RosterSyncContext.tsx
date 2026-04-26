import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface RosterSyncState {
  syncVersion: number;
  bump: () => void;
}

const Ctx = createContext<RosterSyncState>({ syncVersion: 0, bump: () => {} });

export function useRosterSync() {
  return useContext(Ctx);
}

export function RosterSyncProvider({ children }: { children: ReactNode }) {
  const [syncVersion, setSyncVersion] = useState(0);
  const bump = useCallback(() => setSyncVersion((v) => v + 1), []);
  return <Ctx.Provider value={{ syncVersion, bump }}>{children}</Ctx.Provider>;
}
