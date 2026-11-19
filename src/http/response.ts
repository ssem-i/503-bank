// replant 서버의 ApiResponse(status, code, message, data)와 같은 모양. null 필드는 뺀다.
export interface ApiResponse<T> {
  status: number;
  code?: string;
  message: string;
  data?: T;
}

export function ok<T>(message: string, data?: T, status = 200): ApiResponse<T> {
  return data === undefined ? { status, message } : { status, message, data };
}

export function error<T = never>(status: number, code: string, message: string, data?: T): ApiResponse<T> {
  return data === undefined ? { status, code, message } : { status, code, message, data };
}
