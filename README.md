# Shanrail

Hệ thống đặt vé tàu hỏa. SR-001 thiết lập web Next.js, API NestJS, PostgreSQL và CI. SR-002 thêm migrations, dữ liệu mẫu Bắc–Nam và đăng nhập API theo vai trò.

## Chạy local

Cần Node.js 24, pnpm 11.18.0 và Docker Compose.

```sh
cp .env.example .env
# Điền POSTGRES_PASSWORD và thay <local-password> trong DATABASE_URL.
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm --filter @shanrail/api build
pnpm --filter @shanrail/api start
```

Với database local mới, dùng cùng một mật khẩu ngẫu nhiên dạng hex cho cả hai biến. Với volume PostgreSQL đã có dữ liệu, điền mật khẩu hiện tại của database. Biến Compose chỉ đặt mật khẩu khi khởi tạo volume mới.

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

## Thanh toán thử nghiệm (SR-007)

Đặt `SHANRAIL_SANDBOX_SECRET` ít nhất 32 ký tự trong môi trường API để bật sandbox nội bộ. Sau khi giữ chỗ, mở **Thông tin hành khách**, điền tên và nhóm giá từng người rồi chọn **Tính tổng tiền**. Mặc định trẻ em giảm 20%, có thể cấu hình bằng `SHANRAIL_CHILD_DISCOUNT_PERCENT` từ 0 đến 99. Giá được chốt bằng VND trên API.

Hai nút mô phỏng gửi kết quả thành công hoặc thất bại tới cùng bộ xử lý callback ký HMAC. Callback thành công hợp lệ chuyển chỗ sang đã bán. Khoản thành công đến muộn chuyển sang trạng thái đối soát `REVIEW`. Sandbox nội bộ không thu tiền và chưa kết nối cổng thanh toán bên thứ ba. Chỉ bật trình mô phỏng ở môi trường thử nghiệm.

## Vé điện tử và lịch sử (SR-008)

Sau khi thanh toán thử thành công, chọn **Xem vé** hoặc mở **Đơn và vé**. Mỗi hành khách có một vé với thông tin chuyến, toa, chỗ và QR chứa mã vé. Migration 007 phát hành bổ sung vé cho các đơn đã thanh toán từ trước. Lịch sử lưu mã truy cập riêng trong phiên tab. Mã vé QR và ID đơn không dùng để truy cập danh sách vé của đơn.

Có thể đặt `SHANRAIL_TEST_MAILBOX` thành một thư mục riêng mà API có quyền ghi. Nút **Ghi thư thử nghiệm** ghi thông tin vé vào file `.eml` trong thư mục đó. Khi ghi lỗi, có thể thử lại. Gửi lại cùng đơn cập nhật file thử nghiệm của đơn. Luồng này dùng hộp thư file để nghiệm thu nội dung, chưa tích hợp SMTP hoặc dịch vụ gửi email.

## Soát vé và đối soát (SR-009)

Mở **Vận hành** tại `/staff`. Tài khoản INSPECTOR nhập mã vé hoặc quét QR bằng máy quét dạng bàn phím. Lần xác nhận đầu lưu người soát và thời điểm. Các lần sau hiển thị vé đã soát và thời điểm ban đầu.

Tài khoản ADMIN tra cứu bằng mã đơn hoặc mã giao dịch và lọc theo trạng thái. Với đơn REVIEW, quản trị viên có thể ghi chú đối soát. Hệ thống lưu ghi nhận đầu tiên, giữ nguyên trạng thái thanh toán và chỗ. Đây là ghi nhận vận hành, chưa thực hiện hoàn tiền tự động.

## Staging HTTPS (SR-010)

Trên máy staging, trỏ DNS của domain về máy và mở cổng 80/443. Tạo file `.env.staging` với `STAGING_HOST`, `STAGING_DB_PASSWORD` (dùng chuỗi hex ngẫu nhiên để nhúng được trong URL) và `SHANRAIL_SANDBOX_SECRET` (ít nhất 32 ký tự). Chạy `docker compose --env-file .env.staging -f compose.staging.yaml up -d --build --wait`. Caddy xử lý HTTPS và chuyển tiếp SSE. API chạy migration trước khi khởi động. PostgreSQL chỉ kết nối qua mạng nội bộ Compose. Xem lỗi và thời gian phản hồi bằng `docker compose --env-file .env.staging -f compose.staging.yaml logs api`.

Tạo dữ liệu mẫu bằng `docker compose --env-file .env.staging -f compose.staging.yaml exec -e SHANRAIL_SEED_PASSWORD api pnpm db:seed`, với mật khẩu mẫu đã đặt trong môi trường shell. Trên trang quản trị, tạo mẫu toa 50 chỗ rồi lập và mở bán chuyến 10 toa dùng mẫu đó. Chạy `node apps/api/scripts/staging-perf.mjs https://<host> <trip-id> <from-id> <to-id> YYYY-MM-DD` để ghi p95 với 100 yêu cầu mỗi endpoint, đồng thời 10 yêu cầu. Chạy từ máy có kết nối tới staging.

Để nghiệm thu realtime, mở cùng sơ đồ toa ở hai phiên desktop/mobile độc lập. Giữ rồi hủy một ghế ở phiên thứ nhất và đo thời gian để trạng thái đổi ở phiên thứ hai. Kiểm tra cả thời điểm lượt giữ tự hết hạn. Mục tiêu là 1–2 giây. SSE kiểm tra ảnh chụp trạng thái mỗi giây theo từng kết nối đang mở.

## Nghiệm thu MVP và vận hành (SR-011)

CI dựng PostgreSQL mới, chạy migration và seed hai lần, rồi kiểm tra liveness/readiness và luồng hai chiều từ lập chuyến đến soát vé. Sau HTTP smoke test, CI dump và restore dữ liệu sang một database tạm, xác nhận các bảng nghiệp vụ có dữ liệu và so sánh số dòng cùng dấu vân tay dữ liệu của mọi bảng public. Bài restore tự dọn database tạm và bản dump. Chạy riêng trên **database thử nghiệm đã có dữ liệu smoke và không có ghi đồng thời** bằng `scripts/verify-postgres-restore.sh <postgres-container> [database]`.

Khi triển khai staging, giữ các biến môi trường trong file riêng và dùng PostgreSQL volume theo cấu hình staging. Trước khi cập nhật, tạo bản dump PostgreSQL định dạng custom và lưu vào nơi sao lưu được bảo vệ. Khi diễn tập khôi phục, tạo database đích mới, restore vào đó, kiểm tra dữ liệu và health check trước khi chuyển API sang database đã khôi phục. Giữ database hiện tại để có thể chuyển lại nếu kiểm tra thất bại.

| Tiêu chí phát hành | Cách xác minh |
| --- | --- |
| Tạo chuyến, giữ chỗ, thanh toán sandbox, phát và soát vé | Job CI chạy `auth-smoke.mjs` |
| Backup và restore dữ liệu có giao dịch và lượt soát vé | Bước restore trong cùng job CI |
| HTTPS và giao diện desktop/mobile | Kiểm tra trên staging theo SR-010 |
| p95 dưới 500 ms và cập nhật chỗ trong 1–2 giây | Đo trên staging với đoàn 500 chỗ theo SR-010 |

Ghi lại commit, kết quả CI, URL staging, thời gian restore và số đo hiệu năng trong biên bản nghiệm thu. Gắn tag MVP cho commit đã qua nghiệm thu. Phạm vi hiện tại dùng sandbox thanh toán nội bộ và hộp thư file thử nghiệm.
