import { z } from 'zod';

// payment가 만드는 키. 영문·숫자·하이픈 1~64자
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

// 메시지에 입력값을 넣지 않는다(계좌번호가 응답·로그에 남지 않게)
export const transferRequestSchema = z.object({
  bankCode: z.string().regex(/^\d{3}$/, '숫자 3자리여야 합니다'),
  accountNo: z.string().regex(/^\d{10,14}$/, '숫자 10~14자리여야 합니다'),
  accountHolder: z.string().trim().min(1, '비어 있을 수 없습니다').max(50, '50자 이하여야 합니다'),
  amount: z.number().int('정수여야 합니다').positive('0보다 커야 합니다').max(Number.MAX_SAFE_INTEGER),
});

export type TransferRequest = z.infer<typeof transferRequestSchema>;
