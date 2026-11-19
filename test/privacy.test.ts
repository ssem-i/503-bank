import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import { API_KEY, body, getTransfer, KEY, postTransfer, setup } from './helpers.js';

// 계좌번호 원문은 DB·로그·응답 어디에도 남지 않아야 한다 (DB에는 해시와 뒤 4자리만)
const ACCOUNTS = ['110123456789', '3333010000', '35610298888', '99887766559999', '110-123-456789'];
const digitsOf = (account: string) => account.replaceAll('-', '');

function dump(db: Db): string {
  return JSON.stringify(db.prepare('SELECT * FROM transfers').all());
}

function expectNoAccount(text: string) {
  for (const account of ACCOUNTS) {
    expect(text).not.toContain(account);
    expect(text).not.toContain(digitsOf(account));
  }
}

describe('계좌번호 원문 비노출', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it('성공 · 재요청 · 409 · 422 · 400 · 9999 · 조회 응답과 로그, DB에 원문이 없다', async () => {
    const { app, db } = setup({ config: { faultDelayMs: 10 } });
    const responses = [
      await postTransfer(app, 'k-ok', { ...body, accountNo: ACCOUNTS[0] }),
      await postTransfer(app, 'k-ok', { ...body, accountNo: ACCOUNTS[0] }),
      await postTransfer(app, 'k-ok', { ...body, accountNo: ACCOUNTS[1] }),
      await postTransfer(app, 'k-invalid', { ...body, accountNo: ACCOUNTS[1] }),
      await postTransfer(app, 'k-holder', { ...body, accountNo: ACCOUNTS[2] }),
      await postTransfer(app, 'k-delay', { ...body, accountNo: ACCOUNTS[3] }),
      await postTransfer(app, 'k-bad', { ...body, accountNo: ACCOUNTS[4] }),
      await postTransfer(app, 'k-bad-amount', { ...body, accountNo: ACCOUNTS[0], amount: -1 }),
      await request(app)
        .post('/api/v1/transfers')
        .set('X-Api-Key', API_KEY)
        .set('Idempotency-Key', 'k-broken')
        .set('Content-Type', 'application/json')
        .send(`{"accountNo":"${ACCOUNTS[0]}",`),
      await getTransfer(app, 'k-ok'),
      await getTransfer(app, 'k-invalid'),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 409, 422, 422, 200, 400, 400, 400, 200, 200]);

    for (const res of responses) expectNoAccount(res.text);
    expect(logs.length).toBeGreaterThan(0);
    expectNoAccount(logs.join('\n'));
    expectNoAccount(dump(db));

    // 로그와 DB에는 뒤 4자리만 남는다
    expect(logs.join('\n')).toContain('account=****6789');
    expect(db.prepare('SELECT account_last4 FROM transfers WHERE idempotency_key = ?').get('k-ok')).toEqual({
      account_last4: '6789',
    });
  });

  it('FAULT_MODE error · slow 로그에도 원문이 없다', async () => {
    for (const faultMode of ['error', 'slow'] as const) {
      const { app } = setup({ config: { faultMode, faultDelayMs: 10 } });
      const res = await postTransfer(app, KEY, { ...body, accountNo: ACCOUNTS[0] });
      expectNoAccount(res.text);
    }
    expectNoAccount(logs.join('\n'));
  });

  it('판정 중 예상하지 못한 예외가 나도 500 응답과 로그에 원문이 없다', async () => {
    const { app } = setup({
      decide: (request) => {
        throw Object.assign(new Error('boom'), { request });
      },
    });
    const res = await postTransfer(app, KEY, { ...body, accountNo: ACCOUNTS[0] });
    expect(res.status).toBe(500);
    expectNoAccount(res.text);
    expectNoAccount(logs.join('\n'));
    expect((await getTransfer(app)).status).toBe(404); // 롤백되어 기록 없음
  });
});
