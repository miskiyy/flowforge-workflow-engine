import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DagEditor } from '../src/components/DagEditor.js';

describe('DagEditor', () => {
  it('renders the given value in the textarea', () => {
    render(<DagEditor value={'{\n  "steps": []\n}'} onChange={() => {}} />);
    expect(screen.getByTestId('dag-editor-textarea')).toHaveValue('{\n  "steps": []\n}');
  });

  it('never suppresses the focus outline — keyboard users need a visible focus ring (§12 focus-visible audit)', () => {
    render(<DagEditor value="{}" onChange={() => {}} />);
    expect(screen.getByTestId('dag-editor-textarea').style.outline).not.toBe('none');
  });

  it('shows a syntax error on blur for malformed JSON', () => {
    render(<DagEditor value="{ not json" onChange={() => {}} />);
    fireEvent.blur(screen.getByTestId('dag-editor-textarea'));
    expect(screen.getByTestId('dag-editor-syntax-error')).toBeInTheDocument();
  });

  it('clears the syntax error on blur once the JSON is valid again', () => {
    const { rerender } = render(<DagEditor value="{ not json" onChange={() => {}} />);
    fireEvent.blur(screen.getByTestId('dag-editor-textarea'));
    expect(screen.getByTestId('dag-editor-syntax-error')).toBeInTheDocument();

    rerender(<DagEditor value="{}" onChange={() => {}} />);
    fireEvent.blur(screen.getByTestId('dag-editor-textarea'));
    expect(screen.queryByTestId('dag-editor-syntax-error')).not.toBeInTheDocument();
  });
});
