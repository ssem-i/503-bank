import { Router } from 'express';
import type { Db } from '../db.js';
import { BusinessError, ErrorCode } from '../http/errors.js';
import { error, ok } from '../http/response.js';
import type { Clock } from '../time.js';
import { IDEMPOTENCY_KEY_PATTERN, transferRequestSchema, type TransferRequest } from './schema.js';
import { delaysResponse, sleep, type FaultMode } from './faults.js';
import { getTransfer, transfer, type Decide } from './service.js';

function parseTransferBody(body: unknown): TransferRequest {
  const result = transferRequestSchema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new BusinessError('BAD_REQUEST_DATA', `${issue.path.map(String).join('.')}: ${issue.message}`);
  }
  return result.data;
}

function idempotencyKeyOf(value: string | undefined): string {
  if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) throw new BusinessError('INVALID_IDEMPOTENCY_KEY');
  return value;
}

export interface TransferRouteDeps {
  db: Db;
  clock: Clock;
  decide: Decide;
  faultMode: FaultMode;
  faultDelayMs: number;
}

export function transferRoutes({ db, clock, decide, faultMode, faultDelayMs }: TransferRouteDeps): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const key = idempotencyKeyOf(req.header('Idempotency-Key'));
    const request = parseTransferBody(req.body);

    // 처리 전 장애: 아무것도 기록하지 않는다 → GET은 404, 같은 키로 다시 보내면 새로 처리
    if (faultMode === 'error') {
      console.warn(`[transfer] fault=error key=${key} (기록 안 함)`);
      throw new BusinessError('INTERNAL_ERROR');
    }
    if (faultMode === 'slow') {
      console.warn(`[transfer] fault=slow key=${key} (기록 안 함, ${faultDelayMs}ms 뒤 503)`);
      await sleep(faultDelayMs);
      throw new BusinessError('SERVICE_UNAVAILABLE');
    }

    // 커밋까지 끝난 뒤에 응답한다
    const result = transfer(db, key, request, clock(), decide);
    const view = result.transfer;
    console.log(
      `[transfer] ${result.created ? 'processed' : 'replayed'} key=${key} status=${view.status}` +
        `${view.failureCode ? ` failureCode=${view.failureCode}` : ''} amount=${view.amount} account=****${result.log.accountLast4}`,
    );

    // 처리 후 응답 유실: 이미 커밋했으므로 클라이언트가 타임아웃 나도 GET은 COMPLETED. 처음 처리할 때만 늦춘다
    if (result.created && view.status === 'COMPLETED' && delaysResponse(request)) {
      console.warn(`[transfer] fault=delay key=${key} (커밋 완료, ${faultDelayMs}ms 뒤 응답)`);
      await sleep(faultDelayMs);
    }

    if (view.status === 'COMPLETED') {
      res.status(200).json(ok('지급이 완료되었습니다.', view));
      return;
    }
    const code = view.failureCode!;
    const [status, message] = ErrorCode[code];
    res.status(status).json(error(status, code, message, view));
  });

  router.get('/:idempotencyKey', (req, res) => {
    const key = idempotencyKeyOf(req.params.idempotencyKey);
    res.json(ok('지급 조회에 성공했습니다.', getTransfer(db, key)));
  });

  return router;
}
