import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { body, countTransfers, getTransfer, KEY, postTransfer, setup } from './helpers.js';

const account = (last4: string) => ({ ...body, accountNo: `11012345${last4}` });

describe('계좌번호 끝자리 규칙', () => {
  it('0000: 422 INVALID_ACCOUNT, 같은 키 재요청도 같은 422, GET은 FAILED', async () => {
    const { app, db } = setup();
    const first = await postTransfer(app, KEY, account('0000'));
    expect(first.status).toBe(422);
    expect(first.body).toMatchObject({ code: 'INVALID_ACCOUNT', data: { status: 'FAILED', failureCode: 'INVALID_ACCOUNT' } });

    const again = await postTransfer(app, KEY, account('0000'));
    expect(again.status).toBe(422);
    expect(again.body).toEqual(first.body);

    const lookup = await getTransfer(app);
    expect(lookup.status).toBe(200);
    expect(lookup.body.data).toMatchObject({ status: 'FAILED', failureCode: 'INVALID_ACCOUNT' });
    expect(countTransfers(db)).toBe(1);
  });

  it('8888: 422 ACCOUNT_HOLDER_MISMATCH', async () => {
    const { app } = setup();
    const res = await postTransfer(app, KEY, account('8888'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ACCOUNT_HOLDER_MISMATCH');
    expect((await getTransfer(app)).body.data.failureCode).toBe('ACCOUNT_HOLDER_MISMATCH');
  });

  it('9999: 커밋한 뒤 응답만 늦춘다. 응답 전에도 GET은 COMPLETED', async () => {
    const delay = 1500;
    const { app } = setup({ config: { faultDelayMs: delay } });
    const startedAt = Date.now();
    let settled = false;
    const posting = postTransfer(app, KEY, account('9999')).then((res) => {
      settled = true;
      return res;
    });

    // 기록이 보일 때까지 조회한다 (POST가 서버에 도착하는 시간만큼)
    let lookup = await getTransfer(app);
    while (lookup.status === 404 && Date.now() - startedAt < delay) lookup = await getTransfer(app);
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.status).toBe('COMPLETED');
    expect(Date.now() - startedAt).toBeLessThan(delay);
    expect(settled).toBe(false); // POST 응답은 아직

    const posted = await posting;
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(delay - 50);
    expect(posted.status).toBe(200);
    expect(posted.body.data).toEqual(lookup.body.data);
  });

  it('9999: 같은 키 재요청은 늦추지 않고 처음 결과를 바로 준다', async () => {
    const delay = 300;
    const { app, db } = setup({ config: { faultDelayMs: delay } });
    const first = await postTransfer(app, KEY, account('9999'));
    const startedAt = Date.now();
    const again = await postTransfer(app, KEY, account('9999'));
    expect(Date.now() - startedAt).toBeLessThan(delay);
    expect(again.body.data.transferId).toBe(first.body.data.transferId);
    expect(countTransfers(db)).toBe(1);
  });
});

describe('FAULT_MODE', () => {
  it('error: 기록하지 않고 500 → GET 404 → 모드 해제 후 같은 키는 정상 처리', async () => {
    const { app, db } = setup({ config: { faultMode: 'error' } });
    const failed = await postTransfer(app);
    expect(failed.status).toBe(500);
    expect(failed.body.code).toBe('INTERNAL_ERROR');
    expect(countTransfers(db)).toBe(0);
    expect((await getTransfer(app)).status).toBe(404); // error 모드에서도 조회는 된다

    const recovered = setup({ db, config: { faultMode: 'none' } }).app;
    const res = await postTransfer(recovered);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect((await getTransfer(recovered)).body.data.transferId).toBe(res.body.data.transferId);
    expect(countTransfers(db)).toBe(1);
  });

  it('error: 이미 기록된 키도 500 (은행 전체 장애), 기록은 그대로', async () => {
    const { db, app } = setup();
    const done = await postTransfer(app);
    const down = setup({ db, config: { faultMode: 'error' } }).app;
    expect((await postTransfer(down)).status).toBe(500);
    expect((await getTransfer(down)).body.data.transferId).toBe(done.body.data.transferId);
  });

  it('slow: 기록하지 않고 FAULT_DELAY_MS 뒤 503', async () => {
    const delay = 200;
    const { app, db } = setup({ config: { faultMode: 'slow', faultDelayMs: delay } });
    const startedAt = Date.now();
    const res = await postTransfer(app);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(delay - 20);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(countTransfers(db)).toBe(0);
    expect((await getTransfer(app)).status).toBe(404);
  });

  it('본문 검증은 장애 주입보다 먼저 한다', async () => {
    const { app } = setup({ config: { faultMode: 'error' } });
    const res = await postTransfer(app, KEY, { ...body, amount: 0 });
    expect(res.status).toBe(400);
  });
});

describe('장애 주입 설정', () => {
  it('기본값: FAULT_MODE=none, FAULT_DELAY_MS=10000', () => {
    expect(loadConfig({ BANK_API_KEY: 'k' })).toMatchObject({ faultMode: 'none', faultDelayMs: 10_000 });
  });

  it('FAULT_MODE 값이 틀리면 기동하지 않는다', () => {
    expect(() => loadConfig({ BANK_API_KEY: 'k', FAULT_MODE: 'broken' })).toThrow('FAULT_MODE');
  });

  it('FAULT_MODE·FAULT_DELAY_MS를 읽는다', () => {
    expect(loadConfig({ BANK_API_KEY: 'k', FAULT_MODE: 'slow', FAULT_DELAY_MS: '500' })).toMatchObject({
      faultMode: 'slow',
      faultDelayMs: 500,
    });
  });
});
