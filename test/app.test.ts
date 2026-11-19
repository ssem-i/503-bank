import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { API_KEY, setup } from './helpers.js';

describe('기본', () => {
  it('/health는 인증 없이 200', async () => {
    const { app } = setup();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('/api는 X-Api-Key가 없으면 401', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/anything');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('/api는 X-Api-Key가 틀리면 401', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/anything').set('X-Api-Key', `${API_KEY}x`);
    expect(res.status).toBe(401);
  });

  it('없는 경로는 404', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/anything').set('X-Api-Key', API_KEY);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('설정', () => {
  it('BANK_API_KEY가 비어 있으면 기동하지 않는다', () => {
    expect(() => loadConfig({})).toThrow('BANK_API_KEY');
    expect(() => loadConfig({ BANK_API_KEY: '' })).toThrow('BANK_API_KEY');
  });

  it('기본값: 포트 3001, ./data/bank.db', () => {
    expect(loadConfig({ BANK_API_KEY: 'k' })).toMatchObject({ port: 3001, dbPath: './data/bank.db' });
  });
});
