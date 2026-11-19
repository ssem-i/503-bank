import request from 'supertest';
import { createApp, type AppDeps } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';

export const API_KEY = 'test-key';

export interface SetupOptions extends Partial<Omit<AppDeps, 'config' | 'clock'>> {
  config?: Partial<AppDeps['config']>;
}

export function setup({ db = openDb(':memory:'), config = {}, ...rest }: SetupOptions = {}) {
  let now = Date.UTC(2026, 10, 19, 6, 0, 0); // 2026-11-19 15:00 KST
  const clock = () => now;
  const app = createApp({ db, clock, config: { bankApiKey: API_KEY, ...config }, ...rest });
  return {
    db,
    app,
    clock,
    tick(ms: number) {
      now += ms;
    },
  };
}

export type App = ReturnType<typeof setup>['app'];

export const KEY = 'withdrawal-20261119-000001';

export const body = {
  bankCode: '088',
  accountNo: '110123456789',
  accountHolder: '김판매',
  amount: 35000,
};

export function postTransfer(app: App, key: string | null = KEY, payload: object = body) {
  const req = request(app).post('/api/v1/transfers').set('X-Api-Key', API_KEY);
  if (key !== null) req.set('Idempotency-Key', key);
  return req.send(payload);
}

export function getTransfer(app: App, key: string = KEY) {
  return request(app).get(`/api/v1/transfers/${key}`).set('X-Api-Key', API_KEY);
}

export function countTransfers(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM transfers').get() as { n: number }).n;
}
