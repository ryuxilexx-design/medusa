// Doctor dictation: POST /dictation (multipart: `audio` + `field` + `encounter_id`). The recording is read into memory,
// handed to the speech-to-text server (ai/stt.ts) and dropped — never written to disk, the database or a log.
// `structure=1` passes the transcript through the note draft (AI-01) with every AI guard; the draft is never saved.
import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { dictationSchema, localizeServerText, translate } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, invalid } from '../core/errors';
import { parse } from '../core/validate';
import { audit } from '../core/audit';
import { AiClient } from '../ai/ai-client';
import { AUDIO_MAX_BYTES, audioKind, SttClient } from '../ai/stt';
import { draftNote, patientOf } from './ai.controller';

// multer ships with @nestjs/platform-express; memory storage only (no `dest`, no disk storage)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer: any = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MAX_BYTES, files: 1, fields: 8, fieldSize: 200, parts: 9 },
}).single('audio');

type AudioFile = { buffer: Buffer; mimetype: string; size: number };

/** Reads the multipart body into memory; multer's errors become our codes (413 too large, 422 malformed). */
function readMultipart(req: Request, res: Response): Promise<{ file?: AudioFile; body: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    upload(req, res, (err: any) => {
      if (!err) return resolve({ file: (req as any).file, body: { ...((req as any).body ?? {}) } });
      if (err.code === 'LIMIT_FILE_SIZE') return reject(coded(413, 'AUDIO_TOO_LARGE', 'api.stt.tooLarge'));
      reject(invalid({ audio: 'Ovoz fayli noto‘g‘ri yuborildi' }));
    });
  });
}

@Controller('dictation')
export class DictationController {
  constructor(private db: Db, private ai: AiClient, private stt: SttClient) {}

  @Roles('doctor') @Post() @HttpCode(200)
  async dictate(@CurrentCtx() ctx: Ctx, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // cheap refusals first, before the recording is read
    this.stt.assertAvailable();
    await this.stt.assertRate(ctx.membershipId);
    const { file, body } = await readMultipart(req, res);
    const input = parse(dictationSchema, body);
    // the treating doctor only (another clinic's encounter → 404, another doctor's → 403), like the note itself
    await patientOf(this.db, ctx, input.encounter_id);
    if (!file || !file.size) throw invalid({ audio: 'Ovoz yozuvi bo‘sh' });
    const kind = audioKind(file.mimetype, file.buffer);
    if (!kind) throw coded(415, 'AUDIO_TYPE', 'api.stt.type');
    const language = input.language ?? (ctx.locale === 'ru' ? 'ru' : 'uz');
    const { text, seconds, model } = await this.stt.transcribe({
      audio: file.buffer, mime: file.mimetype, kind, language, clientSeconds: input.seconds, tenantId: ctx.tenantId, membershipId: ctx.membershipId,
    });
    (file as any).buffer = null; // nothing keeps the recording after this point
    // no transcript in the audit trail — only that a dictation happened, its length and the engine
    await audit(this.db.pool, ctx, 'ai.dictation', 'encounter', input.encounter_id, `Ovozli diktovka: ${Math.round(seconds)} s (${model})`);
    let draft: Awaited<ReturnType<typeof draftNote>> | null = null;
    let draft_error: { code: string; message: string } | null = null;
    if (input.field === 'all' && input.structure === '1') {
      // the transcript is already on its way back to the doctor: a failed draft must not lose it
      try {
        draft = await draftNote(this.db, this.ai, ctx, text.slice(0, 6000), input.encounter_id);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        draft_error = { code: e.code, message: e.key ? translate(ctx.locale, e.key, e.params) : localizeServerText(ctx.locale, e.message) };
      }
    }
    return { data: { text, seconds, field: input.field, language, draft, draft_error } };
  }
}
