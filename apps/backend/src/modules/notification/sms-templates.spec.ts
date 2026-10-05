import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { renderTemplate, SMS_TEMPLATES } from './sms-templates.ts';

describe('sms templates', () => {
  test('every parcel event has en + bn at version 1', () => {
    for (const name of ['shipment.created', 'shipment.out_for_delivery', 'shipment.delivered']) {
      const versions = SMS_TEMPLATES.filter((t) => t.name === name);
      assert.deepEqual(versions.map((t) => t.locale).sort(), ['bn', 'en']);
      assert.ok(versions.every((t) => t.version === 1));
    }
  });

  test('rendering substitutes known vars and leaves unknown ones visible', () => {
    assert.equal(
      renderTemplate('Parcel {trackingCode} out.', { trackingCode: 'ZP-1' }),
      'Parcel ZP-1 out.',
    );
    assert.equal(renderTemplate('Pay {amount}.', {}), 'Pay {amount}.');
  });

  test('no template exceeds one SMS segment in English', () => {
    for (const template of SMS_TEMPLATES.filter((t) => t.locale === 'en')) {
      const rendered = renderTemplate(template.body, {
        trackingCode: 'ZP-8F32A1',
        amount: '৳1,250',
      });
      assert.ok(
        rendered.length <= 160,
        `${template.name} renders to ${rendered.length} chars — over one segment`,
      );
    }
  });
});
