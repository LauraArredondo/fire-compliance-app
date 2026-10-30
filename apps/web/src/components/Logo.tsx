export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid h-7 w-7 place-items-center rounded-md bg-red-700 text-white">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.4 1 2.5 2.3 2.5 1.6 0 2.4-1.4 2.2-3.2C17.4 10.5 19 13 19 15.5 19 19.1 15.9 22 12 22s-7-2.9-7-6.5C5 10 12 7.5 12 2z" /></svg>
      </span>
      FireComply
    </span>
  );
}
