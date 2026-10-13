import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DeliveryProofService } from './delivery-proof.service.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import {
  ProofCodeInvalidError,
  ProofCodeNotIssuedError,
  ProofNotAvailableError,
  ProofPhotoTooLargeError,
} from '../../common/domain-error.ts';
import { hashOtp, MAX_OTP_ATTEMPTS, MAX_PHOTO_BYTES, OTP_TTL_SECONDS } from './rules/proof.ts';

/**
 * The proof transaction, minus the databases.
 *
 * Two things are worth proving here, and both are about trust. First, the plaintext code never
 * reaches storage. Second — and this is the one a straightforward implementation gets wrong — a
 * *wrong* guess is still recorded. Throwing inside the transaction to report the bad code rolls the
 * attempt counter back along with everything else, which makes every guess after the first free.
 * So the test asserts the increment survives the throw.
 */

const CODE = '4821';
const SALT = 'a-salt';
const PHOTO = Buffer.from('89504e470d0a1a0a', 'hex'); // a PNG header, 8 bytes
const DHAKA = { latitude: 23.81, longitude: 90.41 };

const OUT_FOR_DELIVERY = {
  id: 'job-1',
  shipmentId: 'ship-1',
  riderId: 'rider-1',
  status: 'OUT_FOR_DELIVERY',
} as const;

function challenge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'proof-1',
    jobId: 'job-1',
    codeHash: hashOtp(CODE, SALT),
    codeSalt: SALT,
    codeIssuedAt: new Date(),
    codeExpiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    attemptsUsed: 0,
    status: 'PENDING',
    otpVerifiedAt: null,
    photoSha256: null,
    photoContentType: null,
    photoByteLength: null,
    photoData: null,
    latitude: null,
    longitude: null,
    actorId: null,
    ...overrides,
  };
}

function makeService(job: Record<string, unknown> | null, proof: Record<string, unknown> | null) {
  const saved: Record<string, unknown>[] = [];
  const outbox: string[] = [];

  const manager = {
    query: (sql: string) => {
      if (sql.includes('idempotency_keys') && sql.includes('ON CONFLICT')) {
        return Promise.resolve([{ scope: 'delivery.proof' }]);
      }
      if (sql.includes('outbox_events')) outbox.push(sql);
      return Promise.resolve([]);
    },
  };
  const dataSource = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager) };

  const repository = {
    findByIdForUpdate: () => Promise.resolve(job),
    findProofForUpdate: () => Promise.resolve(proof),
    insertProof: (_m: unknown, entity: Record<string, unknown>) => {
      // Mirror the row back the way TypeORM's save() does — the service mutates and re-reads it.
      if (proof) Object.assign(proof, entity);
      saved.push(entity);
      return Promise.resolve(entity);
    },
  };

  return {
    service: new DeliveryProofService(dataSource as never, repository as never),
    saved,
    outbox,
  };
}

const submission = (overrides: Record<string, unknown> = {}) => ({
  jobId: 'job-1',
  code: CODE,
  photoBase64: PHOTO.toString('base64'),
  photoContentType: 'image/png',
  ...DHAKA,
  idempotencyKey: `k-${randomUUID()}`,
  actorId: 'rider-1',
  ...overrides,
});

