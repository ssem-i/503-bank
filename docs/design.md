# 503-bank 설계

replant(식물 중고거래) payment 서비스의 예치금 인출이 부르는 **모의 은행**.
payment가 판매자 계좌로 돈을 보내 달라고 요청하면, 요청 안에서 즉시 지급 완료(`COMPLETED`) 또는 실패(`FAILED`)로 끝낸다.

payment의 **이중 지급 방지**가 이 서버의 멱등 · 기록 규칙에 기대므로, 아래 [규칙](#반드시-지키는-규칙)은 계약이다.

만들지 않는 것: 웹훅, 잔액 관리, 실제 계좌 검증(계좌 실존·예금주 확인은 [장애 주입](#장애-주입) 규칙으로만 흉내 낸다).

## 상태

| 코드 | 의미 |
|---|---|
| `COMPLETED` | 지급 완료 |
| `FAILED` | 지급 안 됨이 확실한 실패. `failureCode`에 이유 |

처리 중(`PROCESSING`) 상태는 없다. 기록이 있으면 둘 중 하나로 끝난 것이다.

| `failureCode` | 의미 |
|---|---|
| `INVALID_ACCOUNT` | 없는 계좌 |
| `ACCOUNT_HOLDER_MISMATCH` | 예금주 불일치 |

## API

모든 응답은 replant `ApiResponse`와 같은 모양: `{ status, code?, message, data? }` (null 필드 생략).
시각은 ISO-8601 KST (`2026-11-19T15:00:00+09:00`).

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/v1/transfers` | `X-Api-Key` | 지급 |
| GET | `/api/v1/transfers/{idempotencyKey}` | `X-Api-Key` | 지급 조회 |
| GET | `/health` | 없음 | 상태 확인 |

`/api` 아래는 경로와 관계없이 `X-Api-Key`부터 본다. 틀리거나 없으면 `401 UNAUTHORIZED`.

### 지급

```http
POST /api/v1/transfers
X-Api-Key: <BANK_API_KEY>
Idempotency-Key: withdrawal-20261119-000001
Content-Type: application/json

{ "bankCode": "088", "accountNo": "110123456789", "accountHolder": "김판매", "amount": 35000 }
```

| 필드 | 규칙 |
|---|---|
| `Idempotency-Key` 헤더 | 필수, `^[A-Za-z0-9-]{1,64}$` |
| `bankCode` | 숫자 3자리 문자열 |
| `accountNo` | 숫자 10~14자리 문자열 (하이픈 없이) |
| `accountHolder` | 앞뒤 공백을 뺀 1~50자 |
| `amount` | 양의 정수(원) |

| 상황 | 응답 |
|---|---|
| 처음 보는 키, 지급 완료 | `200`, `data: { transferId, idempotencyKey, status: "COMPLETED", amount, completedAt }` |
| 처음 보는 키, 확정 실패 | `422`, `code: INVALID_ACCOUNT \| ACCOUNT_HOLDER_MISMATCH`, `data: { transferId, idempotencyKey, status: "FAILED", failureCode, amount }` |
| 같은 키 + 같은 본문 | 처음 응답 그대로 (200이면 200, 422면 422. `transferId` · `completedAt`도 처음 값) |
| 같은 키 + 다른 본문 | `409 IDEMPOTENCY_KEY_REUSED` (새로 처리하지 않음) |
| 키 없음 / 형식 틀림 | `400 INVALID_IDEMPOTENCY_KEY` |
| 본문 검증 실패 · JSON 깨짐 | `400 BAD_REQUEST_DATA` (`message`에 필드 이름, 입력값은 넣지 않음) |
| 인증 실패 | `401 UNAUTHORIZED` |
| `FAULT_MODE=error` | `500 INTERNAL_ERROR` (기록 안 함) |
| `FAULT_MODE=slow` | `FAULT_DELAY_MS` 뒤 `503 SERVICE_UNAVAILABLE` (기록 안 함) |

응답에는 계좌 정보(은행 · 계좌번호 · 예금주)를 넣지 않는다.

### 지급 조회

`GET /api/v1/transfers/{idempotencyKey}`

| 상황 | 응답 |
|---|---|
| 기록 있음 | `200`, `data: { transferId, idempotencyKey, status, failureCode?, amount, completedAt? }`. `failureCode`는 `FAILED`일 때만, `completedAt`은 `COMPLETED`일 때만 |
| 이 키로 기록된 요청이 한 번도 없음 | `404 TRANSFER_NOT_FOUND` |
| 키 형식 틀림 | `400 INVALID_IDEMPOTENCY_KEY` |

`FAULT_MODE`와 관계없이 항상 정상 동작한다.

## 반드시 지키는 규칙

1. **멱등.** 같은 키 + 같은 본문이면 새로 처리하지 않고 처음 결과를 그대로 돌려준다. 422 실패도 기록하므로 같은 키로 다시 보내면 같은 실패를 준다. 판정은 처음 한 번만 한다(이후 규칙이 바뀌어도 기록된 결과가 우선).
2. **기록 먼저, 응답은 나중.** 판정과 기록을 한 트랜잭션에서 커밋한 뒤에 응답한다. 그래서 GET의 `404`는 "이 키로 처리한 적 없음"일 때뿐이다.
3. **동시성.** `BEGIN IMMEDIATE`로 쓰기 잠금을 먼저 잡고 같은 키를 다시 확인한 뒤 넣는다. `idempotency_key UNIQUE`가 마지막 방어선이다. 같은 키로 동시에 여러 요청이 와도 기록은 하나다(같은 DB 파일을 연 다른 커넥션도 마찬가지).
4. **본문 비교와 계좌번호.** 같은 본문인지는 정규화한 본문의 SHA-256으로 본다. 정규화 = zod 검증 뒤 값(`accountHolder` 앞뒤 공백 제거)을 `[bankCode, accountNo, accountHolder, amount]` 순서로 직렬화. JSON 키 순서와 무관하다. 계좌번호 원문은 DB · 로그 · 응답 어디에도 남기지 않는다. DB에는 해시와 뒤 4자리만, 로그에는 `account=****1234`만 남긴다.
5. **즉시 확정.** 지급은 요청 안에서 `COMPLETED` 또는 `FAILED`로 끝난다.

### payment가 응답을 읽는 법

| 받은 것 | 뜻 | payment가 할 일 |
|---|---|---|
| `200 COMPLETED` | 지급됨 | 완료 처리 |
| `422` | 지급 안 됨 확정 (기록됨) | 실패 처리. 같은 키로 다시 보내도 같은 422 |
| `400` · `401` · `409` | 요청이 잘못됨. 이 요청으로는 아무것도 처리하지 않음 | 요청을 고친다 (409는 그 키에 이미 다른 본문 기록이 있다는 뜻) |
| `500` · `503` · 타임아웃 · 연결 실패 | **결과 불명** | GET으로 확인 |
| → GET `200` | 기록대로 확정 | `COMPLETED`면 완료, `FAILED`면 실패 |
| → GET `404` | 조회 시점까지 처리한 적 없음 | **같은 키로** 다시 지급 요청 (멱등이라 안전) |

GET `404`는 조회 시점 기준이다. 네트워크에서 늦어진 원래 요청이 뒤늦게 도착해 처리될 수 있으므로, 404를 받았다고 곧바로 실패로 확정하기보다 같은 키로 다시 보내 결과를 받는 쪽이 안전하다(늦게 온 원래 요청과 재요청은 같은 키라 기록은 하나).

## 데이터

SQLite 파일 하나(`DB_PATH`, 운영은 `bank-data` 볼륨의 `/data/bank.db`), 테이블 하나.

| 컬럼 | 뜻 |
|---|---|
| `transfer_id` | 은행이 발급하는 지급 ID (UUID), UNIQUE |
| `idempotency_key` | payment가 보낸 키, UNIQUE |
| `request_hash` | 정규화한 본문의 SHA-256 |
| `bank_code`, `account_last4`, `amount` | 은행 코드, 계좌 뒤 4자리, 금액 |
| `status`, `failure_code` | `COMPLETED` / `FAILED` + 실패 이유 |
| `created_at`, `completed_at` | epoch ms. `completed_at`은 `COMPLETED`일 때만 |

볼륨을 지우면 이미 지급한 건도 GET이 404를 주므로 payment가 다시 지급할 수 있다. **운영 볼륨은 지우지 않는다.**

## 장애 주입

payment의 결과 불명 복구를 시연·테스트하려고 둔다. 계좌번호 끝자리 규칙은 항상 켜져 있다.

| 조건 | 기록 | 응답 | GET 조회 | 재현하는 상황 |
|---|---|---|---|---|
| 계좌번호 끝 `0000` | FAILED 기록 | 즉시 `422 INVALID_ACCOUNT` | `FAILED` | 지급 안 됨이 확실한 실패 |
| 계좌번호 끝 `8888` | FAILED 기록 | 즉시 `422 ACCOUNT_HOLDER_MISMATCH` | `FAILED` | 지급 안 됨이 확실한 실패 |
| 계좌번호 끝 `9999` | **COMPLETED 커밋 후** | `FAULT_DELAY_MS` 뒤 `200` | 즉시 `COMPLETED` | 처리 후 응답 유실 |
| `FAULT_MODE=error` | 기록 안 함 | 즉시 `500 INTERNAL_ERROR` | `404` | 처리 전 실패 |
| `FAULT_MODE=slow` | 기록 안 함 | `FAULT_DELAY_MS` 뒤 `503 SERVICE_UNAVAILABLE` | `404` | 처리 전 타임아웃 |

- 평가 순서: 인증(401) → `Idempotency-Key`(400) → 본문 검증(400) → `FAULT_MODE` → 기록(같은 키 재요청 · 409 · 끝자리 판정) → 9999 지연 → 응답.
- `FAULT_MODE`는 이미 기록된 키에도 먼저 걸린다(은행 전체 장애). 조회(GET)에는 걸리지 않는다.
- 9999 지연은 처음 처리할 때만이다. 같은 키 재요청은 기록된 결과를 바로 준다(조회처럼 복구 경로로 쓸 수 있게).
- `FAULT_DELAY_MS` 기본 `10000`. 운영에서 모드를 바꾸려면 `.env`를 고치고 컨테이너를 다시 띄운다.

## 설정

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `BANK_API_KEY` | (필수) | `X-Api-Key`. 비어 있으면 기동하지 않는다 |
| `PORT` | `3001` | |
| `DB_PATH` | `./data/bank.db` | 운영 compose는 `/data/bank.db` |
| `FAULT_MODE` | `none` | `none` · `error` · `slow`. 다른 값이면 기동하지 않는다 |
| `FAULT_DELAY_MS` | `10000` | `slow`와 끝자리 9999의 지연 |
