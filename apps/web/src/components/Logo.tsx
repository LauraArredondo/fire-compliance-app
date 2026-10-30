/**
 * FireGrid lockup. The SVG wordmark is theme-specific (ink on light, paper on dark).
 * The artwork has generous padding, so the displayed height is larger than the visual mark.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      <img src="/brand/firegrid-lockup-light.svg" alt="FireGrid" className="h-14 w-auto dark:hidden" />
      <img src="/brand/firegrid-lockup-dark.svg" alt="" className="hidden h-14 w-auto dark:block" />
    </span>
  );
}
