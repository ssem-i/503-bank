import { DEFAULT_FAULT_DELAY_MS, FAULT_MODES, type FaultMode } from './transfers/faults.js';

export interface Config {
  port: number;
  dbPath: string;
  /** payment → 은행 호출 시 X-Api-Key. 비어 있으면 기동하지 않는다 */
  bankApiKey: string;
  /** 장애 주입 모드. 지급(POST)에만 걸린다 */
  faultMode: FaultMode;
  /** slow 모드와 끝자리 9999 계좌의 응답 지연 ms */
  faultDelayMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`환경변수 ${name}가 필요합니다.`);
  return value;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`환경변수 ${name}는 0 이상의 정수여야 합니다.`);
  return value;
}

function faultMode(env: NodeJS.ProcessEnv): FaultMode {
  const raw = env.FAULT_MODE || 'none';
  if (!(FAULT_MODES as readonly string[]).includes(raw)) {
    throw new Error(`환경변수 FAULT_MODE는 ${FAULT_MODES.join(' | ')} 중 하나여야 합니다.`);
  }
  return raw as FaultMode;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env, 'PORT', 3001),
    dbPath: env.DB_PATH || './data/bank.db',
    bankApiKey: required(env, 'BANK_API_KEY'),
    faultMode: faultMode(env),
    faultDelayMs: int(env, 'FAULT_DELAY_MS', DEFAULT_FAULT_DELAY_MS),
  };
}
