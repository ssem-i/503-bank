import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getTransfer, KEY, postTransfer, setup } from './helpers.js';

describe('지급 조회', () => {
  it('지급한 키는 200 COMPLETED, POST 응답과 같은 내용', async () => {
    const { app } = setup();
    const posted = await postTransfer(app);
    const res = await getTransfer(app);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(posted.body.data);
    expect(res.body.data).toMatchObject({ status: 'COMPLETED', completedAt: '2026-11-19T15:00:00+09:00' });
  });

  it('확정 실패한 키는 200 FAILED + failureCode, completedAt 없음', async () => {
    const { app } = setup({ decide: () => 'INVALID_ACCOUNT' });
    await postTransfer(app);
    const res = await getTransfer(app);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ idempotencyKey: KEY, status: 'FAILED', failureCode: 'INVALID_ACCOUNT', amount: 35000 });
    expect(res.body.data.completedAt).toBeUndefined();
  });

  it('한 번도 기록된 적 없는 키는 404 TRANSFER_NOT_FOUND', async () => {
    const { app } = setup();
    const res = await getTransfer(app, 'never-seen');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TRANSFER_NOT_FOUND');
  });

  it('본문 검증으로 거절된 요청은 기록하지 않으므로 404', async () => {
    const { app } = setup();
    await postTransfer(app, KEY, { amount: 0 });
    expect((await getTransfer(app)).status).toBe(404);
  });

  it('키 형식이 틀리면 400 INVALID_IDEMPOTENCY_KEY', async () => {
    const { app } = setup();
    const res = await getTransfer(app, 'a'.repeat(65));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('X-Api-Key가 없으면 401', async () => {
    const { app } = setup();
    await postTransfer(app);
    const res = await request(app).get(`/api/v1/transfers/${KEY}`);
    expect(res.status).toBe(401);
  });
});
