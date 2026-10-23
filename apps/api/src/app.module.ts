import { Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Db } from './core/db';
import { AuthGuard } from './core/guard';
import { ErrorFilter } from './core/errors';
import { config } from './core/config';
import { HealthController } from './modules/health.controller';
import { SessionController } from './modules/session.controller';
import { ReferenceController } from './modules/reference.controller';
import { PatientsController } from './modules/patients.controller';
import { AppointmentsController } from './modules/appointments.controller';
import { QueueController } from './modules/queue.controller';
import { DoctorController, EncountersController } from './modules/encounters.controller';
import { LabController } from './modules/lab.controller';
import { InvoicesController, PaymentsController } from './modules/invoices.controller';
import { DashboardController } from './modules/dashboard.controller';
import { ReportsController } from './modules/reports.controller';
import { InventoryController } from './modules/inventory.controller';
import { DiagnosticsController } from './modules/diagnostics.controller';
import { AiController } from './modules/ai.controller';
import { AuthController } from './modules/auth.controller';
import { StaffController } from './modules/staff.controller';
import { ScheduleExceptionsController } from './modules/schedule-exceptions.controller';
import { TelegramController } from './telegram/telegram.controller';
import { SmsController } from './sms/sms.controller';
import { SmsSender } from './sms/transport';
import { DocumentsController } from './modules/documents.controller';
import { CashController } from './modules/cash.controller';
import { DepositsController } from './modules/deposits.controller';
import { NoteTemplatesController, QuickPhrasesController } from './modules/templates.controller';
import { CamerasController } from './cameras/cameras.controller';
import { HikController } from './cameras/hik.controller';
import { CameraIsapiController } from './cameras/isapi.controller';
import { CameraWorkers } from './cameras/pull-worker';
import { BotEngine } from './telegram/engine';
import { BotRegistry, Notifier } from './telegram/notifier';
import { TelegramWorkers } from './telegram/workers';
import { AiClient } from './ai/ai-client';
import { Icd10Service } from './ai/icd10';
import { NewsService } from './ai/news';
import { NewsWorker } from './ai/news-worker';
import { FiscalController } from './fiscal/fiscal.controller';
import { FiscalWorker } from './fiscal/worker';

const http = new Logger('HTTP');
/** One line per finished request: method, path, status, ms, request id, tenant and role — never a body, a query value or clinical text. */
function requestLog(req: any, res: any) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    // a camera's push address carries its secret token: masked like in the error log
    const path = String(req.originalUrl || req.url).split('?')[0].replace(/\/hik\/[^/?#]+/, '/hik/***');
    if (path.endsWith('/health')) return; // the container probe every 30 s would only fill the log
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    http.log(JSON.stringify({ method: req.method, path, status: res.statusCode, ms: Math.round(ms * 10) / 10, request_id: req.requestId, tenant: req.ctx?.tenantId ?? null, role: req.ctx?.role ?? null }));
  });
}

@Module({
  controllers: [HealthController, SessionController,ReferenceController, PatientsController, AppointmentsController, QueueController, EncountersController, DoctorController,
    LabController, InvoicesController, PaymentsController, DashboardController, ReportsController, InventoryController, DiagnosticsController, AiController,
    AuthController, StaffController, ScheduleExceptionsController, TelegramController, SmsController, FiscalController, DocumentsController, CashController, DepositsController, NoteTemplatesController, QuickPhrasesController, CamerasController, HikController, CameraIsapiController],
  providers: [Db, BotEngine, BotRegistry, Notifier, SmsSender, TelegramWorkers, CameraWorkers, AiClient, Icd10Service, NewsService, NewsWorker, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: ErrorFilter }, FiscalWorker],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((req: any, res: any, next: () => void) => {
      if (!req.requestId) { req.requestId = randomUUID(); res.setHeader('X-Request-Id', req.requestId); }
      res.setHeader('Cache-Control', 'no-store');
      if (config.requestLog) requestLog(req, res);
      next();
    }).forRoutes('*');
  }
}