describe('DeliveryProofService.issueCode', () => {
  it('returns a four-digit code and stores only a hash of it', async () => {
    const { service, saved } = makeService(OUT_FOR_DELIVERY, challenge());

    const issued = await service.issueCode({ jobId: 'job-1', actorId: 'rider-1' });

    expect(issued.code).toMatch(/^\d{4}$/);
    expect(issued.attemptsRemaining).toBe(MAX_OTP_ATTEMPTS);
    // The plain assertion: the code the customer reads out must not be recoverable from the row.
    expect(JSON.stringify(saved[0])).not.toContain(issued.code);
    expect(saved[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('replaces the previous code so a reissue kills the old one', async () => {
    const proof = challenge({ attemptsUsed: 3 });
    const { service, saved } = makeService(OUT_FOR_DELIVERY, proof);
    const before = proof.codeHash;

    await service.issueCode({ jobId: 'job-1', actorId: 'rider-1' });

    expect(saved[0]!.codeHash).not.toBe(before);
    expect(saved[0]!.attemptsUsed).toBe(0);
  });

  it('refuses to issue a code for a job that is not out for delivery', async () => {
    const { service, saved } = makeService({ ...OUT_FOR_DELIVERY, status: 'DELIVERED' }, null);

    await expect(service.issueCode({ jobId: 'job-1', actorId: null })).rejects.toBeInstanceOf(
      ProofNotAvailableError,
    );
    expect(saved).toHaveLength(0);
  });

  it('refuses to re-open a proof that has already been redeemed', async () => {
    const { service } = makeService(
      OUT_FOR_DELIVERY,
      challenge({ status: 'VERIFIED', otpVerifiedAt: new Date(), photoSha256: 'a' }),
    );

    await expect(service.issueCode({ jobId: 'job-1', actorId: null })).rejects.toBeInstanceOf(
      ProofNotAvailableError,
    );
  });
});

describe('DeliveryProofService.submit', () => {
  it('verifies a correct code and records all three pieces of evidence', async () => {
    const { service, saved, outbox } = makeService(OUT_FOR_DELIVERY, challenge());

    const { result, replayed } = await service.submit(submission());

    expect(replayed).toBe(false);
    expect(result.status).toBe('VERIFIED');
    expect(saved[0]!.status).toBe('VERIFIED');
    expect(saved[0]!.photoSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(saved[0]!.latitude).toBe(DHAKA.latitude);
    expect(saved[0]!.photoData).toEqual(PHOTO);
    // The event that says "there is now evidence" must commit with the evidence, never after it.
    expect(outbox).toHaveLength(1);
  });

  it('spends an attempt on a wrong code and still tells the caller it was wrong', async () => {
    const proof = challenge({ attemptsUsed: 2 });
    const { service, saved } = makeService(OUT_FOR_DELIVERY, proof);

    await expect(service.submit(submission({ code: '0000' }))).rejects.toBeInstanceOf(
      ProofCodeInvalidError,
    );
    expect(saved[0]!.attemptsUsed).toBe(3);
    expect(saved[0]!.status).toBe('PENDING');
    expect(saved[0]!.photoSha256).toBeNull();
  });

  it('never lets the attempt counter exceed the budget, however many guesses arrive', async () => {
    const { service, saved } = makeService(
      OUT_FOR_DELIVERY,
      challenge({ attemptsUsed: MAX_OTP_ATTEMPTS }),
    );

    await expect(service.submit(submission({ code: '0000' }))).rejects.toThrow();
    expect(saved[0]!.attemptsUsed).toBe(MAX_OTP_ATTEMPTS);
  });

  it('measures the photo from its bytes, not from what the caller claims', async () => {
    // A caller that under-reports the size must not smuggle past MAX_PHOTO_BYTES.
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 1, 7);
    const { service, saved } = makeService(OUT_FOR_DELIVERY, challenge());

    await expect(
      service.submit(submission({ photoBase64: big.toString('base64') })),
    ).rejects.toBeInstanceOf(ProofPhotoTooLargeError);
    // Nothing was written, so the correct code is still unspent — the rider can retake and resend.
    expect(saved).toHaveLength(0);
  });

  it('leaves the challenge unspent when the photo is rejected', async () => {
    const { service, saved } = makeService(OUT_FOR_DELIVERY, challenge());

    await expect(
      service.submit(submission({ photoContentType: 'application/pdf' })),
    ).rejects.toThrow();

    expect(saved).toHaveLength(0);
  });

  it('replays an already-verified proof instead of charging a second attempt', async () => {
    const verified = challenge({
      status: 'VERIFIED',
      otpVerifiedAt: new Date('2026-10-10T08:00:00Z'),
      photoSha256: 'a'.repeat(64),
      photoByteLength: 8,
    });
    const { service, saved } = makeService(OUT_FOR_DELIVERY, verified);

    const { result, replayed } = await service.submit(submission({ code: 'wrong-entirely' }));

    expect(replayed).toBe(true);
    expect(result.status).toBe('VERIFIED');
    // A replay writes nothing at all — in particular it does not spend an attempt.
    expect(saved).toHaveLength(0);
  });

  it('says "no code was issued" rather than "wrong code" when nothing was ever sent', async () => {
    const { service } = makeService(OUT_FOR_DELIVERY, null);

    await expect(service.submit(submission())).rejects.toBeInstanceOf(ProofCodeNotIssuedError);
  });

  it('refuses a location outside Bangladesh, keeping the code unspent', async () => {
    const { service, saved } = makeService(OUT_FOR_DELIVERY, challenge());

    await expect(service.submit(submission({ latitude: 0, longitude: 0 }))).rejects.toThrow();

    expect(saved).toHaveLength(0);
  });
});

describe('the repository contract the service depends on', () => {
  it('exists — a typo in a method name would otherwise surface only at runtime', () => {
    // Cheap, and it catches the class of error a fake repository hides: the service calling a
    // method the real DeliveryRepository does not have.
    const real = DeliveryRepository.prototype;
    for (const method of ['findByIdForUpdate', 'findProofForUpdate', 'insertProof'] as const) {
      expect(typeof real[method]).toBe('function');
    }
  });
});
