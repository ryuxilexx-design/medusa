// Daily specialty news for doctors: recent high-evidence PubMed articles (trials, meta-analyses, systematic
// reviews, guidelines), summarised in Uzbek by AI from the abstract only. Shared by all clinics: one summary
// per specialty per article. Stored: title, our summary, link. Never the publisher's abstract.
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../core/db';
import { config } from '../core/config';
import { AiClient } from './ai-client';

export type Specialty = { key: string; label: string; match: RegExp; query: string };
export const SPECIALTIES: Specialty[] = [
  { key: 'cardiology', label: 'Kardiologiya', match: /kardio|кардио/i, query: '"cardiovascular diseases"[MeSH Terms]' },
  { key: 'neurology', label: 'Nevrologiya', match: /nevro|невро/i, query: '"nervous system diseases"[MeSH Terms]' },
  { key: 'pediatrics', label: 'Pediatriya', match: /pediatr|педиатр/i, query: '"pediatrics"[MeSH Terms]' },
  { key: 'obgyn', label: 'Ginekologiya va akusherlik', match: /ginekol|akusher|гинеко|акушер/i, query: '("gynecology"[MeSH Terms] OR "obstetrics"[MeSH Terms])' },
  { key: 'endocrinology', label: 'Endokrinologiya', match: /endokrin|эндокрин/i, query: '"endocrine system diseases"[MeSH Terms]' },
  { key: 'ultrasound', label: 'Ultratovush diagnostikasi', match: /uzi|ultratovush|узи|sonograf/i, query: '"ultrasonography"[MeSH Terms]' },
  { key: 'laboratory', label: 'Laboratoriya diagnostikasi', match: /laborator|лаборатор/i, query: '"clinical laboratory techniques"[MeSH Terms]' },
  { key: 'internal', label: 'Terapiya (ichki kasalliklar)', match: /terapev|umumiy|oilaviy|терапев/i, query: '("internal medicine"[MeSH Terms] OR "primary health care"[MeSH Terms])' },
];
const DEFAULT = SPECIALTIES[SPECIALTIES.length - 1];
export const specialtyOf = (text: string | null | undefined) => SPECIALTIES.find((s) => s.match.test(text ?? '')) ?? DEFAULT;
export const specialtyByKey = (key: string | undefined) => SPECIALTIES.find((s) => s.key === key) ?? DEFAULT;

const EVIDENCE = '(randomized controlled trial[pt] OR meta-analysis[pt] OR systematic review[pt] OR practice guideline[pt] OR guideline[pt]) AND hasabstract';
const PER_DAY = 5;
const MAX_ABSTRACT = 3500;

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { pmid: { type: 'string' }, title_uz: { type: 'string' }, summary_uz: { type: 'string' }, takeaway_uz: { type: 'string' } },
        required: ['pmid', 'title_uz', 'summary_uz', 'takeaway_uz'], additionalProperties: false,
      },
    },
  },
  required: ['items'], additionalProperties: false,
};
const summaryZ = z.object({ items: z.array(z.object({ pmid: z.string(), title_uz: z.string().min(3), summary_uz: z.string().min(10), takeaway_uz: z.string() })) });

const SYSTEM = `Sen O‘zbekistondagi shifokorlar uchun tibbiy maqolalarni qisqa bayon qiluvchi muharrirsan.
Har bir maqola uchun FAQAT berilgan sarlavha va annotatsiyaga tayan — o‘zingdan fakt, raqam yoki tavsiya qo‘shma.
title_uz: sarlavhaning o‘zbek (lotin) tilidagi aniq tarjimasi.
summary_uz: 2–3 jumla — tadqiqot turi, kimlar ustida, asosiy natija (annotatsiyadagi raqamlar bilan).
takeaway_uz: bitta jumla — amaliyot uchun nimani anglatadi; dastlabki yoki kichik tadqiqot bo‘lsa, buni ochiq ayt.
Bu davolash bo‘yicha ko‘rsatma emas: buyruq ohangida yozma. Tibbiy atamalarni o‘zbek amaliyotida qabul qilingan shaklda yoz.`;

export type Article = { pmid: string; title: string; abstract: string; journal: string | null; published: string | null };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m)
  .replace(/\s+/g, ' ').trim();

/** Minimal PubMed efetch XML reader: title, abstract (with section labels), journal, publication date. */
export function parsePubmedXml(xml: string): Article[] {
  return (xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? []).map((a) => {
    const pmid = a.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1] ?? '';
    const title = decode(a.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? '');
    const abstract = [...a.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => { const label = m[1].match(/Label="([^"]+)"/)?.[1]; return `${label ? label + ': ' : ''}${decode(m[2])}`; }).join(' ');
    const journal = decode(a.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/)?.[1] ?? '') || null;
    const pd = a.match(/<PubDate>([\s\S]*?)<\/PubDate>/)?.[1] ?? '';
    const published = pd.match(/<MedlineDate>(.*?)<\/MedlineDate>/)?.[1]
      ?? ([pd.match(/<Year>(\d{4})<\/Year>/)?.[1], pd.match(/<Month>(\w+)<\/Month>/)?.[1], pd.match(/<Day>(\d+)<\/Day>/)?.[1]].filter(Boolean).join(' ') || null);
    return { pmid, title, abstract, journal, published };
  }).filter((x) => x.pmid && x.title && x.abstract);
}

