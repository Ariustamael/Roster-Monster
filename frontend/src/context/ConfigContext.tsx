import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);

  const { data: configs = [] } = useQuery<MonthlyConfig[]>({
    queryKey: ["configs"],
    queryFn: () => api.getConfigs(),
  });

  // Auto-select first config if active selection is gone
  useEffect(() => {
    if (configs.length > 0 && (activeId === null || !configs.find((c) => c.id === activeId))) {
      setActiveId(configs[0].id);
    }
  }, [configs, activeId]);

  async function reload() {
    await queryClient.invalidateQueries({ queryKey: ["configs"] });
  }

  const active = configs.find((c) => c.id === activeId) ?? null;

  return (
    <Ctx.Provider value={{ configs, active, setActiveId, reload }}>
      {children}
    </Ctx.Provider>
  );
}
