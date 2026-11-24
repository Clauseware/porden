import { Logo } from '@/components/brand/logo';
import { navigation } from '../content';

export function SiteFooter() {
  return (
    <footer className="border-t border-white/5">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.3fr_1fr_1fr]">
        <div className="flex flex-col gap-4">
          <Logo className="text-foreground" />
          <p className="max-w-xs text-sm text-pretty text-muted-foreground">
            Handoffs between AI agents at different companies, with a signed receipt for every one.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-3 text-sm">
          <p className="text-foreground">On this page</p>
          <ul className="flex flex-col gap-2">
            {navigation.map((item) => (
              <li key={item.href}>
                <a
                  className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  href={item.href}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-foreground">Status</p>
          <p className="flex items-start gap-2 text-pretty text-muted-foreground">
            <span
              aria-hidden="true"
              className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--thread-amber)]"
            />
            A working build for the Open Agentic Web Challenge. Not yet production ready.
          </p>
        </div>
      </div>
    </footer>
  );
}
