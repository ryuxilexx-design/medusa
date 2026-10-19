// ICD-10 (MKB-10): search works without AI; the AI only picks from the clinic's code table and every code it
// returns is checked against that table, so an invented code can never reach a note.
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db, Q } from '../core/db';
import { AiClient } from './ai-client';
import { redact, PatientIdentity } from './redact';

export type IcdRow = { code: string; title_ru: string; title_uz: string | null };
export const ICD_CODE_RE = /^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/;
const MAX_PROMPT_CODES = 400;

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { code: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, reason_uz: { type: 'string' } },
        required: ['code', 'confidence', 'reason_uz'], additionalProperties: false,
      },
    },
  },
  required: ['suggestions'], additionalProperties: false,
};
const suggestZ = z.object({ suggestions: z.array(z.object({ code: z.string(), confidence: z.enum(['high', 'medium', 'low']), reason_uz: z.string() })) });

const SYSTEM = (list: string) => `Sen klinika shifokoriga MKB-10 (ICD-10) kodini tanlashda yordam beradigan yordamchisan.
Shifokor yozgan tashxis matniga eng mos 1–3 ta kodni FAQAT quyidagi ro‘yxatdan tanla. Ro‘yxatda yo‘q kodni hech qachon yozma.
Mos kod bo‘lmasa, bo‘sh ro‘yxat qaytar. Tashxis qo‘yma va tashxisni o‘zgartirma — faqat shifokor yozganini kodla.
reason_uz — o‘zbek (lotin) tilida bitta qisqa jumla: nega shu kod. confidence: high (aniq mos), medium (yaqin), low (taxminiy).

Ro‘yxat (kod — o‘zbekcha nomi / ruscha nomi):
${list}`;

/** Lower-case word stems (5 letters) for a simple, language-agnostic overlap score. */
const stems = (s: string) => (s.toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? []).map((w) => w.slice(0, 5));

@Injectable()
export class Icd10Service {
  constructor(private db: Db, private ai: AiClient) {}

  async search(q: string, limit = 20): Promise<IcdRow[]> {
    const term = q.trim();
    if (!term) return [];
    if (/^[a-z]\d/i.test(term)) {
      return this.db.rows(`SELECT code, title_ru, title_uz FROM icd10_codes WHERE code ILIKE $1 ORDER BY code LIMIT $2`, [term.toUpperCase() + '%', limit]);
    }
    const words = term.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
    const conds = words.map((_, i) => `(lower(title_uz) LIKE $${i + 1} OR lower(title_ru) LIKE $${i + 1})`).join(' AND ');
    return this.db.rows(
      `SELECT code, title_ru, title_uz FROM icd10_codes WHERE ${conds || 'true'}
        ORDER BY (lower(coalesce(title_uz,'')) LIKE $${words.length + 1} OR lower(title_ru) LIKE $${words.length + 1}) DESC, code LIMIT $${words.length + 2}`,
      [...words.map((w) => `%${w}%`), `${words[0] ?? ''}%`, limit]);
  }

  /** Codes ranked by word-stem overlap with the text (works offline, used when AI is off and to shortlist large tables). */
  async lexical(text: string, limit: number): Promise<(IcdRow & { score: number })[]> {
    const want = new Set(stems(text));
    if (!want.size) return [];
    const all = await this.db.rows<IcdRow>(`SELECT code, title_ru, title_uz FROM icd10_codes`);
    return all
      .map((r) => {
        const have = new Set(stems(`${r.title_uz ?? ''} ${r.title_ru}`));
        return { ...r, score: [...have].filter((s) => want.has(s)).length };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
      .slice(0, limit);
  }

  /** Suggestions for a diagnosis text: AI over the code table when live, word matching otherwise. */
  async suggest(text: string, ctx: { tenantId: string; membershipId: string }, patient?: PatientIdentity | null) {
    const mode = this.ai.clinicalMode(ctx.tenantId);
    if (mode !== 'live') {
      const rows = await this.lexical(text, 3);
      return { mode: 'search' as const, suggestions: rows.map((r) => ({ code: r.code, title: r.title_uz ?? r.title_ru, title_ru: r.title_ru, confidence: null, reason: null })) };
    }
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM icd10_codes`))!.n;
    // a full official table is too long for one prompt: shortlist by word overlap first
    const rows: IcdRow[] = total <= MAX_PROMPT_CODES
      ? await this.db.rows(`SELECT code, title_ru, title_uz FROM icd10_codes ORDER BY code`)
      : await this.lexical(text, MAX_PROMPT_CODES);
    if (!rows.length) return { mode: 'live' as const, suggestions: [] };
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const list = rows.map((r) => `${r.code} — ${r.title_uz ?? ''} / ${r.title_ru}`).join('\n');
    const { value } = await this.ai.json({
      route: 'icd10_suggest', system: SYSTEM(list), cacheSystem: true, user: `Tashxis: ${redact(text, patient)}`,
      schema: SUGGEST_SCHEMA, validate: suggestZ, effort: 'low', maxTokens: 2000, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
    });
    const seen = new Set<string>();
    const suggestions = value.suggestions
      .filter((s) => byCode.has(s.code) && !seen.has(s.code) && seen.add(s.code))
      .slice(0, 3)
      .map((s) => { const r = byCode.get(s.code)!; return { code: r.code, title: r.title_uz ?? r.title_ru, title_ru: r.title_ru, confidence: s.confidence, reason: s.reason_uz.slice(0, 300) }; });
    return { mode: 'live' as const, suggestions };
  }

  /** Validates chosen codes and returns the note snapshot [{code, title}]. Unknown codes → null. */
  async snapshot(q: Q, codes: string[]): Promise<{ code: string; title: string }[] | null> {
    const uniq = [...new Set(codes)];
    if (!uniq.length) return [];
    const rows = (await q.query(`SELECT code, coalesce(title_uz, title_ru) AS title FROM icd10_codes WHERE code = ANY($1)`, [uniq])).rows;
    if (rows.length !== uniq.length) return null;
    const m = new Map(rows.map((r) => [r.code, r.title]));
    return uniq.map((c) => ({ code: c, title: m.get(c)! }));
  }
}
