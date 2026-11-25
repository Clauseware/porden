import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-6 text-primary', className)}
      fill="currentColor"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 30V20A10 10 0 0 1 12 10H14V20H10V30Z" />
      <path d="M14 2H20A10 10 0 0 1 30 12A10 10 0 0 1 20 22H14V17H20V10H14Z" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="font-heading text-xl font-bold tracking-tight">porden</span>
    </span>
  );
}
