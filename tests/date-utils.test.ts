import assert from 'node:assert/strict';
import test from 'node:test';
import { addCalendarMonthsDateOnly, vietnamBusinessDayCode } from '../src/utils/dateUtils';
import { formatVietnamDate, formatVietnamDateTime, vietnamDateKey, vietnamToday } from '../src/utils/vietnamDate';

test('calendar month addition clamps the last day without 30-day approximations', () => {
  assert.equal(addCalendarMonthsDateOnly('2025-01-31', 1), '2025-02-28');
  assert.equal(addCalendarMonthsDateOnly('2024-01-31', 1), '2024-02-29');
  assert.equal(addCalendarMonthsDateOnly('2025-01-31', 3), '2025-04-30');
});

test('calendar month addition preserves ordinary date-only values', () => {
  assert.equal(addCalendarMonthsDateOnly('2025-03-15', 6), '2025-09-15');
  assert.equal(addCalendarMonthsDateOnly('not-a-date', 1), '');
});

test('Aura business weekday is stable for date-only values in every device timezone', () => {
  assert.equal(vietnamBusinessDayCode('2026-09-07'), 'T2');
  assert.equal(vietnamBusinessDayCode('2026-09-06'), 'CN');
  assert.equal(vietnamBusinessDayCode('2026-09-07T00:00:00+07:00'), 'T2');
  assert.equal(vietnamBusinessDayCode('2026-02-30'), '');
});

test('business dates change at Vietnam midnight, including month/year and leap-day boundaries', () => {
  for (const [instant, expected] of [
    ['2026-10-31T16:59:59.999Z', '2026-10-31'],
    ['2026-10-31T17:00:00.000Z', '2026-11-01'],
    ['2026-10-31T23:59:59.999Z', '2026-11-01'],
    ['2026-11-01T00:00:00.000Z', '2026-11-01'],
    ['2026-12-31T17:00:00.000Z', '2027-01-01'],
    ['2024-02-28T17:00:00.000Z', '2024-02-29'],
    ['2024-02-29T17:00:00.000Z', '2024-03-01'],
  ]) {
    assert.equal(vietnamDateKey(instant), expected);
    assert.equal(vietnamDateKey(new Date(instant)), expected);
    assert.equal(vietnamDateKey(Date.parse(instant)), expected);
  }
});

test('today uses the Vietnam date even while UTC is still in the preceding year', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-31T18:00:00Z') });
  assert.equal(vietnamToday(), '2027-01-01');
});

test('display preserves calendar dates and converts timestamps before formatting', () => {
  assert.equal(vietnamDateKey('2026-11-01'), '2026-11-01');
  assert.equal(formatVietnamDate('2026-11-01'), '01/11/2026');
  assert.equal(formatVietnamDate('2026-10-31T18:00:00Z'), '01/11/2026');
  assert.equal(formatVietnamDate('2026-10-31T11:00:00-07:00'), '01/11/2026');
  assert.match(formatVietnamDateTime('2026-10-31T18:00:00Z'), /1:00:00.*1\/11\/2026/);
  assert.equal(vietnamDateKey(0), '1970-01-01');
});

test('missing and invalid dates remain empty instead of becoming a different business day', () => {
  for (const value of ['', null, undefined, 'invalid', '2026-02-30', '2026-13-01', new Date(NaN), NaN]) {
    assert.equal(vietnamDateKey(value), '');
    assert.equal(formatVietnamDate(value), '');
    assert.equal(formatVietnamDateTime(value), '');
  }
});
