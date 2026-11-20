import { BadRequestException, Body, Controller, Get, Header, HttpCode, NotFoundException,
  Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoleGuard, Roles, SessionGuard } from './auth.js';
import { Database } from './database.js';
import { record, requiredText, uuid } from './schedule-input.js';

type StaffRequest = { account: { id: string } };

@Controller('inspection')
@Roles('INSPECTOR')
@UseGuards(SessionGuard, RoleGuard)
export class InspectionController {
  constructor(private readonly db: Database) {}

  @Post('tickets')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async inspect(@Body() body: unknown, @Req() request: StaffRequest) {
    const id = uuid(record(body).code, 'ticket');
    const inserted = await this.db.query(`
      INSERT INTO ticket_inspections (ticket_id, inspector_id)
      SELECT k.id, $2 FROM tickets k JOIN checkout_orders o ON o.id=k.order_id
      WHERE k.id=$1 AND o.status='PAID'
      ON CONFLICT (ticket_id) DO NOTHING RETURNING inspected_at
    `, [id, request.account.id]);
    const { rows: [ticket] } = await this.db.query(`
      SELECT i.inspected_at AS "inspectedAt", t.code AS "tripCode",
             o.passengers->(k.passenger_index-1) AS passenger
      FROM ticket_inspections i
      JOIN tickets k ON k.id=i.ticket_id
      JOIN checkout_orders o ON o.id=k.order_id
      JOIN trips t ON t.id=o.trip_id WHERE i.ticket_id=$1
    `, [id]);
    if (!ticket) throw new NotFoundException('Không tìm thấy vé hợp lệ.');
    return { ...ticket, status: inserted.rowCount ? 'CHECKED' : 'ALREADY_CHECKED' };
  }
}

@Controller('admin/orders')
@Roles('ADMIN')
@UseGuards(SessionGuard, RoleGuard)
export class OrderOperationsController {
  constructor(private readonly db: Database) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async orders(@Query('id') id?: string, @Query('status') status?: string) {
    if (status !== undefined && !['PENDING', 'FAILED', 'REVIEW', 'PAID'].includes(status)) {
      throw new BadRequestException('Trạng thái không hợp lệ.');
    }
    const { rows } = await this.db.query(`
      SELECT o.id, o.payment_reference AS "paymentReference", o.status,
        o.amount_vnd AS "amountVnd", o.expires_at AS "expiresAt", o.reviewed_at AS "reviewedAt",
        o.review_note AS "reviewNote", o.reviewed_by AS "reviewedBy", t.code AS "tripCode",
        jsonb_array_length(o.passengers) AS "passengerCount"
      FROM checkout_orders o JOIN trips t ON t.id=o.trip_id
      WHERE ($1::uuid IS NULL OR o.id=$1 OR o.payment_reference=$1)
        AND ($2::text IS NULL OR o.status=$2)
      ORDER BY (o.reviewed_at IS NOT NULL), o.expires_at DESC, o.id LIMIT 100
    `, [id === undefined ? null : uuid(id, 'id'), status ?? null]);
    return rows;
  }

  @Post(':id/review')
  @HttpCode(200)
  async review(@Param('id') id: string, @Body() body: unknown, @Req() request: StaffRequest) {
    const note = requiredText(record(body).note, 'note', 500);
    const { rows: [order] } = await this.db.query(`
      UPDATE checkout_orders SET reviewed_at=COALESCE(reviewed_at, now()),
        reviewed_by=COALESCE(reviewed_by,$2), review_note=COALESCE(review_note,$3)
      WHERE id=$1 AND status='REVIEW'
      RETURNING reviewed_at AS "reviewedAt", review_note AS "reviewNote"
    `, [uuid(id, 'id'), request.account.id, note]);
    if (!order) throw new NotFoundException('Không tìm thấy đơn cần đối soát.');
    return order;
  }
}
