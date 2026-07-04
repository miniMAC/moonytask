import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";

export type ThemePref = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const ThemeCtx = createContext<{
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
}>({ pref: "auto", resolved: "light", setPref: () => {} });

export function useTheme() {
  return useContext(ThemeCtx);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("auto");
  const [resolved, setResolved] = useState<ResolvedTheme>(
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  useEffect(() => {
    api.settingsGet("theme").then((v) => {
      if (v === "light" || v === "dark" || v === "auto") setPrefState(v);
    });
    // il cambio tema fatto in un'altra finestra si propaga via evento
    const un = listen<[string, string]>("setting_changed", (e) => {
      const [key, value] = e.payload;
      if (key === "theme" && (value === "light" || value === "dark" || value === "auto")) {
        setPrefState(value);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = pref === "dark" || (pref === "auto" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      setResolved(dark ? "dark" : "light");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    api.settingsSet("theme", p);
  };

  return (
    <ThemeCtx.Provider value={{ pref, resolved, setPref }}>
      {children}
    </ThemeCtx.Provider>
  );
}
