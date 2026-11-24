'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Fades its children up when they first scroll into view (sx-rise in globals.css). */
export function Reveal({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          element.setAttribute('data-inview', '');
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <section className={`sx scroll-mt-24 ${className ?? ''}`} id={id} ref={ref}>
      {children}
    </section>
  );
}
