import type { ErrorRequestHandler, RequestHandler } from 'express';
import { error } from './response.js';

export const ErrorCode = {
  BAD_REQUEST_DATA: [400, '잘못된 요청입니다.'],
  UNAUTHORIZED: [401, '인증 키가 올바르지 않습니다.'],
  RESOURCE_NOT_FOUND: [404, '요청한 리소스를 찾을 수 없습니다.'],
  INTERNAL_ERROR: [500, '서버 내부 오류가 발생했습니다.'],
} as const satisfies Record<string, readonly [number, string]>;

export type ErrorCodeName = keyof typeof ErrorCode;

export class BusinessError extends Error {
  readonly status: number;

  constructor(readonly code: ErrorCodeName, message?: string) {
    super(message ?? ErrorCode[code][1]);
    this.status = ErrorCode[code][0];
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const [status, message] = ErrorCode.RESOURCE_NOT_FOUND;
  res.status(status).json(error(status, 'RESOURCE_NOT_FOUND', message));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof BusinessError) {
    res.status(err.status).json(error(err.status, err.code, err.message));
    return;
  }
  // express.json()의 JSON 파싱 실패. 본문(계좌번호가 들어 있을 수 있음)은 로그에 남기지 않는다
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    const [status, message] = ErrorCode.BAD_REQUEST_DATA;
    res.status(status).json(error(status, 'BAD_REQUEST_DATA', message));
    return;
  }
  // 예외 객체에 요청 본문이 묻어 있을 수 있어 이름과 메시지만 남긴다
  console.error('Unexpected exception', err instanceof Error ? `${err.name}: ${err.message}` : typeof err);
  const [status, message] = ErrorCode.INTERNAL_ERROR;
  res.status(status).json(error(status, 'INTERNAL_ERROR', message));
};
