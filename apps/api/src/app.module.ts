import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Db } from './core/db';
import { AuthGuard } from './core/guard';
import { ErrorFilter } from './core/errors';
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
import { TelegramController } from './telegram/telegram.controller';
import { BotEngine } from './telegram/engine';
import { BotRegistry, Notifier } from './telegram/notifier';
import { TelegramWorkers } from './telegram/workers';
import { AiClient } from './ai/ai-client';
import { Icd10Service } from './ai/icd10';
import { NewsService } from './ai/news';
import { NewsWorker } from './ai/news-worker';

@Module({
  controllers: [SessionController, ReferenceController, PatientsController, AppointmentsController, QueueController, EncountersController, DoctorController,
    LabController, InvoicesController, PaymentsController, DashboardController, ReportsController, InventoryController, DiagnosticsController, AiController,
    AuthController, StaffController, TelegramController],
  providers: [Db, BotEngine, BotRegistry, Notifier, TelegramWorkers, AiClient, Icd10Service, NewsService, NewsWorker, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((req: any, res: any, next: () => void) => {
      req.requestId = randomUUID();
      res.setHeader('X-Request-Id', req.requestId);
      res.setHeader('Cache-Control', 'no-store');
      next();
    }).forRoutes('*');
  }
}
