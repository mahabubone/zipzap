/**
 * POST /v1/deliveries/:id/proof/code and /proof — issue a recipient code, then redeem it.
 *
 * Two endpoints because they are two moments. `code` happens when the rider asks the customer to
 * confirm; `proof` happens after the customer has said the digits. Collapsing them would re-send a
 * code on every retry, and the customer would get five messages for one parcel.
 *
 * Redemption takes an Idempotency-Key because it is evidence: a rider whose confirmation response
 * is lost on a bad connection must be able to send it again without the server recording two
 * proofs — or, worse, spending the attempt budget twice for one guess.
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsLatitude, IsLongitude, IsString, Matches, MaxLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { DeliveryProofService } from './delivery-proof.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { ALLOWED_PHOTO_TYPES, OTP_LENGTH } from './rules/proof.ts';
import { IssuedDeliveryCodeDto, SubmittedDeliveryProofDto } from './delivery-response.dto.ts';

export class SubmitProofDto {
  /** Exactly OTP_LENGTH digits. Anything else is a wrong guess, not a malformed request. */
  @IsString()
  @Matches(new RegExp(`^\\d{${OTP_LENGTH}}$`), { message: `code must be ${OTP_LENGTH} digits` })
  code!: string;

  /** Raw base64, no data: prefix — the client encodes the bytes and sends them. */
  @IsString()
  @MaxLength(4_000_000)
  photoBase64!: string;

  @IsIn([...ALLOWED_PHOTO_TYPES])
  photoContentType!: (typeof ALLOWED_PHOTO_TYPES)[number];

  /** Where the parcel was handed over. Checked against Bangladesh, not trusted as a number. */
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;
}

@ApiTags('deliveries')
@Controller('v1/deliveries')
@UseGuards(ApiKeyGuard)
export class DeliveryProofController {
  constructor(@Inject(DeliveryProofService) private readonly proofs: DeliveryProofService) {}

  @ApiErrors()
  @Post(':id/proof/code')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({
    summary: 'Issue a delivery code for the recipient to read out',
    description:
      'Returns the code once, in plaintext. It is stored only as a salted SHA-256 hash and is ' +
      'valid for ten minutes or five attempts, whichever comes first.',
  })
  @ApiParam({
    name: 'id',
    description: 'The delivery job to mint a recipient confirmation code for.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional here: issuing a code is a reissue, not a duplicate effect, and each issue replaces ' +
      'the previous code. Send it only if the client needs replay protection on the issue itself.',
  })
  @ApiOkResponse({
    type: IssuedDeliveryCodeDto,
    description:
      "Mints (or replaces) the recipient's confirmation code and returns it once, in plaintext — it " +
      'is stored only as a salted SHA-256 hash, so this response is the only moment the code exists. ' +
      'It is valid for ten minutes or five attempts, whichever comes first, and only while the job is ' +
      'OUT_FOR_DELIVERY or ATTEMPTED; reissuing kills the previous code immediately.',
  })
  async issueCode(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<IssuedDeliveryCodeDto> {
    return this.proofs.issueCode({
      jobId: id,
      actorId: request.principal?.subjectId ?? null,
    });
  }

  @ApiErrors()
  @Post(':id/proof')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({
    summary: 'Redeem a delivery code with a photo and a location',
    description:
      'Writes an immutable proof. The delivery itself is a separate call: POST /:id/complete ' +
      'refuses to mark a parcel delivered until this has succeeded.',
  })
  @ApiParam({ name: 'id', description: 'The delivery job whose proof is being submitted.' })
  @ApiBody({
    type: SubmitProofDto,
    description:
      'The four-digit code the recipient read out; the photo as raw base64 (no data: prefix; JPEG, ' +
      'PNG, or WebP; at most 2 MB); and the handover coordinates, checked against Bangladesh rather ' +
      'than trusted as a number.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required. A guess is evidence: resending the same key re-runs that guess instead of recording ' +
      'a second proof or spending the attempt budget twice; reuse with a different body is a 400.',
  })
  @ApiOkResponse({
    type: SubmittedDeliveryProofDto,
    description:
      "Writes an immutable proof and returns it as VERIFIED — the photo's SHA-256 and its measured " +
      'byte length, plus when the code was confirmed. The code is checked before the photo is hashed, ' +
      'so a wrong guess costs one of five and never the upload; the delivery itself ' +
      '(POST /:id/complete) will not run until this has succeeded.',
  })
  async submit(
    @Param('id') id: string,
    @Body() body: SubmitProofDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SubmittedDeliveryProofDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      // A guess is evidence too: replaying a submission must not spend a second attempt.
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }
    const { result, replayed } = await this.proofs.submit({
      jobId: id,
      code: body.code,
      photoBase64: body.photoBase64,
      photoContentType: body.photoContentType,
      latitude: body.latitude,
      longitude: body.longitude,
      idempotencyKey: idempotencyKey.trim(),
      actorId: request.principal?.subjectId ?? null,
    });
    return { ...result, replayed };
  }
}
