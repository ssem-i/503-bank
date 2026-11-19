import express from 'express';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { requireKey } from './http/auth.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { ok } from './http/response.js';
import type { Clock } from './time.js';

export interface AppDeps {
  db: Db;
  clock: Clock;
  config: Pick<Config, 'bankApiKey'>;
}

export function createApp({ config }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  app.get('/health', (_req, res) => {
    res.json(ok('ok'));
  });

  // /api 아래는 경로가 없어도 키부터 본다
  app.use('/api', requireKey('X-Api-Key', config.bankApiKey));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
