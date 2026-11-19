import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// 계좌번호 원문은 저장하지 않는다: 본문 해시(request_hash)와 뒤 4자리만 남긴다
const SCHEMA = `
CREATE TABLE IF NOT EXISTS transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id     TEXT    NOT NULL UNIQUE,  -- 은행이 발급하는 지급 ID
  idempotency_key TEXT    NOT NULL UNIQUE,  -- payment가 보낸 Idempotency-Key. 키 하나에 기록 하나
  request_hash    TEXT    NOT NULL,         -- 정규화한 본문의 SHA-256. 같은 키로 다른 본문이 오는지 판별
  bank_code       TEXT    NOT NULL,
  account_last4   TEXT    NOT NULL,
  amount          INTEGER NOT NULL,
  status          TEXT    NOT NULL,         -- COMPLETED | FAILED (처리 중 상태 없음)
  failure_code    TEXT,                     -- FAILED일 때만: INVALID_ACCOUNT | ACCOUNT_HOLDER_MISMATCH
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER                   -- COMPLETED일 때만
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** node:sqlite에는 transaction 헬퍼가 없어서 직접 감싼다. 동기 함수만 넘길 것. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
