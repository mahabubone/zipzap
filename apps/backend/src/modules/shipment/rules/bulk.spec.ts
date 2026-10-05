import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { chunkRows, mapHeader, parseCsv, previewImport, validateRow } from './bulk.ts';

describe('parseCsv', () => {
  test('parses quoted fields, escaped quotes, and CRLF', () => {
    const rows = parseCsv('a,"b, c","d""e"\r\n1,2,3\r\n');
    assert.deepEqual(rows, [
      ['a', 'b, c', 'd"e'],
      ['1', '2', '3'],
    ]);
  });

  test('throws on unbalanced quotes — a half-upload is not half-parsed', () => {
    assert.throws(() => parseCsv('a,"b,c\n1,2,3'), /Unbalanced quote/);
  });

  test('an empty file parses to no rows', () => {
    assert.deepEqual(parseCsv(''), []);
    assert.deepEqual(parseCsv('\n'), []);
  });
});

describe('mapHeader', () => {
  test('maps known columns, ignores unknown ones, reports missing required', () => {
    const { index, missing } = mapHeader(['invoice', 'extra', 'recipient_name']);
    assert.equal(index.invoice, 0);
    assert.equal(index.extra, undefined);
    assert.deepEqual(missing, ['recipient_phone', 'recipient_address']);
  });

  test('case-insensitive, first occurrence wins', () => {
    const { index, missing } = mapHeader([
      'Invoice',
      'invoice',
      'recipient_name',
      'recipient_phone',
      'recipient_address',
    ]);
    assert.equal(index.invoice, 0);
    assert.deepEqual(missing, []);
  });
});

describe('validateRow', () => {
  const valid = {
    invoice: 'ABC-001',
    recipient_name: 'Rana',
    recipient_phone: '+8801712345678',
    recipient_address: 'Dhaka',
    parcel_weight: '1200',
    cod_amount: '125000',
  };

  test('accepts a complete valid row', () => {
    assert.deepEqual(validateRow(valid), { kind: 'READY' });
  });

  test('rejects missing invoice, bad phone, non-integer weight and decimal COD', () => {
    assert.deepEqual(validateRow({ ...valid, invoice: '' }).kind, 'FAILED');
    assert.deepEqual(validateRow({ ...valid, recipient_phone: '8801712345678' }).kind, 'FAILED');
    assert.deepEqual(validateRow({ ...valid, recipient_phone: '+15551234567' }).kind, 'FAILED');
    assert.deepEqual(validateRow({ ...valid, parcel_weight: '1.2' }).kind, 'FAILED');
    assert.deepEqual(validateRow({ ...valid, cod_amount: '1250.50' }).kind, 'FAILED');
  });
});

describe('previewImport', () => {
  test('validates every row and reports per-row outcomes', () => {
    const { rows, headerError } = previewImport(
      'invoice,recipient_name,recipient_phone,recipient_address,parcel_weight,cod_amount\n' +
        'ABC-001,Rana,+8801712345678,Dhaka,1200,125000\n' +
        'ABC-002,Karim,bad-phone,CTG,500,\n',
    );
    assert.equal(headerError, null);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0]!.outcome, { kind: 'READY' });
    assert.equal(rows[1]!.outcome.kind, 'FAILED');
  });

  test('a missing required column fails the whole file, not row by row', () => {
    const { rows, headerError } = previewImport('invoice,recipient_name\nABC-001,Rana\n');
    assert.match(headerError ?? '', /Missing required columns/);
    assert.deepEqual(rows, []);
  });
});

describe('chunkRows', () => {
  test('splits into hundreds — one transaction per chunk, never one for 10,000', () => {
    const chunks = chunkRows(Array.from({ length: 250 }, (_, i) => i));
    assert.deepEqual(
      chunks.map((c) => c.length),
      [100, 100, 50],
    );
  });
});
