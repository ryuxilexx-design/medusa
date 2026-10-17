import { ZodSchema } from 'zod';
import { invalid } from './errors';

export function parse<T>(schema: ZodSchema<T>, input: unknown): T {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw invalid(fields);
}

export function pageParams(q: Record<string, any>) {
  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.page_size, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
