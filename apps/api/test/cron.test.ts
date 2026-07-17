import { describe, expect, it } from 'vitest';
import { isValidCronExpression, matchesCron, minuteBucketKey } from '../src/scheduling/cron.js';

describe('isValidCronExpression', () => {
  it('accepts a bare 5-field wildcard expression', () => {
    expect(isValidCronExpression('* * * * *')).toBe(true);
  });

  it('accepts exact values, comma lists, ranges, and step values', () => {
    expect(isValidCronExpression('0 9 * * *')).toBe(true);
    expect(isValidCronExpression('0,30 9 * * *')).toBe(true);
    expect(isValidCronExpression('0 9-17 * * *')).toBe(true);
    expect(isValidCronExpression('*/5 * * * *')).toBe(true);
    expect(isValidCronExpression('0 0 * * 1')).toBe(true); // every Monday at midnight
  });

  it('rejects the wrong number of fields', () => {
    expect(isValidCronExpression('* * * *')).toBe(false);
    expect(isValidCronExpression('* * * * * *')).toBe(false);
  });

  it('rejects an out-of-range value', () => {
    expect(isValidCronExpression('60 * * * *')).toBe(false); // minute max is 59
    expect(isValidCronExpression('* 24 * * *')).toBe(false); // hour max is 23
  });

  it('rejects garbage', () => {
    expect(isValidCronExpression('not a cron expression')).toBe(false);
    expect(isValidCronExpression('')).toBe(false);
  });
});

describe('matchesCron', () => {
  it('matches every minute on "* * * * *"', () => {
    expect(matchesCron('* * * * *', new Date('2026-07-16T03:27:00Z'))).toBe(true);
  });

  it('matches only the configured minute/hour', () => {
    const cron = '30 9 * * *';
    expect(matchesCron(cron, new Date('2026-07-16T09:30:00Z'))).toBe(true);
    expect(matchesCron(cron, new Date('2026-07-16T09:31:00Z'))).toBe(false);
    expect(matchesCron(cron, new Date('2026-07-16T10:30:00Z'))).toBe(false);
  });

  it('matches a step expression on every 5th minute only', () => {
    const cron = '*/5 * * * *';
    expect(matchesCron(cron, new Date('2026-07-16T03:25:00Z'))).toBe(true);
    expect(matchesCron(cron, new Date('2026-07-16T03:26:00Z'))).toBe(false);
  });

  it('ORs day-of-month and day-of-week when both are restricted', () => {
    // 2026-07-16 is a Thursday (day-of-week 4); "1" means the 1st of the month.
    const cron = '0 0 1 * 1'; // 1st of the month OR every Monday
    expect(matchesCron(cron, new Date('2026-07-01T00:00:00Z'))).toBe(true); // the 1st
    expect(matchesCron(cron, new Date('2026-07-20T00:00:00Z'))).toBe(true); // a Monday
    expect(matchesCron(cron, new Date('2026-07-16T00:00:00Z'))).toBe(false); // neither
  });

  it('returns false for an invalid expression instead of throwing', () => {
    expect(matchesCron('garbage', new Date())).toBe(false);
  });
});

describe('minuteBucketKey', () => {
  it('is stable within the same minute and differs across minutes', () => {
    const a = minuteBucketKey(new Date('2026-07-16T03:27:00.000Z'));
    const b = minuteBucketKey(new Date('2026-07-16T03:27:59.999Z'));
    const c = minuteBucketKey(new Date('2026-07-16T03:28:00.000Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
