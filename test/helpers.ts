import { createApp, type AppDeps } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';

export const API_KEY = 'test-key';

export function setup(config: Partial<AppDeps['config']> = {}, db: Db = openDb(':memory:')) {
  let now = Date.UTC(2026, 10, 19, 6, 0, 0); // 2026-11-19 15:00 KST
  const clock = () => now;
  const app = createApp({ db, clock, config: { bankApiKey: API_KEY, ...config } });
  return {
    db,
    app,
    clock,
    tick(ms: number) {
      now += ms;
    },
  };
}
