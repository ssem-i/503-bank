export interface Config {
  port: number;
  dbPath: string;
  /** payment → 은행 호출 시 X-Api-Key. 비어 있으면 기동하지 않는다 */
  bankApiKey: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`환경변수 ${name}가 필요합니다.`);
  return value;
}

export function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`환경변수 ${name}는 0 이상의 정수여야 합니다.`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env, 'PORT', 3001),
    dbPath: env.DB_PATH || './data/bank.db',
    bankApiKey: required(env, 'BANK_API_KEY'),
  };
}
