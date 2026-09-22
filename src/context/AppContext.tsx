/**
 * AppContext.tsx — Global Context for Theme (Dark / Light) and Language (TR / EN).
 * Provides instantaneous synchronization across all Tauri windows.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAppConfig, setAppTheme as apiSetTheme, setAppLanguage as apiSetLang } from "../api/config";
import type { AppTheme, AppLanguage } from "../api/config";
import { translations, TranslationKey } from "../i18n/translations";

interface AppContextType {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => Promise<void>;
  lang: AppLanguage;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const AppContext = createContext<AppContextType | null>(null);

const STORAGE_THEME_KEY = "pascopyof_theme";
const STORAGE_LANG_KEY = "pascopyof_lang";

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Synchronous init from localStorage prevents flash of wrong theme/language
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "dark";
  });

  const [lang, setLangState] = useState<AppLanguage>(() => {
    const saved = localStorage.getItem(STORAGE_LANG_KEY);
    return saved === "tr" || saved === "en" ? saved : "tr";
  });

  // Apply data-theme attribute on documentElement
  const applyTheme = useCallback((newTheme: AppTheme) => {
    document.documentElement.setAttribute("data-theme", newTheme);
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_THEME_KEY, newTheme);
  }, []);

  const applyLanguage = useCallback((newLang: AppLanguage) => {
    setLangState(newLang);
    localStorage.setItem(STORAGE_LANG_KEY, newLang);
  }, []);

  // Initial backend sync
  useEffect(() => {
    applyTheme(theme);

    getAppConfig()
      .then((cfg) => {
        if (cfg.theme && cfg.theme !== theme) {
          applyTheme(cfg.theme);
        }
        if (cfg.language && cfg.language !== lang) {
          applyLanguage(cfg.language);
        }
      })
      .catch((err) => {
        console.warn("Could not load app config from backend:", err);
      });

    // Listen for events from other windows
    const unlistenTheme = listen<string>("theme-changed", (event) => {
      const incoming = event.payload as AppTheme;
      if (incoming === "dark" || incoming === "light") {
        applyTheme(incoming);
      }
    });

    const unlistenLang = listen<string>("language-changed", (event) => {
      const incoming = event.payload as AppLanguage;
      if (incoming === "tr" || incoming === "en") {
        applyLanguage(incoming);
      }
    });

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_THEME_KEY && (e.newValue === "dark" || e.newValue === "light")) {
        applyTheme(e.newValue);
      }
      if (e.key === STORAGE_LANG_KEY && (e.newValue === "tr" || e.newValue === "en")) {
        applyLanguage(e.newValue);
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      unlistenTheme.then((f) => f());
      unlistenLang.then((f) => f());
      window.removeEventListener("storage", handleStorage);
    };
  }, [applyTheme, applyLanguage]);

  // Set Theme action
  const setTheme = async (newTheme: AppTheme) => {
    applyTheme(newTheme);
    try {
      await apiSetTheme(newTheme);
    } catch (err) {
      console.error("Failed to save theme:", err);
    }
  };

  // Set Language action
  const setLanguage = async (newLang: AppLanguage) => {
    applyLanguage(newLang);
    try {
      await apiSetLang(newLang);
    } catch (err) {
      console.error("Failed to save language:", err);
    }
  };

  // Translation helper
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const dict = translations[lang] || translations.tr;
      let text = (dict[key] ?? translations.tr[key] ?? key) as string;
      if (params) {
        Object.entries(params).forEach(([paramKey, val]) => {
          text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(val));
        });
      }
      return text;
    },
    [lang]
  );

  return (
    <AppContext.Provider value={{ theme, setTheme, lang, setLanguage, t }}>
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
