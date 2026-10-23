import type { Catalog } from '../core';

/** «Natija sharhi» — commentary on a verified lab result for the doctor (server text + UI). Keys start with «labai.». */
export const labAi = {
  // ---------- server ----------
  'labai.criticalHigh': ['KRITIK: {name} {value} {unit} — kritik chegara {limit} dan yuqori (me’yor {ref}).', 'КРИТИЧНО: {name} {value} {unit} — выше критической границы {limit} (норма {ref}).'],
  'labai.criticalLow': ['KRITIK: {name} {value} {unit} — kritik chegara {limit} dan past (me’yor {ref}).', 'КРИТИЧНО: {name} {value} {unit} — ниже критической границы {limit} (норма {ref}).'],
  'labai.tpl.allNormal': ['Barcha {n} ta ko‘rsatkich me’yor chegarasida.', 'Все показатели ({n}) в пределах нормы.'],
  'labai.tpl.high': ['{name}: {value} {unit} — me’yordan yuqori (me’yor {ref}).', '{name}: {value} {unit} — выше нормы (норма {ref}).'],
  'labai.tpl.low': ['{name}: {value} {unit} — me’yordan past (me’yor {ref}).', '{name}: {value} {unit} — ниже нормы (норма {ref}).'],
  'labai.tpl.up': ['{name}: {days} kun oldin {prev}, hozir {value} {unit} — {change} ga oshgan ({pct}%).', '{name}: {days} дн. назад {prev}, сейчас {value} {unit} — выше на {change} ({pct}%).'],
  'labai.tpl.down': ['{name}: {days} kun oldin {prev}, hozir {value} {unit} — {change} ga kamaygan ({pct}%).', '{name}: {days} дн. назад {prev}, сейчас {value} {unit} — ниже на {change} ({pct}%).'],
  'labai.tpl.same': ['{name}: {days} kun oldingi natija bilan bir xil ({value} {unit}).', '{name}: без изменений по сравнению с результатом {days} дн. назад ({value} {unit}).'],
  'labai.tpl.noPrevious': ['Bu bemorda shu ko‘rsatkichlarning oldingi tasdiqlangan natijasi yo‘q.', 'Предыдущих подтверждённых результатов этих показателей у пациента нет.'],

  // ---------- UI ----------
  'labai.button': ['Sharh', 'Комментарий'],
  'labai.title': ['Natija sharhi', 'Комментарий к результату'],
  'labai.critical': ['Kritik qiymatlar', 'Критические значения'],
  'labai.history': ['Oldingi natijalar', 'Предыдущие результаты'],
  'labai.now': ['Hozir', 'Сейчас'],
  'labai.change': ['O‘zgarish', 'Изменение'],
  'labai.source.model': ['AI sharhi — tashxis emas, shifokor tekshiradi', 'Комментарий ИИ — не диагноз, проверяет врач'],
  'labai.source.template': ['Avtomatik shablon (AI ishlatilmadi)', 'Автоматический шаблон (без ИИ)'],
  'labai.source.sample': ['Namunaviy rejim: shablon sharhi, AI emas', 'Демонстрационный режим: шаблон, не ИИ'],
  'labai.hide': ['Sharhni yopish', 'Скрыть комментарий'],
} as const satisfies Catalog;
