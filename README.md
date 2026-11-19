# 503-bank

replant(식물 중고거래) payment 서비스의 예치금 인출이 부르는 **모의 은행 API**. 설계와 API 계약은 [docs/design.md](docs/design.md)에 있다.
같은 팀의 모의 택배사 [404-express](https://github.com/gasic37200/404-express)를 템플릿으로 만들었다.

## 로컬 실행

Node 24 이상이 필요하다 (내장 `node:sqlite` 사용).

```bash
npm install
cp .env.example .env   # BANK_API_KEY 채우기
npm run dev            # .env를 읽어서 watch 모드로 실행 (기본 포트 3001)
```

`BANK_API_KEY`가 비어 있으면 기동하지 않는다.

## 테스트

```bash
npm run typecheck
npm test
```

## API 요약

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| POST | `/api/v1/transfers` | `X-Api-Key` + `Idempotency-Key` | 지급 |
| GET | `/api/v1/transfers/{idempotencyKey}` | `X-Api-Key` | 지급 조회 |
| GET | `/health` | 없음 | 상태 확인 |

```bash
curl -X POST http://localhost:3001/api/v1/transfers \
  -H "X-Api-Key: $BANK_API_KEY" \
  -H "Idempotency-Key: withdrawal-20261119-000001" \
  -H "Content-Type: application/json" \
  -d '{"bankCode":"088","accountNo":"110123456789","accountHolder":"김판매","amount":35000}'
```

```bash
curl http://localhost:3001/api/v1/transfers/withdrawal-20261119-000001 -H "X-Api-Key: $BANK_API_KEY"
```

## 장애 주입

payment의 결과 불명 복구를 시연·테스트하려고 둔다. 계좌번호 끝자리 규칙은 항상 켜져 있고, `FAULT_MODE`는 환경변수로 켠다(바꾸면 재기동).

| 조건 | 기록 | 응답 | GET 조회 | 재현하는 상황 |
| --- | --- | --- | --- | --- |
| 계좌번호 끝 `0000` | FAILED 기록 | 즉시 `422 INVALID_ACCOUNT` | `FAILED` | 지급 안 됨이 확실한 실패 |
| 계좌번호 끝 `8888` | FAILED 기록 | 즉시 `422 ACCOUNT_HOLDER_MISMATCH` | `FAILED` | 지급 안 됨이 확실한 실패 |
| 계좌번호 끝 `9999` | **COMPLETED 커밋 후** | `FAULT_DELAY_MS` 뒤 `200` (같은 키 재요청은 바로) | 즉시 `COMPLETED` | 처리 후 응답 유실 (클라이언트 타임아웃) |
| `FAULT_MODE=error` | 기록 안 함 | 즉시 `500 INTERNAL_ERROR` | `404` | 처리 전 실패 |
| `FAULT_MODE=slow` | 기록 안 함 | `FAULT_DELAY_MS` 뒤 `503 SERVICE_UNAVAILABLE` | `404` | 처리 전 타임아웃 |

- `FAULT_MODE`: `none`(기본) · `error` · `slow`. 지급(POST)에만 걸리고 조회(GET)는 항상 정상이다. 이미 기록된 키로 다시 보내도 `error` · `slow`가 먼저 걸린다(은행 전체 장애).
- `FAULT_DELAY_MS`: 기본 `10000`.
- 본문 검증(400)과 인증(401)은 장애 주입보다 먼저 본다.

## 운영 배포 (replant MSA 앱 서버)

replant 앱 서버(사설 IP `10.0.7.76`)에 compose로 따로 띄운다. payment는 K3s 파드라 Docker 네트워크 이름으로 bank를 못 찾으므로, 앱 서버 사설 IP의 3001에만 포트를 연다. 인터넷 쪽에는 열리지 않는다.

| 항목 | 값 |
| --- | --- |
| payment → bank | `BANK_BASE_URL=http://10.0.7.76:3001` |
| 인증 키 | 같은 `BANK_API_KEY`를 bank 서버 `~/503-bank/.env`와 replant 앱 서버 `~/secrets/payment.env` 두 곳에 둔다 |
| 이미지 | `ghcr.io/ssem-i/503-bank:{커밋7자리}`, `latest` |
| 서버 디렉터리 | `~/503-bank` (`docker-compose.prod.yml` + `.env`) |
| 데이터 | `bank-data` named volume(실제 이름 `503-bank_bank-data`, compose `name`으로 고정)의 `/data/bank.db` |
| 메모리 | `mem_limit: 128m`, `NODE_OPTIONS=--max-old-space-size=80` |

> [!WARNING]
> **`bank-data` 볼륨을 지우지 말 것.** (`docker compose down -v`, `docker volume rm` 금지)
> 지급 기록이 사라지면 이미 지급한 건도 GET이 `404`(= 처리한 적 없음)를 준다.
> 그러면 payment의 결과 불명 복구가 그 건을 다시 지급해 **이중 지급**이 날 수 있다.

이미지는 CD(`.github/workflows/cd.yml`)가 main push마다 typecheck · test 뒤 GHCR에 올린다. 레포 변수 `CD_DEPLOY=true`이면 앱 서버 self-hosted 러너(라벨 `replant-app`)가 이미 떠 있는 컨테이너를 새 이미지로 바꾼다. 처음 한 번은 서버에서 직접 띄운다.

1. `~/503-bank/.env` 채우기: `.env.example`을 참고한다. 필수는 `BANK_API_KEY` 하나이고, replant `~/secrets/payment.env`의 값과 같아야 한다. 키 값은 커밋 · 출력하지 않는다.
2. `docker-compose.prod.yml`을 `~/503-bank`에 두고 띄운다:

   ```bash
   docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
   ```

3. 특정 커밋 이미지로 띄우려면 `IMAGE_TAG=a1b2c3d docker compose -f docker-compose.prod.yml up -d`.

## 상태 확인

`GET /health`는 인증 없이 `200 {"status":200,"message":"ok"}`를 준다. 컨테이너 healthcheck도 이 경로를 쓴다.

```bash
# 앱 서버에서, payment가 부르는 주소 그대로 확인
curl -s http://10.0.7.76:3001/health
```

```bash
# 컨테이너 상태 (healthy인지)
docker compose -f docker-compose.prod.yml ps
```
