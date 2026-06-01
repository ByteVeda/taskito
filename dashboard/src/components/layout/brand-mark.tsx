/**
 * The taskito mark — a rounded "task token" with two dot eyes and a
 * check-smile, filled with the live accent. Colors come from CSS vars so it
 * tracks the active theme/accent automatically.
 */
export function BrandMark({ size = 38, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <title>taskito</title>
      <rect x="3" y="3" width="34" height="34" rx="11" fill="var(--accent)" />
      <rect x="3" y="3" width="34" height="34" rx="11" fill="url(#tk-g)" fillOpacity="0.18" />
      <defs>
        <linearGradient id="tk-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="15" cy="16" r="2.1" fill="var(--accent-fg)" />
      <circle cx="25" cy="16" r="2.1" fill="var(--accent-fg)" />
      <path
        d="M14 24.5l3.4 3.4L27 19"
        stroke="var(--accent-fg)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
