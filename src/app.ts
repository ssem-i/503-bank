import express from 'express';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { requireKey } from './http/auth.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { ok } from './http/response.js';
import type { Clock } from './time.js';
import { transferRoutes } from './transfers/routes.js';
import type { Decide } from './transfers/service.js';

export interface AppDeps {
  db: Db;
  clock: Clock;
  config: Pick<Config, 'bankApiKey'>;
  /** 새 지급 요청의 성공·실패 판정. 기본은 모두 성공 */
  decide?: Decide;
}

export function createApp({ db, clock, config, decide }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  app.get('/health', (_req, res) => {
    res.json(ok('ok'));
  });

  // /api 아래는 경로가 없어도 키부터 본다
  app.use('/api', requireKey('X-Api-Key', config.bankApiKey));
  app.use('/api/v1/transfers', transferRoutes({ db, clock, decide: decide ?? (() => null) }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
