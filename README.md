# Shanrail

Hệ thống đặt vé tàu hỏa. SR-001 thiết lập web Next.js, API NestJS, PostgreSQL và CI. SR-002 thêm migrations, dữ liệu mẫu Bắc–Nam và đăng nhập API theo vai trò.

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

## Dữ liệu mẫu và đăng nhập

Sau khi PostgreSQL chạy, dùng `pnpm db:migrate`. Lệnh này có thể chạy lại trên cùng cơ sở dữ liệu. Để tạo dữ liệu demo, thêm `SHANRAIL_SEED_PASSWORD` (12–128 ký tự) vào `.env`, build API rồi chạy `pnpm db:seed`. Seed chỉ tạo bản ghi còn thiếu và giữ nguyên mật khẩu của tài khoản demo đã tồn tại.

Tài khoản mẫu gồm `customer@example.test`, `admin@example.test` và `inspector@example.test`. Hai tuyến demo có cùng năm ga theo thứ tự ngược nhau. Khoảng cách trong seed dùng để kiểm thử nghiệp vụ.

Gửi email và mật khẩu tới `POST /auth/login` dưới dạng JSON. API trả token Bearer có hạn 8 giờ cho `GET /auth/me`, `POST /auth/logout` và các endpoint theo vai trò. `GET /access/admin` và `GET /access/inspection` kiểm tra phân quyền. Truy cập không có phiên hợp lệ trả 401. Sai vai trò trả 403.
