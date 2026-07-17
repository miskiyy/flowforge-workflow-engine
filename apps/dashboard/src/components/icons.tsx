import type { SVGProps } from 'react';

/**
 * Hand-authored line icons — 20px grid, 1.75 stroke, round caps. No icon
 * library: this is the same "extend tokens.css, don't add a dependency"
 * philosophy the rest of the app follows. Every icon is `aria-hidden`; it
 * always sits next to visible text that carries the accessible name.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

export function IconHome(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 9.5 10 3l7 6.5" />
      <path d="M5 8.5V17h10V8.5" />
      <path d="M8 17v-5h4v5" />
    </svg>
  );
}

export function IconWorkflow(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="4.5" cy="5" r="2" />
      <circle cx="4.5" cy="15" r="2" />
      <circle cx="15.5" cy="10" r="2" />
      <path d="M6.3 5.8 13.8 9" />
      <path d="M6.3 14.2 13.8 11" />
    </svg>
  );
}

export function IconRuns(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M8.3 7 13 10l-4.7 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconHealth(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 10.5h3.2l1.6-3.8 2.6 6.6 1.6-4.2 1.2 1.4h4.8" />
    </svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.5c.4 2.8 1 4.3 2.1 5.4 1.1 1.1 2.6 1.7 5.4 2.1-2.8.4-4.3 1-5.4 2.1-1.1 1.1-1.7 2.6-2.1 5.4-.4-2.8-1-4.3-2.1-5.4C6.8 11 5.3 10.4 2.5 10c2.8-.4 4.3-1 5.4-2.1C9 6.8 9.6 5.3 10 2.5Z" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3" />
      <path d="M13 13.5 17 10l-4-3.5" />
      <path d="M17 10H8" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10h12" />
      <path d="M11.5 5.5 16 10l-4.5 4.5" />
    </svg>
  );
}

export function IconInbox(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 11.5 5.5 4h9l2.5 7.5" />
      <path d="M3 11.5V15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5h-4.2l-.9 2h-3.8l-.9-2H3Z" />
    </svg>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3.5 17.5 16h-15L10 3.5Z" />
      <path d="M10 8.2v3.3" />
      <circle cx="10" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12.5 3.5 16.5 7.5 7 17H3v-4L12.5 3.5Z" />
      <path d="M10.7 5.3 14.7 9.3" />
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 10.5 8 14l7.5-8.5" />
    </svg>
  );
}
