/**
 * Proof of delivery: issue a code the recipient can read out, then redeem it.
 *
 * Two calls, because they are two different moments. `issueCode` happens at the door when the rider
 * asks the customer to confirm; `submit` happens seconds later with what the customer said. Merging
 * them would mean a re-send re-issuing a code on every retry, and the recipient would get five SMS
 * messages for one delivery.
 *
 * The order inside `submit` is the whole design: the code is checked BEFORE the photo is decoded,
 * so a rider guessing codes cannot make the server hash two megabytes five times. Then the photo,
 * then the location. Each step's failure leaves the challenge spendable but the proof unwritten —
 * a customer who fat-fingers the code should not have their photo and coordinates thrown away with it.
 *
 * ponytail: the issued code comes back in the HTTP response instead of going out by SMS. It cannot
 * go through the outbox — that table is append-only, so a plaintext OTP written there is an OTP that
 * lives forever, which is exactly what hashing `code_hash` exists to prevent. Add an SMS hand-off
 * (notification module, BullMQ with a TTL) when a real carrier is wired.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { ProofCodeNotIssuedError, ProofNotAvailableError } from '../../common/domain-error.ts';
import { InvalidIdempotencyKeyError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { claim, release } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import {
  generateOtp,
  hashOtp,
  MAX_OTP_ATTEMPTS,
  normalisePhoto,
  OTP_TTL_SECONDS,
  verifyOtp,
  assertPlausibleLocation,
  assertProvable,
} from './rules/proof.ts';
import type { DeliveryStatus } from './rules/delivery.ts';

export interface IssueCodeCommand {
  readonly jobId: string;
  readonly actorId: string | null;
}

export interface IssuedCode {
  readonly jobId: string;
  readonly status: 'PENDING';
  readonly expiresAt: string;
  readonly attemptsRemaining: number;
  /** Plaintext, returned once and never stored. See the ponytail above. */
  readonly code: string;
}

export interface SubmitProofCommand {
  readonly jobId: string;
  readonly code: string;
  readonly photoBase64: string;
  readonly photoContentType: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly idempotencyKey: string;
  readonly actorId: string | null;
}

export interface SubmittedProof {
  readonly jobId: string;
  readonly proofId: string;
  readonly status: 'VERIFIED';
  readonly photoSha256: string;
  readonly photoByteLength: number;
  readonly otpVerifiedAt: string;
}

@Injectable()
export class DeliveryProofService {
  constructor(
    @InjectDataSource('delivery') private readonly deliveryDataSource: DataSource,
    @Inject(DeliveryRepository) private readonly jobs: DeliveryRepository,
  ) {}

