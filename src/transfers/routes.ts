import { Router } from 'express';
import type { Db } from '../db.js';
import { BusinessError, ErrorCode } from '../http/errors.js';
import { error, ok } from '../http/response.js';
import type { Clock } from '../time.js';
import { IDEMPOTENCY_KEY_PATTERN, transferRequestSchema, type TransferRequest } from './schema.js';
import { transfer, type Decide } from './service.js';

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
}

export function transferRoutes({ db, clock, decide }: TransferRouteDeps): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const key = idempotencyKeyOf(req.header('Idempotency-Key'));
    const request = parseTransferBody(req.body);

    // 커밋까지 끝난 뒤에 응답한다
    const result = transfer(db, key, request, clock(), decide);
    const view = result.transfer;
    console.log(
      `[transfer] ${result.created ? 'processed' : 'replayed'} key=${key} status=${view.status}` +
        `${view.failureCode ? ` failureCode=${view.failureCode}` : ''} amount=${view.amount} account=****${result.log.accountLast4}`,
    );

    if (view.status === 'COMPLETED') {
      res.status(200).json(ok('지급이 완료되었습니다.', view));
      return;
    }
    const code = view.failureCode!;
    const [status, message] = ErrorCode[code];
    res.status(status).json(error(status, code, message, view));
  });

  return router;
}
