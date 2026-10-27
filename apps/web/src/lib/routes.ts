import type { Role } from '@meduza/contracts';

/**
 * Which roles may open each section. The menu is built from this table and the app shell uses it as a route guard,
 * so a role never sees a half-working page it cannot use. This is only UX: the server checks every request (403).
 */
export const SECTION_ROLES = {
  '/dashboard': ['manager'],
  '/patients': ['manager', 'registrar', 'doctor', 'cashier'],
  '/schedule': ['manager', 'registrar', 'doctor'],
  '/queue': ['manager', 'registrar', 'doctor', 'cashier'],
  '/doctor': ['doctor'],
  '/lab': ['lab', 'manager', 'registrar'],
  '/diagnostics': ['doctor'],
  '/news': ['doctor'],
  '/cashier': ['cashier', 'manager', 'registrar'],
  '/finance': ['manager', 'cashier'],
  // referral partners, their payouts and the lead-source report (docs/REFERRALS.md): percents and amounts are the manager's
  '/partners': ['manager'],
  // discount rules, benefit categories and the discounts report (docs/DISCOUNTS_COMPANIES.md)
  '/discounts': ['manager'],
  // employers and insurers: the cashier records their bank transfers; the statement and the act are the manager's
  '/companies': ['manager', 'cashier'],
  '/staff': ['manager'],
  '/inventory': ['manager', 'storekeeper'],
  '/materials': ['doctor', 'lab'],
  '/cameras': ['manager'],
  // the security guard «Qorovul» (docs/SECURITY_GUARD.md): only these sections — never a patient, visit, money or the warehouse
  '/guard': ['guard'],
  '/visitors': ['guard'],
  '/keys': ['guard'],
  '/patrol': ['guard'],
  '/incidents': ['guard'],
  '/on-site': ['guard'],
  '/post': ['guard'],
  '/security': ['manager'],
  '/reports': ['manager', 'doctor'],
  '/settings': ['manager'],
} satisfies Record<string, Role[]>;
export type Section = keyof typeof SECTION_ROLES;

/** Detail pages and printouts, reached from inside other sections (longest prefix wins). */
const DETAIL_ROLES: Record<string, Role[]> = {
  // the patient card has a minimal view for the lab (opened from a lab order), the list itself is not for the lab
  '/patients/': ['manager', 'registrar', 'doctor', 'cashier', 'lab'],
  '/cashier/': SECTION_ROLES['/cashier'],
  '/print/payment/': ['manager', 'cashier'],
  '/print/shift/': ['manager', 'cashier'],
  '/print/lab/': ['lab', 'manager', 'registrar', 'doctor'],
  '/print/note/': ['doctor'],
  '/print/uzi/': ['doctor'],
  '/print/document/': ['doctor'],
  '/print/summary/': ['doctor'],
  '/print/consent/': ['manager', 'registrar', 'doctor', 'cashier', 'lab'],
  '/print/patient/': ['manager', 'registrar', 'doctor'],
  '/print/appointment/': ['manager', 'registrar'],
  '/print/warehouse/': ['storekeeper', 'manager'],
  '/print/guard-shift/': ['guard', 'manager'],
  '/print/company-act/': ['manager'],
};

/** May this role open this path? Unknown paths are allowed (Next shows its own 404). */
export function canOpen(role: Role, pathname: string): boolean {
  const detail = Object.keys(DETAIL_ROLES).filter((p) => pathname.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  if (detail) return DETAIL_ROLES[detail].includes(role);
  const section = (Object.keys(SECTION_ROLES) as Section[]).find((s) => pathname === s || pathname.startsWith(s + '/'));
  return section ? (SECTION_ROLES[section] as readonly Role[]).includes(role) : true;
}