  /**
   * Mint (or replace) the challenge for a job.
   *
   * No idempotency key: issuing twice is not a duplicate effect, it is a reissue, and that is a
   * thing a rider at a door genuinely needs to be able to do. Each reissue replaces `code_hash`, so
   * the previous code stops being valid the instant the new one is written.
   */
  async issueCode(command: IssueCodeCommand): Promise<IssuedCode> {
    return this.deliveryDataSource.transaction(async (manager) => {
      const job = await this.jobs.findByIdForUpdate(manager, command.jobId);
      if (!job) throw new ResourceNotFoundError('Delivery job not found.');
      assertProvable(job.status as DeliveryStatus);

      const existing = await this.jobs.findProofForUpdate(manager, job.id);
      if (existing?.status === 'VERIFIED') {
        // Already proved. Re-issuing would either overwrite immutable history or hand out a code
        // for a delivery that is already a fact.
        throw new ProofNotAvailableError('This delivery has already been proved.');
      }

      const code = generateOtp();
      const salt = randomBytes(16).toString('hex');
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + OTP_TTL_SECONDS * 1000);

      const challenge = {
        id: existing?.id ?? randomUUID(),
        jobId: job.id,
        codeHash: hashOtp(code, salt),
        codeSalt: salt,
        codeIssuedAt: issuedAt,
        codeExpiresAt: expiresAt,
        attemptsUsed: 0,
        status: 'PENDING' as const,
        otpVerifiedAt: null,
        photoSha256: null,
        photoContentType: null,
        photoByteLength: null,
        photoData: null,
        latitude: null,
        longitude: null,
        actorId: command.actorId,
        createdAt: existing?.createdAt ?? issuedAt,
      };
      await this.jobs.insertProof(manager, challenge as never);

      return {
        jobId: job.id,
        status: 'PENDING' as const,
        expiresAt: expiresAt.toISOString(),
        attemptsRemaining: MAX_OTP_ATTEMPTS,
        code,
      };
    });
  }

  async submit(command: SubmitProofCommand): Promise<{
    result: SubmittedProof;
    replayed: boolean;
  }> {
    // The photo is deliberately absent from the request hash: hashing two megabytes to detect a
    // reused key costs more than it buys, and the code plus the coordinates are what make a
    // redemption a distinct act.
    const requestHash = hashRequest({
      jobId: command.jobId,
      code: command.code,
      latitude: command.latitude,
      longitude: command.longitude,
    });

    const outcome = await this.deliveryDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'delivery.proof', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return {
          result: claimed.decision.responseBody as SubmittedProof,
          replayed: true,
        };
      }

      const job = await this.jobs.findByIdForUpdate(manager, command.jobId);
      if (!job) throw new ResourceNotFoundError('Delivery job not found.');

      const proof = await this.jobs.findProofForUpdate(manager, job.id);
      if (!proof) throw new ProofCodeNotIssuedError();

      // A lost response is the common case here: the rider submits, the connection dies, the queue
      // replays. Without this the replay would read as a fresh redemption of a spent code.
      if (proof.status === 'VERIFIED') {
        const result = toResult(proof);
        await claimed.complete(200, result);
        return { result, replayed: true };
      }

      // Code first, photo second. Every failure below this line leaves the challenge intact and
      // spendable, which is what lets a customer re-read the code instead of re-photographing.
      try {
        verifyOtp(
          {
            codeHash: proof.codeHash,
            salt: proof.codeSalt,
            issuedAt: proof.codeIssuedAt,
            attemptsUsed: proof.attemptsUsed,
          },
          command.code,
        );
      } catch (error) {
        // The budget is the whole point, so a wrong guess has to survive the request that made it.
        // Throwing here would roll the increment back with everything else and hand out free guesses;
        // the error is therefore re-raised *after* this transaction commits.
        proof.attemptsUsed = Math.min(proof.attemptsUsed + 1, MAX_OTP_ATTEMPTS);
        await this.jobs.insertProof(manager, proof as never);
        // …and the key goes with it. This request applied nothing, so a reservation left behind
        // would answer the rider's next attempt with DUPLICATE_REQUEST instead of the wrong-code
        // error they need to see. Re-sending the same key must mean "that guess again", not
        // "that already happened".
        await release(manager, {
          scope: 'delivery.proof',
          merchantId: null,
          key: command.idempotencyKey,
        });
        return { failure: error };
      }

      const bytes = Buffer.from(command.photoBase64, 'base64');
      const photo = normalisePhoto({
        base64: command.photoBase64,
        contentType: command.photoContentType,
        // Measured, not declared: a caller that under-reports the size must not be able to smuggle
        // a 40 MB "photo" past the cap the CHECK constraint enforces on the stored length.
        bytes: bytes.length,
      });
      assertPlausibleLocation(command.latitude, command.longitude);

      const now = new Date();
      proof.status = 'VERIFIED';
      proof.otpVerifiedAt = now;
      proof.attemptsUsed = Math.min(proof.attemptsUsed + 1, MAX_OTP_ATTEMPTS);
      proof.photoSha256 = photo.sha256;
      proof.photoContentType = photo.contentType;
      proof.photoByteLength = photo.byteLength;
      proof.photoData = bytes;
      proof.latitude = command.latitude;
      proof.longitude = command.longitude;
      proof.actorId = command.actorId;
      await this.jobs.insertProof(manager, proof as never);

      // A merchant's dispute is answered from this row, so the event that says "there is now
      // evidence" has to commit with it — never after it.
      await appendOutbox(manager, {
        type: 'DeliveryProofCaptured',
        aggregateType: 'delivery',
        aggregateId: job.id,
        payload: {
          shipmentId: job.shipmentId,
          riderId: job.riderId,
          proofId: proof.id,
          photoSha256: photo.sha256,
          latitude: command.latitude,
          longitude: command.longitude,
        },
      });

      const result = toResult(proof);
      await claimed.complete(200, result);
      return { result, replayed: false };
    });

    if ('failure' in outcome) {
      throw outcome.failure;
    }
    return outcome;
  }
}

function toResult(proof: {
  id: string;
  jobId: string;
  photoSha256: string | null;
  photoByteLength: number | null;
  otpVerifiedAt: Date | null;
}): SubmittedProof {
  return {
    jobId: proof.jobId,
    proofId: proof.id,
    status: 'VERIFIED',
    photoSha256: proof.photoSha256 ?? '',
    photoByteLength: proof.photoByteLength ?? 0,
    otpVerifiedAt: proof.otpVerifiedAt!.toISOString(),
  };
}
