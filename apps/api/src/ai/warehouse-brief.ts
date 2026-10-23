// «Buyurtma taklifi» brief: the top items of the reorder suggestion as a few bullets. Business route, manager pattern
// (ai/manager-facts.ts): the facts are the server's numbers (days left, daily use, suggested quantity, lots that will
// expire unused) with item names as labels; the model only words them, and every number it writes must equal a cited
// fact. No patient data exists in this sheet at all.
import { translate, type Locale, type MessageKey } from '@meduza/contracts';
import type { Fact, Facts, Item } from './manager-facts';
import type { ReorderRow } from '../modules/reorder';

/** Items worth a line: out of stock, running out, to order, or lots that will expire unused — at most 8. */
export function briefItems(rows: ReorderRow[]): ReorderRow[] {
  return rows.filter((r) => r.status === 'out' || r.status === 'urgent' || r.status === 'order' || Number(r.expiring_unusable) > 0).slice(0, 8);
}

export function briefFacts(rows: ReorderRow[], horizon: number): Facts {
  const f: Facts = {};
  const put = (k: string, value: number, unit: Fact['unit'], label?: string) => { f[k] = { value, unit, period: 'now', ...(label ? { label } : {}) }; };
  put('horizon.days', horizon, 'count');
  put('items.out', rows.filter((r) => r.status === 'out').length, 'count');
  put('items.urgent', rows.filter((r) => r.status === 'urgent').length, 'count');
  put('items.to_order', rows.filter((r) => Number(r.suggested) > 0).length, 'count');
  put('items.expiring_unusable', rows.filter((r) => Number(r.expiring_unusable) > 0).length, 'count');
  briefItems(rows).forEach((r, i) => {
    const k = `item.${i + 1}`, label = r.name;
    put(`${k}.usable`, Number(r.usable), 'qty', label);
    put(`${k}.daily_rate`, Number(r.daily_rate), 'qty', label);
    if (r.days_left !== null) put(`${k}.days_left`, r.days_left, 'count', label);
    put(`${k}.suggested`, Number(r.suggested), 'qty', label);
    if (r.packs !== null) put(`${k}.packs`, r.packs, 'count', label);
    put(`${k}.expiring_unusable`, Number(r.expiring_unusable), 'qty', label);
    put(`${k}.out_of_stock`, r.status === 'out' ? 1 : 0, 'count', label);
  });
  return f;
}

/** The model's input: item names with units and their numbers (keys = fact keys). */
export function briefPayload(rows: ReorderRow[], facts: Facts) {
  return {
    items: briefItems(rows).map((r, i) => ({ key: `item.${i + 1}`, name: r.name, unit: r.unit, status: r.status })),
    facts,
  };
}

export const BRIEF_SYSTEM = `Sen klinika omborchisi va rahbari uchun «Buyurtma taklifi» bo‘yicha 3–5 bandli qisqa xulosa yozasan. Senga faqat server hisoblagan faktlar beriladi: item.N.* — N-material (label — nomi): usable — yaroqli qoldiq, daily_rate — kunlik o‘rtacha sarf, days_left — necha kunga yetadi, suggested — buyurtma qilinadigan miqdor, packs — qadoqlar soni, expiring_unusable — 30 kun ichida ishlatilmay muddati o‘tadigan miqdor, out_of_stock=1 — tugagan; horizon.days — necha kunlik zaxira rejalashtirilgan.
Avval eng shoshilinchlari: tugaganlar, tez tugaydiganlar («Tez orada tugaydi: Nom (days_left kun), …» — «hafta» deb yozma, faqat days_left qiymatini yoz), keyin muddati o‘tib ketadiganlar, keyin buyurtma.
Har band bitta qisqa gap. Raqamlar: faqat faktlardagi qiymatlarni o‘zgartirmasdan yoz, o‘zing hisoblama; faktda yo‘q raqam (sana, narx) yozma. Har bandda ishlatgan faktlar kalitlarini fact_keys ga aynan yoz. Bemorlar va davolash haqida yozma.`;

const n = (v: string | number) => String(Number(v));

/** The deterministic brief (AI off, sample mode, or nothing left after the number check). */
export function templateBrief(L: Locale, rows: ReorderRow[], horizon: number): Item[] {
  const t = (k: MessageKey, p?: Record<string, string | number>) => translate(L, k, p);
  const top = briefItems(rows);
  const keyOf = (r: ReorderRow) => `item.${top.indexOf(r) + 1}`;
  const out: Item[] = [];
  const gone = top.filter((r) => r.status === 'out');
  if (gone.length) out.push({ text: t('wh.ro.tpl.out', { names: gone.map((r) => r.name).join(', ') }), fact_keys: gone.map((r) => `${keyOf(r)}.out_of_stock`) });
  const soon = top.filter((r) => r.status === 'urgent' && r.days_left !== null);
  if (soon.length) out.push({ text: t('wh.ro.tpl.urgent', { list: soon.map((r) => t('wh.ro.tpl.days', { name: r.name, n: r.days_left! })).join(', ') }), fact_keys: soon.map((r) => `${keyOf(r)}.days_left`) });
  const waste = top.filter((r) => Number(r.expiring_unusable) > 0);
  if (waste.length) out.push({ text: t('wh.ro.tpl.waste', { list: waste.map((r) => `${r.name} — ${n(r.expiring_unusable)} ${r.unit}`).join(', ') }), fact_keys: waste.map((r) => `${keyOf(r)}.expiring_unusable`) });
  const order = top.filter((r) => Number(r.suggested) > 0).slice(0, 3);
  if (order.length) out.push({ text: t('wh.ro.tpl.order', { list: order.map((r) => `${r.name} — ${n(r.suggested)} ${r.unit}`).join(', ') }), fact_keys: order.map((r) => `${keyOf(r)}.suggested`) });
  if (!out.length) out.push({ text: t('wh.ro.tpl.allGood', { n: horizon }), fact_keys: ['horizon.days'] });
  return out.slice(0, 5);
}
