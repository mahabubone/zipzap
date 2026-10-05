/**
 * SMS_CHANNEL — the SMS port. Mock by default, MiMSMS when configured.
 *
 * Environments differ in exactly one variable: SMS_PROVIDER=mock sends nothing;
 * SMS_PROVIDER=mimsms talks to MIMSMS_URL (the fake locally, the gateway in
 * staging). Services inject the symbol, never a class.
 */

import { config } from '../../../config.ts';
import { MiMSMSAdapter, type SmsChannel } from './mimsms.adapter.ts';
import { MockSmsChannel } from './mock-sms.channel.ts';

export const SMS_CHANNEL = Symbol('SMS_CHANNEL');

/** Selected by SMS_PROVIDER. Mock default: no SMS leaves the process. */
export function defaultSmsChannel(): SmsChannel {
  const { smsProvider, mimsmsUrl, mimsmsApiKey, mimsmsUserName, mimsmsSenderName } = config();
  if (smsProvider === 'mimsms') {
    return new MiMSMSAdapter({
      baseUrl: mimsmsUrl,
      apiKey: mimsmsApiKey,
      userName: mimsmsUserName,
      senderName: mimsmsSenderName,
    });
  }
  return new MockSmsChannel();
}
