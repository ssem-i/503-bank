import { createHash, randomUUID } from 'node:crypto';
import { transaction, type Db } from '../db.js';
import { BusinessError } from '../http/errors.js';
import { toKst } from '../time.js';
import type { TransferRequest } from './schema.js';

export type TransferStatus = 'COMPLETED' | 'FAILED';
/** 지급이 안 된 것이 확실한 실패. 422로 돌려준다 */
export type FailureCode = 'INVALID_ACCOUNT' | 'ACCOUNT_HOLDER_MISMATCH';

/** 새 요청의 처리 결과를 정한다. null이면 지급 완료 */
export type Decide = (request: TransferRequest) => FailureCode | null;

interface TransferRow {
  id: number;
  transfer_id: string;
  idempotency_key: string;
  request_hash: string;
  bank_code: string;
  account_last4: string;
  amount: number;
  status: TransferStatus;
  failure_code: FailureCode | null;
  created_at: number;
  completed_at: number | null;
}

export interface TransferView {
  transferId: string;
  idempotencyKey: string;
  status: TransferStatus;
  failureCode?: FailureCode;
  amount: number;
  completedAt?: string;
}

/** 로그용 요약. 계좌번호는 뒤 4자리만 */
export interface TransferLogInfo {
  accountLast4: string;
}

function toView(row: TransferRow): TransferView {
  return {
    transferId: row.transfer_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    amount: row.amount,
    ...(row.completed_at !== null ? { completedAt: toKst(row.completed_at) } : {}),
  };
}

/**
 * 같은 본문인지 판별하는 해시. 필드 순서를 고정해 직렬화하므로 요청 JSON의 키 순서와 무관하다.
 * 계좌번호 원문 대신 이 해시만 저장한다.
 */
export function hashRequest(request: TransferRequest): string {
  const canonical = JSON.stringify([request.bankCode, request.accountNo, request.accountHolder, request.amount]);
  return createHash('sha256').update(canonical).digest('hex');
}

function findRow(db: Db, idempotencyKey: string): TransferRow | undefined {
  return db.prepare(`SELECT * FROM transfers WHERE idempotency_key = ?`).get(idempotencyKey) as TransferRow | undefined;
}

/**
 * 지급. 같은 키가 이미 있으면 새로 처리하지 않고 처음 결과(성공이든 실패든)를 돌려준다.
 * 판정과 기록이 한 트랜잭션이고, 커밋된 뒤에야 반환하므로 응답보다 기록이 먼저다.
 * BEGIN IMMEDIATE로 쓰기 잠금을 먼저 잡고, idempotency_key UNIQUE가 마지막 방어선이다.
 */
export function transfer(
  db: Db,
  idempotencyKey: string,
  request: TransferRequest,
  now: number,
  decide: Decide,
): { transfer: TransferView; created: boolean; log: TransferLogInfo } {
  const requestHash = hashRequest(request);
  const log = { accountLast4: request.accountNo.slice(-4) };
  return transaction(db, () => {
    const existing = findRow(db, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) throw new BusinessError('IDEMPOTENCY_KEY_REUSED');
      return { transfer: toView(existing), created: false, log };
    }

    const failureCode = decide(request);
    db.prepare(
      `INSERT INTO transfers (transfer_id, idempotency_key, request_hash, bank_code, account_last4, amount,
                              status, failure_code, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      idempotencyKey,
      requestHash,
      request.bankCode,
      log.accountLast4,
      request.amount,
      failureCode ? 'FAILED' : 'COMPLETED',
      failureCode,
      now,
      failureCode ? null : now,
    );
    return { transfer: toView(findRow(db, idempotencyKey)!), created: true, log };
  });
}
