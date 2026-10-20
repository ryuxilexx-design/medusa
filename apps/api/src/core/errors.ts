import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { isLocale, localizeServerText, type Locale } from '@meduza/contracts';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public extra?: Record<string, unknown>) {
    super(message);
  }
}
export const notFound = (what = 'Obyekt') => new AppError(404, 'NOT_FOUND', `${what} topilmadi`);
export const forbidden = (msg = 'Bu amal uchun ruxsat yo‘q') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, extra?: Record<string, unknown>) => new AppError(409, code, msg, undefined, extra);
export const invalid = (fields: Record<string, string>, msg = 'Maydonlarni tekshiring') => new AppError(422, 'VALIDATION', msg, fields);
export const staleState = () => conflict('STALE_STATE', 'Holat boshqa foydalanuvchi tomonidan o‘zgartirilgan. Sahifani yangilang.');

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private log = new Logger('Error');
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { requestId?: string; ctx?: { locale?: Locale } }>();
    const request_id = req.requestId;
    let status = 500, code = 'INTERNAL', message = 'Kutilmagan xatolik. Qayta urinib ko‘ring.', fields: Record<string, string> | undefined, extra: any;
    if (err instanceof AppError) {
      ({ status, code, message, fields, extra } = err);
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === 404 ? 'NOT_FOUND' : 'HTTP_' + status;
      message = status === 404 ? 'Manzil topilmadi' : (typeof err.getResponse() === 'string' ? (err.getResponse() as string) : err.message);
      if (status === 400 && err.message.includes('JSON')) { code = 'BAD_JSON'; message = 'So‘rov formati noto‘g‘ri'; }
    } else if (err?.code === '23P01') {
      status = 409; code = 'SLOT_TAKEN';
      message = String(err.constraint).includes('room') ? 'Xona bu vaqtda band. Boshqa vaqtni tanlang.' : 'Shifokor bu vaqtda band. Boshqa vaqtni tanlang.';
    } else if (err?.code === '23505') {
      status = 409; code = 'DUPLICATE'; message = 'Bu yozuv allaqachon mavjud.';
    } else if (err?.code === 'P0001') {
      status = 409; code = 'IMMUTABLE'; message = 'Tasdiqlangan yozuvni o‘zgartirib bo‘lmaydi.';
    } else if (err?.code === '22P02' || err?.code === '22007' || err?.code === '22008') {
      status = 422; code = 'VALIDATION'; message = 'Noto‘g‘ri qiymat yuborildi.';
    }
    // a camera's push address carries its secret token: never write it to the log
    if (status >= 500) this.log.error(`${request_id} ${req.method} ${String(req.url).replace(/\/hik\/[^/?#]+/, '/hik/***')}: ${err?.stack || err}`);
    // the person's language: their session, else the language picked on the login page; messages are written in Uzbek
    const cookieLang = req.cookies?.meduza_lang;
    const locale: Locale = req.ctx?.locale ?? (isLocale(cookieLang) ? cookieLang : 'uz');
    if (locale !== 'uz') {
      message = localizeServerText(locale, message);
      if (fields) fields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, localizeServerText(locale, v)]));
    }
    res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}), ...(extra ? { details: extra } : {}) }, request_id });
  }
}
