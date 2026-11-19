import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db.js';
import { body, countTransfers, getTransfer, KEY, postTransfer, setup } from './helpers.js';

describe('같은 키 동시 요청', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

  function fileDb(dir: string): Db {
    const db = openDb(join(dir, 'bank.db'));
    cleanups.unshift(() => db.close());
    return db;
  }

  it('한 프로세스에서 동시에 20번 보내도 기록은 1건, 모두 같은 transferId', async () => {
    const { app, db } = setup();
    const results = await Promise.all(Array.from({ length: 20 }, () => postTransfer(app)));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    expect(new Set(results.map((r) => r.body.data.transferId)).size).toBe(1);
    expect(countTransfers(db)).toBe(1);
  });

  it('같은 DB 파일을 연 두 인스턴스(커넥션)로 동시에 보내도 기록은 1건', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bank-db-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const a = setup({ db: fileDb(dir) });
    const b = setup({ db: fileDb(dir) });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => postTransfer(i % 2 === 0 ? a.app : b.app)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    expect(new Set(results.map((r) => r.body.data.transferId)).size).toBe(1);
    expect(countTransfers(a.db)).toBe(1);
    expect((await getTransfer(b.app)).body.data.transferId).toBe(results[0].body.data.transferId);
  });

  it('같은 키 + 서로 다른 본문이 동시에 오면 하나만 기록되고 나머지는 409', async () => {
    const { app, db } = setup();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => postTransfer(app, KEY, { ...body, amount: 1000 + i })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(countTransfers(db)).toBe(1);
  });

  it('스키마가 idempotency_key 중복을 막는다 (마지막 방어선)', async () => {
    const { app, db } = setup();
    await postTransfer(app);
    expect(() =>
      db
        .prepare(
          `INSERT INTO transfers (transfer_id, idempotency_key, request_hash, bank_code, account_last4, amount, status, created_at)
           SELECT 'other-id', idempotency_key, request_hash, bank_code, account_last4, amount, status, created_at FROM transfers`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
    expect(countTransfers(db)).toBe(1);
  });
});
