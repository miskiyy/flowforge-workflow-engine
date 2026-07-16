import { Link } from 'react-router-dom';

/**
 * One primary next-action on the overview: title, one-line, and a CTA
 * (frontend-ux-revision.md §6). `primary` accents the featured action (AI).
 */
export function ActionCard({
  title,
  description,
  to,
  cta,
  primary = false,
}: {
  title: string;
  description: string;
  to: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <div
      className="card action-card"
      style={{
        ...(primary ? { borderColor: 'var(--accent)', borderWidth: 2 } : {}),
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <p style={{ fontWeight: 600, margin: 0 }}>{title}</p>
      <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)', margin: 'var(--space-2) 0 var(--space-4)', lineHeight: 1.5 }}>
        {description}
      </p>
      <Link to={to} style={{ marginTop: 'auto' }}>
        <button type="button" className={primary ? 'btn-primary' : undefined}>
          {cta}
        </button>
      </Link>
    </div>
  );
}
