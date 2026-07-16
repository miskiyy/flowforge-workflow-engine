import type { ComponentType, SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowRight } from './icons.js';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * One primary next-action on the overview: title, one-line, and a CTA
 * (frontend-ux-revision.md §6). `primary` accents the featured action (AI) —
 * larger icon well, tinted fill, and a "Recommended" chip, so the headline
 * capability reads as the obvious first move rather than one of three equals.
 */
export function ActionCard({
  title,
  description,
  to,
  cta,
  icon: Icon,
  primary = false,
}: {
  title: string;
  description: string;
  to: string;
  cta: string;
  icon: Icon;
  primary?: boolean;
}) {
  return (
    <div
      className={`card action-card${primary ? ' action-card-featured' : ''}`}
      style={{
        padding: primary ? 'var(--space-6)' : 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <span className={`icon-well${primary ? ' icon-well-accent' : ''}`}>
          <Icon width={primary ? 20 : 18} height={primary ? 20 : 18} />
        </span>
        {primary ? <span className="chip chip-accent" style={{ marginTop: 2 }}>Recommended</span> : null}
      </div>
      <p style={{ fontWeight: 600, fontSize: primary ? 'var(--text-lg)' : 'var(--text-base)', margin: 0 }}>{title}</p>
      <p
        style={{
          color: 'var(--ink-mut)',
          fontSize: 'var(--text-sm)',
          margin: 'var(--space-2) 0 var(--space-4)',
          lineHeight: 1.5,
          flexGrow: 1,
        }}
      >
        {description}
      </p>
      <Link to={to} style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={primary ? 'btn-primary' : undefined}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {cta}
            <IconArrowRight width={15} height={15} />
          </span>
        </button>
      </Link>
    </div>
  );
}
