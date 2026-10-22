// Direct connection to a Hikvision camera (ISAPI): the manager enters the camera's address and admin login once;
// Med.uz.ai then checks the device, configures its «HTTP listening» host to our push address, creates the face library
// and enrols faces under our codes — the clinic never opens the camera's own menus. The camera password is stored
// encrypted; a face picture is forwarded to the camera from memory and never stored (docs/HIKVISION.md).
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes } from 'crypto';
import { cameraIsapiSchema, facePhotoSchema } from '@meduza/contracts';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { now } from '../core/clock';
import { assertBranch } from '../core/scope';
import { hashToken } from '../core/guard';
import { decryptSecret, encryptSecret, secretsConfigured } from '../core/secrets';
import { IsapiClient, IsapiError, IsapiTarget } from './isapi-client';

export type CameraIsapiRow = {
  id: string; tenant_id: string; branch_id: string; name: string; status: string; isapi_host: string | null; isapi_port: number; isapi_https: boolean;
  isapi_user: string | null; isapi_password_enc: string | null; delivery: 'push' | 'pull'; fdlib_id: string | null; alert_snapshots: boolean;
};

/** The connection a stored camera row describes, or null when none was entered. */
export function targetOf(c: CameraIsapiRow): IsapiTarget | null {
  if (!c.isapi_host || !c.isapi_user || !c.isapi_password_enc) return null;
  return { host: c.isapi_host, port: c.isapi_port, https: c.isapi_https, username: c.isapi_user, password: decryptSecret(c.isapi_password_enc) };
}

const ISAPI_COLS = `id, tenant_id, branch_id, name, status, isapi_host, isapi_port, isapi_https, isapi_user, isapi_password_enc, delivery, fdlib_id, alert_snapshots,
  isapi_model, isapi_firmware, isapi_serial, isapi_checked_at, isapi_error, listening_configured_at`;

/** What the manager sees about the connection (never the password). */
const publicStatus = (c: any) => ({
  connected: !!c.isapi_host, host: c.isapi_host, port: c.isapi_port, https: c.isapi_https, username: c.isapi_user, delivery: c.delivery,
  model: c.isapi_model, firmware: c.isapi_firmware, serial: c.isapi_serial, checked_at: c.isapi_checked_at, error: c.isapi_error,
  fdlib_id: c.fdlib_id, listening_configured_at: c.listening_configured_at,
});

