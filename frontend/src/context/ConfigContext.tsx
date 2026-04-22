import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api } from "../api";
import type { MonthlyConfig } from "../types";

interface ConfigState {
  configs: MonthlyConfig[];
  active: MonthlyConfig | null;
  setActiveId: (id: number) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<ConfigState>({
  configs: [],
  active: null,
  setActiveId: () => {},
  reload: async () => {},
});

export function useConfig() {
  return useContext(Ctx);
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [configs, setConfigs] = useState<MonthlyConfig[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);

  async function reload() {
    const list = await api.getConfigs();
    setConfigs(list);
    if (list.length > 0 && (activeId === null || !list.find((c) => c.id === activeId))) {
      setActiveId(list[0].id);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const active = configs.find((c) => c.id === activeId) ?? null;

  return (
    <Ctx.Provider value={{ configs, active, setActiveId, reload }}>
      {children}
    </Ctx.Provider>
  );
}
