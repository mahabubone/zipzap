/**
 * Environment configuration. Read once, validated once, at startup.
 *
 * Values arrive via `--env-file-if-exists=../../.env` (see package.json), so there is
 * no dotenv dependency and nothing to initialise.
 */

export interface Config {
  readonly nodeEnv: string;
  readonly isProduction: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly natsUrl: string;
  readonly natsStream: string;
  /** Payout rail: mock moves no money; paystation talks to the gateway or the fake. */
  readonly paymentProvider: 'mock' | 'paystation';
  readonly paystationUrl: string;
  readonly paystationMerchantId: string;
  readonly paystationPassword: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received "${raw}".`);
  }
  return parsed;
}

let cached: Config | undefined;

export function config(): Config {
  if (cached) return cached;
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const paymentProvider = process.env.PAYMENT_PROVIDER ?? 'mock';
  if (paymentProvider !== 'mock' && paymentProvider !== 'paystation') {
    throw new Error(
      `Environment variable PAYMENT_PROVIDER must be "mock" or "paystation", received "${paymentProvider}".`,
    );
  }
  cached = Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: integer('PORT', 3000),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
    natsStream: process.env.NATS_STREAM ?? 'ZIPZAP',
    paymentProvider,
    paystationUrl: process.env.PAYSTATION_URL ?? 'http://localhost:4010',
    paystationMerchantId: process.env.PAYSTATION_MERCHANT_ID ?? '104-1653730183',
    paystationPassword: process.env.PAYSTATION_PASSWORD ?? 'gamecoderstorepass',
  });
  return cached;
}