/** The address the camera pushes to: PUBLIC_URL, else the address this request came in on. */
export function pushUrlFor(req: Request, token: string) {
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/v1/hik/${token}`;
}

/** Maps a camera-side failure to an API error the UI can show next to the form. */
function asApiError(e: unknown): never {
  if (e instanceof AppError) throw e;
  if (e instanceof IsapiError) throw new AppError(e.code === 'AUTH' || e.code === 'LOCKED' || e.code === 'ADDRESS' ? 422 : 502, e.code === 'AUTH' ? 'CAMERA_AUTH' : 'CAMERA_ERROR', e.message,
    e.code === 'AUTH' ? { password: e.message } : e.code === 'ADDRESS' ? { host: e.message } : undefined);
  throw new AppError(502, 'CAMERA_ERROR', `Kamera bilan aloqa xatosi: ${(e as Error).message}`);
}

@Controller('cameras')
export class CameraIsapiController {
  constructor(private db: Db) {}

  private async camera(ctx: Ctx, id: string): Promise<CameraIsapiRow & Record<string, any>> {
    if (!isUuid(id)) throw notFound('Kamera');
    const c = await this.db.one(`SELECT ${ISAPI_COLS} FROM cameras WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
    if (!c) throw notFound('Kamera');
    assertBranch(ctx, c.branch_id);
    return c;
  }

  @Roles('manager') @Get(':id/isapi')
  async status(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const c = await this.camera(ctx, id);
    return { data: publicStatus(c), meta: { secrets_configured: secretsConfigured(), public_url: config.publicUrl || null } };
  }

  /** Saves the camera's address and login, and proves them against the device (model, firmware). */
  @Roles('manager') @Put(':id/isapi')
  async connect(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const c = await this.camera(ctx, id);
    const input = parse(cameraIsapiSchema, body);
    if (!secretsConfigured()) throw conflict('SECRETS_NOT_CONFIGURED', 'Serverda APP_SECRET_KEY sozlanmagan: kamera parolini saqlab bo‘lmaydi');
    let info;
    try { info = await (await IsapiClient.create({ host: input.host, port: input.port ?? 80, https: input.https ?? false, username: input.username, password: input.password })).deviceInfo(); }
    catch (e) {
      await this.db.rows(`UPDATE cameras SET isapi_checked_at = $2, isapi_error = $3 WHERE id = $1`, [c.id, now(), (e as Error).message]).catch(() => undefined);
      asApiError(e);
    }
    await this.db.tx(async (q) => {
      await q.query(
        `UPDATE cameras SET isapi_host = $2, isapi_port = $3, isapi_https = $4, isapi_user = $5, isapi_password_enc = $6, delivery = $7,
                            isapi_model = $8, isapi_firmware = $9, isapi_serial = $10, isapi_checked_at = $11, isapi_error = NULL, model = coalesce(nullif(model, ''), $8)
          WHERE id = $1`,
        [c.id, input.host, input.port ?? 80, input.https ?? false, input.username, encryptSecret(input.password), input.delivery ?? 'push', info.model || null, info.firmware || null, info.serial || null, now()]);
      await audit(q, ctx, 'camera.isapi_connect', 'camera', c.id, `Kamera ulandi: ${input.host} (${info.model || 'model noma’lum'})`, c.branch_id);
    });
    return { data: publicStatus(await this.camera(ctx, id)), meta: { device: info } };
  }

  /** Forgets the camera's login (events already received stay). */
  @Roles('manager') @Delete(':id/isapi') @HttpCode(200)
  async disconnect(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const c = await this.camera(ctx, id);
    await this.db.tx(async (q) => {
      await q.query(`UPDATE cameras SET isapi_host = NULL, isapi_user = NULL, isapi_password_enc = NULL, isapi_error = NULL, listening_configured_at = NULL, delivery = 'push' WHERE id = $1`, [c.id]);
      await audit(q, ctx, 'camera.isapi_disconnect', 'camera', c.id, 'Kamera ulanishi o‘chirildi', c.branch_id);
    });
    return { data: { id } };
  }

  /**
   * One-click setup on the device: a fresh push token is written into the camera's HTTP host 1 (the token itself is
   * shown to nobody), the face library is created, face comparison is switched on, and the camera is asked to send a
   * test notification. In pull mode only the library is prepared.
   */
  @Roles('manager') @Post(':id/isapi/setup') @HttpCode(200)
  async setup(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Req() req: Request) {
    const c = await this.camera(ctx, id);
    const target = targetOf(c);
    if (!target) throw conflict('CAMERA_NOT_CONNECTED', 'Avval kameraning manzili va loginini kiriting');
    const client = await IsapiClient.create(target);
    const result: { fdlib_id?: string; comparison?: boolean; listening?: { ok: boolean; detail: string } } = {};
    try {
      result.fdlib_id = await client.ensureLibrary();
      result.comparison = await client.enableComparison(result.fdlib_id).catch(() => false);
      if (c.delivery === 'push') {
        const token = randomBytes(24).toString('base64url');
        await client.setListeningHost(pushUrlFor(req, token));
        // only now, when the camera has the address, does the new token replace the old one
        await this.db.rows(`UPDATE cameras SET token_hash = $2, token_hint = $3 WHERE id = $1`, [c.id, hashToken(token), token.slice(-4)]);
        result.listening = await client.testListeningHost();
      }
    } catch (e) {
      await this.db.rows(`UPDATE cameras SET isapi_checked_at = $2, isapi_error = $3 WHERE id = $1`, [c.id, now(), (e as Error).message]).catch(() => undefined);
      asApiError(e);
    }
    await this.db.tx(async (q) => {
      await q.query(`UPDATE cameras SET fdlib_id = $2, listening_configured_at = CASE WHEN $3::boolean THEN $4 ELSE listening_configured_at END, isapi_checked_at = $4, isapi_error = NULL WHERE id = $1`,
        [c.id, result.fdlib_id, !!result.listening?.ok, now()]);
      await audit(q, ctx, 'camera.isapi_setup', 'camera', c.id, `Kamera sozlandi: kutubxona ${result.fdlib_id}${result.listening ? `, push ${result.listening.ok ? 'OK' : 'xato: ' + result.listening.detail}` : ', pull rejimi'}`, c.branch_id);
    });
    return { data: { ...publicStatus(await this.camera(ctx, id)), setup: result } };
  }

  /**
   * Enrols a face into the chosen cameras under the person's code. The picture is read from the request, sent to each
   * camera and dropped; only «which code is on which camera» is remembered. Staff codes need the manager's consent
   * confirmation (already recorded with the code); patient codes exist only while the biometric consent is active.
   */
  @Roles('manager') @Post('face-codes/:id/photo') @HttpCode(200)
  async enrol(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Kod');
    const input = parse(facePhotoSchema, body);
    const fc = await this.db.one(
      `SELECT fc.id, fc.code, fc.subject_type, fc.membership_id, fc.patient_id,
              coalesce(u.full_name, p.last_name || ' ' || p.first_name) AS full_name,
              coalesce(m.branch_ids, ARRAY[]::uuid[]) AS branch_ids
         FROM face_codes fc LEFT JOIN memberships m ON m.id = fc.membership_id LEFT JOIN users u ON u.id = m.user_id
         LEFT JOIN patients p ON p.id = fc.patient_id
        WHERE fc.id = $1 AND fc.tenant_id = $2 AND fc.revoked_at IS NULL`, [id, ctx.tenantId]);
    if (!fc) throw notFound('Kod');
    if (fc.subject_type === 'staff' && !fc.branch_ids.some((b: string) => ctx.branchIds.includes(b))) throw notFound('Kod');
    const jpeg = Buffer.from(input.photo_base64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    if (jpeg.length < 10 * 1024) throw new AppError(422, 'VALIDATION', 'Rasm juda kichik', { photo: 'Yuz aniq ko‘rinadigan, kamida 20 KB JPEG yuklang' });
    const cams: CameraIsapiRow[] = await this.db.rows(`SELECT ${ISAPI_COLS} FROM cameras WHERE id = ANY($1) AND tenant_id = $2 AND status = 'active'`, [input.camera_ids, ctx.tenantId]);
    if (!cams.length) throw notFound('Kamera');
    for (const c of cams) assertBranch(ctx, c.branch_id);
    const results: { camera_id: string; camera_name: string; ok: boolean; detail: string }[] = [];
    for (const c of cams) {
      const target = targetOf(c);
      if (!target) { results.push({ camera_id: c.id, camera_name: c.name, ok: false, detail: 'Kamera ulanmagan' }); continue; }
      try {
        const client = await IsapiClient.create(target);
        const fdlib = c.fdlib_id || await client.ensureLibrary();
        // a second enrolment replaces the first picture on the camera
        const prev = await this.db.one(`SELECT remote_id FROM face_code_cameras WHERE face_code_id = $1 AND camera_id = $2`, [fc.id, c.id]);
        if (prev) await client.deleteFace(fdlib, fc.code, prev.remote_id).catch(() => undefined);
        const remoteId = await client.addFace(fdlib, fc.code, jpeg, fc.full_name);
        await this.db.tx(async (q) => {
          if (!c.fdlib_id) await q.query(`UPDATE cameras SET fdlib_id = $2 WHERE id = $1`, [c.id, fdlib]);
          await q.query(
            `INSERT INTO face_code_cameras (face_code_id, camera_id, tenant_id, remote_id, enrolled_by) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (face_code_id, camera_id) DO UPDATE SET remote_id = EXCLUDED.remote_id, enrolled_at = demo_now(), enrolled_by = EXCLUDED.enrolled_by`,
            [fc.id, c.id, ctx.tenantId, remoteId, ctx.membershipId]);
          await audit(q, ctx, 'camera.face_enrol', fc.subject_type === 'staff' ? 'membership' : 'patient', fc.membership_id ?? fc.patient_id, `Yuz kameraga yuklandi: ${fc.code} → ${c.name}`, c.branch_id);
        });
        results.push({ camera_id: c.id, camera_name: c.name, ok: true, detail: 'OK' });
      } catch (e) {
        results.push({ camera_id: c.id, camera_name: c.name, ok: false, detail: e instanceof AppError ? e.message : (e as Error).message });
      }
    }
    // the picture leaves memory with this request; nothing of it is kept
    return { data: { code: fc.code, results, enrolled: results.filter((r) => r.ok).length } };
  }

  /** Which cameras hold this code (for the codes page). */
  @Roles('manager') @Get('face-codes/:id/cameras')
  async enrolledOn(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Kod');
    const rows = await this.db.rows(
      `SELECT c.id AS camera_id, c.name AS camera_name, fcc.enrolled_at FROM face_code_cameras fcc JOIN cameras c ON c.id = fcc.camera_id
        WHERE fcc.face_code_id = $1 AND fcc.tenant_id = $2 AND c.branch_id = ANY($3) ORDER BY c.name`, [id, ctx.tenantId, ctx.branchIds]);
    return { data: rows };
  }
}
