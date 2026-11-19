// 장애 주입: payment의 결과 불명 복구를 시연·테스트하려고 둔다. 규칙표는 README와 docs/design.md에 있다.
import type { TransferRequest } from './schema.js';
import type { Decide } from './service.js';

export const FAULT_MODES = ['none', 'error', 'slow'] as const;
/**
 * none: 정상
 * error: 기록하지 않고 500 (처리 전 실패)
 * slow: 기록하지 않고 FAULT_DELAY_MS 기다린 뒤 503 (처리 전 타임아웃)
 */
export type FaultMode = (typeof FAULT_MODES)[number];

export const DEFAULT_FAULT_DELAY_MS = 10_000;

/** 계좌번호 끝자리로 확정 실패를 정한다. 그 밖의 계좌는 모두 지급 완료 */
export const decideByAccount: Decide = (request) => {
  if (request.accountNo.endsWith('0000')) return 'INVALID_ACCOUNT';
  if (request.accountNo.endsWith('8888')) return 'ACCOUNT_HOLDER_MISMATCH';
  return null;
};

/** 끝자리 9999: COMPLETED로 기록·커밋한 뒤 응답만 늦춘다 (처리 후 응답 유실) */
export const delaysResponse = (request: TransferRequest) => request.accountNo.endsWith('9999');

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
