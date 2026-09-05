import assert from 'node:assert/strict';
import test from 'node:test';
import { addCalendarMonthsDateOnly, vietnamBusinessDayCode } from '../src/utils/dateUtils';

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
