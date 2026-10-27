import { createTranslator, type Locale, type Params } from './core';
import { common } from './messages/common';
import { shell } from './messages/shell';
import { doctor } from './messages/doctor';
import { registrar } from './messages/registrar';
import { cash } from './messages/cash';
import { clinical } from './messages/clinical';
import { admin } from './messages/admin';
import { api } from './messages/api';
import { print } from './messages/print';
import { consent } from './messages/consent';
import { cameras } from './messages/cameras';
import { warehouse } from './messages/warehouse';
import { managerAi } from './messages/manager-ai';
import { labAi } from './messages/lab-ai';
import { patientSummary } from './messages/patient-summary';
import { guard } from './messages/guard';
import { referrals } from './messages/referrals';
import { discounts } from './messages/discounts';

export * from './core';
export { cyrillicToLatin, latinToCyrillic, searchTranslit } from './translit';
export { BIOMETRIC_CONSENT_TEXT, BIOMETRIC_CONSENT_VERSION, CONSENT_TEXT_VERSION, CONSENT_TEXTS, type ConsentTextVersion } from './messages/consent';

/** Every interface message. Each area keeps its own file; keys are prefixed by area, so they never collide. */
export const MESSAGES = { ...common, ...shell, ...doctor, ...registrar, ...cash, ...clinical, ...admin, ...api, ...print, ...consent, ...cameras, ...warehouse, ...managerAi, ...labAi, ...patientSummary, ...guard, ...referrals, ...discounts };
export type MessageKey = keyof typeof MESSAGES;
export const translate: (locale: Locale, key: MessageKey, params?: Params) => string = createTranslator(MESSAGES);

// ---------- server messages ----------
type Compiled = { key: MessageKey; re: RegExp; names: string[] };
let exact: Map<string, MessageKey> | null = null;
let templates: Compiled[] = [];
let nouns: Map<string, MessageKey> = new Map();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function compile() {
  exact = new Map(); templates = []; nouns = new Map();
  for (const [key, entry] of Object.entries(api) as [MessageKey, readonly [string, unknown]][]) {
    const uz = entry[0];
    if (key.startsWith('api.noun.')) { nouns.set(uz, key); continue; }
    const names = [...uz.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (!names.length) { exact.set(uz, key); continue; }
    const re = new RegExp('^' + uz.split(/\{\w+\}/).map(esc).join('(.+?)') + '$');
    templates.push({ key, re, names });
  }
  // longer (more specific) templates first
  templates.sort((a, b) => b.re.source.length - a.re.source.length);
}

/**
 * An Uzbek message from the API or a validation schema in the person's language. Variable parts captured by a
 * template ({what}, {amount}, «{name}») are kept as they are — except the known nouns, which are translated too.
 * A message the catalog does not know is returned unchanged (still readable, in Uzbek).
 */
export function localizeServerText(locale: Locale, message: string): string {
  if (locale === 'uz' || !message) return message;
  if (!exact) compile();
  const hit = exact!.get(message);
  if (hit) return translate(locale, hit);
  for (const t of templates) {
    const m = t.re.exec(message);
    if (!m) continue;
    const params: Params = {};
    t.names.forEach((name, i) => { const v = m[i + 1]; const noun = nouns.get(v); params[name] = noun ? translate(locale, noun) : v; });
    return translate(locale, t.key, params);
  }
  const noun = nouns.get(message);
  return noun ? translate(locale, noun) : message;
}
