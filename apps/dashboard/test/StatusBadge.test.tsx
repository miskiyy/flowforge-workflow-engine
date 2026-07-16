import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '../src/components/StatusBadge.js';

describe('StatusBadge', () => {
  it.each([
    ['pending', 'Pending'],
    ['running', 'Running'],
    ['succeeded', 'Succeeded'],
    ['failed', 'Failed'],
    ['skipped', 'Skipped'],
  ] as const)('labels %s as %s', (status, label) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-status', status);
  });
});
