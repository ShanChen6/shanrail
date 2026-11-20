# Shanrail

Hệ thống đặt vé tàu hỏa. SR-001 thiết lập web Next.js, API NestJS, PostgreSQL và CI. Dữ liệu ga, tuyến và phân quyền sẽ được triển khai ở SR-002.

## Chạy local

Cần Node.js 24, pnpm 11.18.0 và Docker Compose.

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm --filter @shanrail/api build
pnpm --filter @shanrail/api start
```

Mở terminal thứ hai và chạy `pnpm --filter @shanrail/web dev`. Web chạy tại http://localhost:3000. API mặc định dùng cổng 3001. Có thể thay `API_PORT` trong `.env` nếu đang chạy Shancine.

- `GET /health/live` trả 200 khi API nhận được yêu cầu.
- `GET /health/ready` chạy truy vấn PostgreSQL và trả 503 khi DB không truy cập được.

## Kiểm tra

```sh
pnpm lint
pnpm typecheck
pnpm build
node --env-file=.env --run test
```

Smoke test cần PostgreSQL đang chạy và kiểm tra thêm một API instance dùng địa chỉ DB không khả dụng. Hai instance thử nghiệm dùng cổng 3101 và 3102.
