import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../core/config';
import { NewsService } from './news';

/** Once an hour: make sure every specialty with an active doctor has today's articles (idempotent per day). */
@Injectable()
export class NewsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('NewsWorker');
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  constructor(private news: NewsService) {}

  onApplicationBootstrap() {
    if (!config.workers || !config.news.enabled) return;
    const run = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        const r = await this.news.refreshAll();
        const added = r.reduce((a, b) => a + b.added, 0);
        if (added) this.log.log(`yangi maqolalar: ${added}`);
      } catch (e) { this.log.warn(`news: ${(e as Error).message}`); } finally { this.busy = false; }
    };
    this.timer = setInterval(run, 60 * 60_000);
    setTimeout(run, 30_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
