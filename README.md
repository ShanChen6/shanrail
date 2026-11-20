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

## Quản trị lịch tàu (SR-003)

Mở [bảng quản trị local](http://localhost:3000/admin) và đăng nhập bằng tài khoản admin mẫu. Dùng các tab **Ga**, **Tuyến** và **Mẫu toa** để tạo hoặc sửa danh mục. Ở tab **Chuyến tàu**, chọn tuyến, nhập mã mẫu toa theo thứ tự, điền giờ đến/đi theo giờ Việt Nam, lưu bản nháp rồi chọn **Mở bán**. Khi chuyến qua nửa đêm, chọn ngày kế tiếp cho các mốc tương ứng.

Mặc định web chuyển tiếp các yêu cầu quản trị đến API tại `http://127.0.0.1:3001`. Nếu đổi cổng API, đặt `SHANRAIL_API_URL` khi chạy hoặc build web.

API cần token Bearer có quyền quản trị. `GET`, `POST` và `PUT /admin/{stations,routes,coach-templates}` quản lý danh mục (PUT có thêm `/:id`). `POST /admin/trips` nhận `code`, `routeId`, `coachTemplateIds` theo thứ tự toa và `stops` theo đúng thứ tự ga của tuyến. Mỗi điểm dừng có `stationId`, `arrivalAt` và `departureAt` dạng ISO 8601 có múi giờ. Điểm đầu chỉ có giờ đi, điểm cuối chỉ có giờ đến. Dùng `GET /admin/trips/:id` xem chi tiết và `POST /admin/trips/:id/publish` để mở bán chuyến chưa khởi hành. Chuyến lưu bản sao thứ tự ga, số km và cấu hình chỗ theo từng toa.

## Tìm chuyến và xem giá (SR-004)

Trang chủ lấy ga từ `GET /public/stations` và gọi `GET /public/trips?from=<uuid>&to=<uuid>&date=YYYY-MM-DD`. Khách có thể tìm mà không cần đăng nhập. Kết quả lấy ngày theo giờ Việt Nam tại ga lên tàu, kể cả khi chuyến rời ga đầu từ hôm trước. API chỉ trả chuyến đã mở bán, còn giờ lên tàu và đi đúng chiều đã chọn.

Giá mỗi hạng bằng số km của chặng nhân đơn giá VND/km lưu trên chuyến. Đơn giá mẫu là 900 cho ghế và 1.500 cho giường. Kết quả chỉ hiển thị các hạng có cấu hình trên chuyến. Sau khi chạy migration mới, tạo và mở bán một chuyến trong trang quản trị để có dữ liệu tra cứu.

## Sơ đồ toa theo chặng (SR-005)

Từ kết quả tìm chuyến, chọn **Xem sơ đồ toa** rồi chọn toa cần xem. Sơ đồ dùng thứ tự chỗ trong cấu hình toa và hiển thị trạng thái trống, đang giữ hoặc đã bán. Nút **Cập nhật trạng thái** tải lại trạng thái hiện tại.

`GET /public/trips/:id/coaches?from=<uuid>&to=<uuid>` chỉ trả sơ đồ cho chặng còn mở bán. Migration 004 lưu trạng thái chiếm chỗ theo đoạn giữa hai ga liền kề. Chặng kết thúc tại ga lên tàu không xung đột với chặng khách chọn. Lượt giữ hết hạn được xem là trống và trạng thái đã bán được ưu tiên nếu có cả hai trên chặng.

## Giữ chỗ (SR-006)

Chọn tối đa 6 ghế hoặc giường trên một chặng, có thể chọn từ nhiều toa. Chọn **Giữ chỗ** để giữ toàn bộ trong tối đa 10 phút, hoặc đến giờ tàu chạy tại ga lên nếu sớm hơn. Nút **Hủy giữ chỗ** trả lại toàn bộ lượt giữ. Lượt hết hạn được coi là trống ngay và bản ghi hết hạn được dọn khi có yêu cầu giữ mới trên chuyến.

`POST /public/trips/:id/holds` nhận `{from,to,places:[{coachNumber,label}]}`. Nếu có xung đột, API trả 409 và rollback toàn bộ. `DELETE /public/holds/:id` hủy lượt giữ bằng mã trả về từ POST. Mã này được lưu trong phiên tab và có quyền hủy lượt giữ, nên giữ riêng.
