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
  /** SMS rail: mock sends nothing; mimsms talks to the fake or the gateway. */
  readonly smsProvider: 'mock' | 'mimsms';
  readonly mimsmsUrl: string;
  readonly mimsmsApiKey: string;
  readonly mimsmsUserName: string;
  readonly mimsmsSenderName: string;
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
  const smsProvider = process.env.SMS_PROVIDER ?? 'mock';
  if (smsProvider !== 'mock' && smsProvider !== 'mimsms') {
    throw new Error(
      `Environment variable SMS_PROVIDER must be "mock" or "mimsms", received "${smsProvider}".`,
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
    smsProvider,
    mimsmsUrl: process.env.MIMSMS_URL ?? 'http://localhost:4010',
    mimsmsApiKey: process.env.MIMSMS_API_KEY ?? 'J6J68SNLDYG1SVS',
    mimsmsUserName: process.env.MIMSMS_USERNAME ?? 'demo@mimsms.com',
    mimsmsSenderName: process.env.MIMSMS_SENDER ?? '8809612444598',
  });
  return cached;
}