/** Real calendar date in Tashkent (news follows the real world, not the demo clock). */
const realToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

@Injectable()
export class NewsService {
  private log = new Logger('News');
  constructor(private db: Db, private ai: AiClient) {}

  /** GET with NCBI etiquette: on 429 (shared cloud IPs hit the 3 req/s limit) wait and retry, up to 3 attempts. */
  private async get(url: string, timeoutMs = 15_000): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Med.uz.ai news (clinic software)' } });
      if (res.ok) return res.text();
      if (res.status !== 429 || attempt >= 3) throw new Error(`PubMed ${res.status}`);
      const wait = Number(res.headers.get('retry-after')) * 1000 || attempt * 1500;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
    }
  }
  private pause() { return new Promise((r) => setTimeout(r, config.news.ncbiKey ? 120 : 400)); }

  private eutils(path: string, params: Record<string, string>) {
    const q = new URLSearchParams({ ...params, tool: 'meduzai', ...(config.news.ncbiKey ? { api_key: config.news.ncbiKey } : {}) });
    return `${config.news.pubmedBase}/${path}?${q}`;
  }

  /** Fetches and summarises today's articles for one specialty. Idempotent per day; returns how many were added. */
  async refreshSpecialty(key: string): Promise<number> {
    if (!config.news.enabled) return 0;
    const sp = specialtyByKey(key);
    const today = realToday();
    const done = (await this.db.one(`SELECT count(*)::int AS n FROM news_items WHERE specialty_key = $1 AND fetched_on = $2`, [sp.key, today]))!.n;
    if (done > 0) return 0;
    const search = JSON.parse(await this.get(this.eutils('esearch.fcgi', {
      db: 'pubmed', term: `${sp.query} AND ${EVIDENCE}`, reldate: '30', datetype: 'pdat', sort: 'relevance', retmax: String(PER_DAY * 3), retmode: 'json',
    })));
    const ids: string[] = (search?.esearchresult?.idlist ?? []).filter((x: unknown) => typeof x === 'string' && /^\d+$/.test(x));
    if (!ids.length) return 0;
    await this.pause();
    const known = new Set((await this.db.rows(`SELECT external_id FROM news_items WHERE specialty_key = $1 AND external_id = ANY($2)`, [sp.key, ids])).map((r) => r.external_id));
    const fresh = ids.filter((id) => !known.has(id)).slice(0, PER_DAY);
    if (!fresh.length) return 0;
    const articles = parsePubmedXml(await this.get(this.eutils('efetch.fcgi', { db: 'pubmed', id: fresh.join(','), retmode: 'xml' }))).filter((a) => fresh.includes(a.pmid));
    if (!articles.length) return 0;

    let summaries = new Map<string, { title_uz: string; summary_uz: string; takeaway_uz: string }>();
    let model: string | null = null;
    if (this.ai.mode() === 'live') {
      const input = articles.map((a) => ({ pmid: a.pmid, title: a.title, abstract: a.abstract.slice(0, MAX_ABSTRACT) }));
      const { value, model: m } = await this.ai.json({
        route: 'news_summary', system: SYSTEM, user: JSON.stringify(input), schema: SUMMARY_SCHEMA, validate: summaryZ,
        effort: 'low', maxTokens: 8000, tenantId: null, membershipId: null,
      });
      model = m;
      const allowed = new Set(articles.map((a) => a.pmid));
      summaries = new Map(value.items.filter((i) => allowed.has(i.pmid)).map((i) => [i.pmid, { title_uz: i.title_uz.slice(0, 400), summary_uz: i.summary_uz.slice(0, 1500), takeaway_uz: i.takeaway_uz.slice(0, 500) }]));
    }
    let added = 0;
    for (const a of articles) {
      const s = summaries.get(a.pmid);
      const r = await this.db.rows(
        `INSERT INTO news_items (specialty_key, external_id, title, title_uz, summary_uz, takeaway_uz, journal, published, url, fetched_on, model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (specialty_key, source, external_id) DO NOTHING RETURNING id`,
        [sp.key, a.pmid, a.title.slice(0, 500), s?.title_uz ?? null, s?.summary_uz ?? null, s?.takeaway_uz ?? null, a.journal?.slice(0, 200) ?? null,
          a.published, `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`, today, s ? model : null]);
      added += r.length;
    }
    return added;
  }

  /** Specialties of active doctors in all clinics (what the daily job needs to cover). */
  async activeSpecialties(tenantId?: string): Promise<string[]> {
    const rows = await this.db.rows(`SELECT DISTINCT specialty FROM doctors WHERE active ${tenantId ? 'AND tenant_id = $1' : ''}`, tenantId ? [tenantId] : []);
    return [...new Set(rows.map((r) => specialtyOf(r.specialty).key))];
  }

  async refreshAll(tenantId?: string): Promise<{ specialty: string; added: number; error?: string }[]> {
    const out = [];
    for (const key of await this.activeSpecialties(tenantId)) {
      try { out.push({ specialty: key, added: await this.refreshSpecialty(key) }); }
      catch (e) { this.log.warn(`news ${key}: ${(e as Error).message}`); out.push({ specialty: key, added: 0, error: (e as Error).message.slice(0, 200) }); }
      await this.pause(); // stay under the NCBI rate limit
    }
    return out;
  }
}
