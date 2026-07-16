import { describe, expect, it } from 'vitest';
import { classifySeq } from '../src/realtime/useRunStream.js';

describe('classifySeq', () => {
  it('accepts the first event after a snapshot regardless of its seq (no baseline yet)', () => {
    expect(classifySeq(null, 1)).toBe('accept');
    expect(classifySeq(null, 47)).toBe('accept');
  });

  it('accepts the immediate next seq', () => {
    expect(classifySeq(5, 6)).toBe('accept');
  });

  it('treats a seq equal to or behind the last one as a duplicate', () => {
    expect(classifySeq(5, 5)).toBe('duplicate');
    expect(classifySeq(5, 4)).toBe('duplicate');
    expect(classifySeq(5, 1)).toBe('duplicate');
  });

  it('treats a seq more than one ahead as a gap', () => {
    expect(classifySeq(5, 7)).toBe('gap');
    expect(classifySeq(5, 100)).toBe('gap');
  });
});
