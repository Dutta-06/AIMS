/** An envelope whose flap is a signal wave. */
export default function BrandGlyph({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3.5 8.5c2.8 0 2.8 4 5.7 4s2.8-4 5.6-4 2.9 4 5.7 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
