"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DICTS, LOCALES, type Dict, type Locale } from "./dict";

const STORAGE_KEY = "shdpos.locale";

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Dict;
  /** แปลชื่อสินค้า/สาขาตามภาษา โดย fallback เป็นไทย */
  pick: (v: { th?: string | null; en?: string | null; zh?: string | null }) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("th");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved && LOCALES.includes(saved)) setLocaleState(saved);
    } catch {
      /* private mode */
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l === "zh" ? "zh-CN" : l;
  }, []);

  const value = useMemo<I18nValue>(() => {
    const t = DICTS[locale];
    return {
      locale,
      setLocale,
      t,
      pick: (v) => {
        if (locale === "en") return v.en || v.th || v.zh || "";
        if (locale === "zh") return v.zh || v.th || v.en || "";
        return v.th || v.en || v.zh || "";
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
