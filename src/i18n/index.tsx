// Tiny i18n: strings are looked up by their English text; missing entries fall back to English.
import React, { createContext, useContext, useState } from "react";
import { ES } from "./es";
import { PT } from "./pt";

export type Lang = "en" | "es" | "pt";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "pt", label: "Português" },
];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, es: ES, pt: PT };
const KEY = "nghs.lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && saved in DICTS) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  return nav.startsWith("es") ? "es" : nav.startsWith("pt") ? "pt" : "en";
}

let current: Lang = initial();
export const getLang = () => current;
/** Switch language outside React (scripts, tests). Inside the app use LangProvider. */
export const setLangGlobal = (l: Lang) => {
  current = l;
};

/** Translate an English string. `{name}` placeholders are filled from vars. */
export function tr(s: string, vars?: Record<string, string | number>): string {
  let out = DICTS[current][s] ?? s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}
export const t = tr;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} });
export const useLang = () => useContext(Ctx);

/** Re-renders the whole app when the language changes. */
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = (l: Lang) => {
    current = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
    setState(l);
  };
  return (
    <Ctx.Provider value={{ lang, setLang }}>
      <React.Fragment key={lang}>{children}</React.Fragment>
    </Ctx.Provider>
  );
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <select className="langswitch" value={lang} onChange={(e) => setLang(e.target.value as Lang)} title="Language / Idioma / Idioma">
      {LANGS.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Renders translated markup: `code`, **bold**, *italic* and [label](tab:name) links.
 * Pass the English text; it is translated with t().
 */
export function Tx({ s, vars, onLink }: { s: string; vars?: Record<string, string | number>; onLink?: (target: string) => void }) {
  return <Rich text={tr(s, vars)} onLink={onLink} />;
}

export function Rich({ text, onLink }: { text: string; onLink?: (target: string) => void }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith("**") && p.endsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <i key={i}>{p.slice(1, -1)}</i>;
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (m)
          return (
            <a key={i} onClick={() => onLink?.(m[2])}>
              {m[1]}
            </a>
          );
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}
