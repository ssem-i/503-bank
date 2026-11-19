import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API_KEY, body, countTransfers, KEY, postTransfer, setup } from './helpers.js';

describe('지급', () => {
  it('처음 요청이면 지급하고 200 COMPLETED', async () => {
    const { app, db } = setup();
    const res = await postTransfer(app);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 200,
      data: { idempotencyKey: KEY, status: 'COMPLETED', amount: 35000, completedAt: '2026-11-19T15:00:00+09:00' },
    });
    expect(res.body.data.transferId).toEqual(expect.any(String));
    expect(res.body.data.failureCode).toBeUndefined();
    expect(res.body.code).toBeUndefined();
    expect(countTransfers(db)).toBe(1);
  });

  it('같은 키 + 같은 본문이면 새로 처리하지 않고 같은 transferId', async () => {
    const { app, db, tick } = setup();
    const first = await postTransfer(app);
    tick(60_000);
    const reordered = { amount: body.amount, accountHolder: ` ${body.accountHolder} `, accountNo: body.accountNo, bankCode: body.bankCode };
    const second = await postTransfer(app, KEY, reordered);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data); // completedAt도 처음 그대로
    expect(countTransfers(db)).toBe(1);
  });

  it.each([
    ['금액', { amount: 35001 }],
    ['계좌번호', { accountNo: '110123456780' }],
    ['은행', { bankCode: '004' }],
    ['예금주', { accountHolder: '이구매' }],
  ])('같은 키 + 다른 본문(%s)이면 409', async (_name, change) => {
    const { app, db } = setup();
    await postTransfer(app);
    const res = await postTransfer(app, KEY, { ...body, ...change });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(countTransfers(db)).toBe(1);
  });

  it('다른 키면 같은 본문이어도 새로 지급', async () => {
    const { app, db } = setup();
    const a = await postTransfer(app, 'key-a');
    const b = await postTransfer(app, 'key-b');
    expect(a.body.data.transferId).not.toBe(b.body.data.transferId);
    expect(countTransfers(db)).toBe(2);
  });

  it('확정 실패(422)도 기록하고, 같은 키로 다시 요청하면 같은 422', async () => {
    const { app, db } = setup({ decide: () => 'ACCOUNT_HOLDER_MISMATCH' });
    const first = await postTransfer(app);
    expect(first.status).toBe(422);
    expect(first.body).toMatchObject({
      status: 422,
      code: 'ACCOUNT_HOLDER_MISMATCH',
      data: { idempotencyKey: KEY, status: 'FAILED', failureCode: 'ACCOUNT_HOLDER_MISMATCH', amount: 35000 },
    });
    expect(first.body.data.completedAt).toBeUndefined();

    const second = await postTransfer(app);
    expect(second.status).toBe(422);
    expect(second.body).toEqual(first.body);
    expect(countTransfers(db)).toBe(1);
  });

  it('판정은 새 요청에만 한다: 실패로 기록된 키는 판정이 바뀌어도 같은 실패', async () => {
    const db = setup().db;
    await postTransfer(setup({ db, decide: () => 'INVALID_ACCOUNT' }).app);
    const res = await postTransfer(setup({ db, decide: () => null }).app);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_ACCOUNT');
  });

  it.each([null, '', 'a'.repeat(65), 'key_with_underscore', 'key with space'])('Idempotency-Key가 없거나 형식이 틀리면 400 (%s)', async (key) => {
    const { app, db } = setup();
    const res = await postTransfer(app, key);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(countTransfers(db)).toBe(0);
  });

  it('Idempotency-Key 64자는 받는다', async () => {
    const { app } = setup();
    const res = await postTransfer(app, 'A-1'.padEnd(64, 'z'));
    expect(res.status).toBe(200);
  });

  it.each([
    ['bankCode 2자리', { bankCode: '88' }],
    ['bankCode 문자', { bankCode: '08a' }],
    ['accountNo 9자리', { accountNo: '123456789' }],
    ['accountNo 15자리', { accountNo: '123456789012345' }],
    ['accountNo 하이픈', { accountNo: '110-123-456789' }],
    ['accountHolder 공백', { accountHolder: '  ' }],
    ['amount 0', { amount: 0 }],
    ['amount 음수', { amount: -1 }],
    ['amount 소수', { amount: 1.5 }],
    ['amount 문자열', { amount: '35000' }],
  ])('본문 검증 실패는 400 BAD_REQUEST_DATA (%s)', async (_name, change) => {
    const { app, db } = setup();
    const res = await postTransfer(app, KEY, { ...body, ...change });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST_DATA');
    expect(countTransfers(db)).toBe(0);
  });

  it('필드 누락은 400 BAD_REQUEST_DATA', async () => {
    const { app } = setup();
    const { amount: _omit, ...rest } = body;
    const res = await postTransfer(app, KEY, rest);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('amount');
  });

  it('JSON이 깨지면 400 BAD_REQUEST_DATA', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/v1/transfers')
      .set('X-Api-Key', API_KEY)
      .set('Idempotency-Key', KEY)
      .set('Content-Type', 'application/json')
      .send('{"amount":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST_DATA');
  });

  it('X-Api-Key가 없으면 401이고 기록하지 않는다', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/v1/transfers').set('Idempotency-Key', KEY).send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(countTransfers(db)).toBe(0);
  });
});
