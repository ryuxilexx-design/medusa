// De-identification before any text leaves the server for an AI provider: the patient's names, phone numbers,
// birth date and patient number are replaced with placeholders. Clinical content stays as written.
export type PatientIdentity = { last_name?: string | null; first_name?: string | null; middle_name?: string | null; birth_date?: string | null; patient_number?: number | null; phone?: string | null };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redact(text: string, p?: PatientIdentity | null): string {
  let out = text;
  if (p) {
    // names, including Uzbek/Russian suffixes on the same stem (Karimovga, Karimovning, Азизом)
    for (const n of [p.last_name, p.first_name, p.middle_name]) {
      const stem = (n ?? '').trim();
      if (stem.length < 3) continue;
      out = out.replace(new RegExp(`(?<![\\p{L}])${esc(stem)}[\\p{L}‘’']*`, 'giu'), '[bemor]');
    }
    if (p.birth_date) {
      const [y, m, d] = p.birth_date.split('-');
      out = out.replace(new RegExp(`${d}[./-]${m}[./-]${y}|${esc(p.birth_date)}`, 'g'), '[tug‘ilgan sana]');
    }
    if (p.patient_number != null) out = out.replace(new RegExp(`(#|№|ID\\s*)0*${p.patient_number}\\b`, 'gi'), '[bemor ID]');
  }
  // the 14-digit personal number (JShShIR/ПИНФЛ, joined or spaced) first: the phone pattern below would otherwise
  // eat its tail and leave «31234[telefon]»
  out = out.replace(/(?<!\d[\s-]?)\d(?:[\s-]?\d){13}(?![\s-]?\d)/g, '[JShShIR]');
  // phone numbers: +998 90 123 45 67, 998901234567, 90-123-45-67, 901234567 (never the middle of a longer number)
  out = out.replace(/(?<!\d)(\+?998[\s-]?)?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[telefon]' : m));
  return out;
}
