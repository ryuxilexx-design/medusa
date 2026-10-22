// Interface translations (packages/contracts/src/i18n): every message exists in both languages with the same
// placeholders, Uzbek uses typographic apostrophes, and the derived Uzbek Cyrillic is clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { MESSAGES, translate: t, latinToCyrillic: cyr, localizeServerText: srv } = require('@meduza/contracts');
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const ruForms = (m) => (typeof m === 'string' ? [m] : [m.one, m.few, m.many]);

test('har bir xabar: o‘zbek va rus matni bor, o‘rinbosarlar bir xil', () => {
  const keys = Object.keys(MESSAGES);
  assert.ok(keys.length > 300, `xabarlar soni: ${keys.length}`);
  for (const k of keys) {
    const [uz, ru, cy] = MESSAGES[k];
    assert.ok(uz.trim() && ruForms(ru).every((x) => x.trim()), `${k}: bo‘sh matn`);
    for (const form of ruForms(ru)) assert.equal(placeholders(form), placeholders(uz), `${k}: o‘rinbosarlar mos emas`);
    if (cy) assert.equal(placeholders(cy), placeholders(uz), `${k}: kirill o‘rinbosarlari`);
    assert.ok(!/[A-Za-z]'[A-Za-z]/.test(uz), `${k}: oddiy apostrof (‘ yoki ’ kerak): ${uz}`);
    assert.ok(!/[A-Za-z]/.test(ruForms(ru).join(' ').replace(/\{\w+\}|Med\.uz\.ai|AI|PubMed|Telegram|DMED|RCT|I10|ID|PDF|°C|Gemini|Claude|Idempotency-Key|JPEG|HTTPS?|HTTP|DNS|ISAPI|Hikvision|No\.|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:=[a-z]+)?/g, '')), `${k}: rus matnida lotin harfi: ${JSON.stringify(ru)}`);
  }
});

test('o‘zbek kirill: lotin harfi qolmaydi (brend va kodlardan tashqari), tanlangan so‘zlar to‘g‘ri', () => {
  for (const k of Object.keys(MESSAGES)) {
    const s = t('uz-Cyrl', k).replace(/\{\w+\}|Med\.uz\.ai|Med\.uz|\bAI\b|PubMed|DMED|\bID\b|PDF|I10|°C|Gemini|Claude|Idempotency-Key|JPEG|HTTPS?|HTTP|DNS|ISAPI|Hikvision|No\.|YYYY-MM-DD|HH:MM|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:=[a-z]+)?/g, '');
    assert.ok(!/[A-Za-z]/.test(s), `${k}: ${s}`);
  }
  const cases = {
    'Yo‘q': 'Йўқ', 'Shikoyatlar': 'Шикоятлар', 'Konsultatsiya': 'Консультация', 'ketsin': 'кетсин', 'Ma’lumot': 'Маълумот',
    'Qayerda': 'Қаерда', 'Yetarli': 'Етарли', 'Ehtiyot': 'Эҳтиёт', 'Tayyor': 'Тайёр', 'Telegram’da': 'Телеграмда',
    'AQB 160/100, puls 88': 'АҚБ 160/100, пульс 88', 'MKB-10: I10': 'МКБ-10: I10', '18-oktabr': '18-октябрь', 'UZI va EKG': 'УЗИ ва ЭКГ',
    'bog‘': 'боғ', 'O‘zbekcha': 'Ўзбекча', 'Protsedura': 'Процедура', 'Med.uz.ai demo': 'Med.uz.ai демо', '{n} ta bemor': '{n} та бемор', 'Bemor profili': 'Бемор профили', 'Profil': 'Профиль',
  };
  for (const [lat, want] of Object.entries(cases)) assert.equal(cyr(lat), want, lat);
});

test('tarjima: o‘rinbosar to‘ldiriladi (ism o‘girilmaydi), rus tilida son bilan kelishadi', () => {
  assert.equal(t('uz-Cyrl', 'password.forcedText', { name: 'Karimova Nilufar' }).startsWith('Karimova Nilufar,'), true, 'ism lotinda qoladi');
  assert.equal(t('ru', 'age.years', { n: 1 }), '1 год');
  assert.equal(t('ru', 'age.years', { n: 3 }), '3 года');
  assert.equal(t('ru', 'age.years', { n: 52 }), '52 года');
  assert.equal(t('ru', 'age.years', { n: 11 }), '11 лет');
  assert.equal(t('uz', 'age.years', { n: 52 }), '52 yosh');
  assert.equal(t('uz', 'no.such.key'), 'no.such.key');
});

test('server xabarlari: shablon bo‘yicha tarjima, o‘zgaruvchi qism saqlanadi, noma’lumi o‘zbekcha qoladi', () => {
  assert.equal(srv('ru', 'Bemor topilmadi'), 'Пациент: не найдено');
  assert.equal(srv('ru', 'Kassada yetarli naqd pul yo‘q (bor: 12 500 so‘m)'), 'В кассе недостаточно наличных (есть: 12 500 сум)');
  assert.equal(srv('ru', '«Qon tahlili» bu qabulda allaqachon buyurtma qilingan'), '«Qon tahlili» уже назначено на этом приёме', 'xizmat nomi o‘girilmaydi');
  assert.equal(srv('ru', 'Familiya kamida 1 belgidan iborat bo‘lsin'), 'Фамилия: не менее 1 символа');
  assert.equal(srv('ru', 'Izoh 300 belgidan oshmasin'), 'Комментарий: не более 300 символов');
  assert.equal(srv('ru', 'Ko‘p marta noto‘g‘ri parol kiritildi. 15 daqiqadan keyin qayta urinib ko‘ring yoki rahbardan parolni tiklashni so‘rang.').includes('через 15 минут'), true);
  assert.equal(srv('uz-Cyrl', 'Hisob to‘liq to‘langan'), 'Ҳисоб тўлиқ тўланган');
  assert.equal(srv('uz-Cyrl', 'Bemor topilmadi'), 'Бемор топилмади');
  assert.equal(srv('ru', 'Lug‘atda yo‘q xabar'), 'Lug‘atda yo‘q xabar');
  assert.equal(srv('uz', 'Bemor topilmadi'), 'Bemor topilmadi');
});

test('qamrov: API kodidagi har bir doimiy xato xabari lug‘atda bor', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk(new URL('../src', import.meta.url).pathname);
  const re = /(?:AppError\(\d+,\s*'[A-Z_]+',\s*|notFound\(|forbidden\(|conflict\('[A-Z_]+',\s*)'([^']+)'/g;
  const missing = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) {
    const msg = m[1];
    const probe = m[0].startsWith('notFound(') ? `${msg} topilmadi` : msg;
    if (srv('ru', probe) === probe) missing.add(`${f.split('/src/')[1]}: ${msg}`);
  }
  assert.deepEqual([...missing], [], 'tarjimasi yo‘q xabarlar');
});
