import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionStatusIndicator } from '../src/components/ConnectionStatusIndicator.js';

describe('ConnectionStatusIndicator', () => {
  it.each([
    ['connecting', 'Connecting…'],
    ['open', '● Live'],
    ['reconnecting', 'Reconnecting…'],
    ['closed', 'Finished'],
    ['error', "Couldn't load this run."],
  ] as const)('shows "%s" as "%s"', (status, label) => {
    render(<ConnectionStatusIndicator status={status} />);
    const el = screen.getByTestId('connection-status');
    expect(el).toHaveTextContent(label);
    expect(el).toHaveAttribute('data-status', status);
  });

  it('announces connection transitions via aria-live (§12)', () => {
    render(<ConnectionStatusIndicator status="connecting" />);
    expect(screen.getByTestId('connection-status')).toHaveAttribute('aria-live', 'polite');
  });
});
