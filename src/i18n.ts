/**
 * The CLI speaks English or French: IDEM_LANG=fr|en, else the system's
 * language (LC_ALL, LC_MESSAGES, LANG, then the runtime's locale).
 *
 * `t()` takes the English text — the key — with `{name}` placeholders, and
 * returns it in the chosen language. A text missing from a dictionary stays
 * in English rather than showing a key.
 */
import { fr } from './locales/fr.js';

export type Lang = 'en' | 'fr';

export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const explicit = env.IDEM_LANG?.toLowerCase();
  if (explicit === 'fr' || explicit === 'en') return explicit;
  const system = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || safeLocale();
  return /^fr\b|^fr[_-]/i.test(system ?? '') ? 'fr' : 'en';
}

function safeLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return '';
  }
}

let lang: Lang = detectLang();

export function setLang(value: Lang): void {
  lang = value;
}

export function currentLang(): Lang {
  return lang;
}

const dictionaries: Record<Lang, Record<string, string>> = { en: {}, fr };

export function t(text: string, vars: Record<string, string | number> = {}): string {
  const template = dictionaries[lang][text] ?? text;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
