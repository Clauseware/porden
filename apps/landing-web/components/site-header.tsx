'use client';

import { useEffect, useRef, useState } from 'react';
import PordenSymbol from '../../logo';
import { MenuCloseIcon, MenuOpenIcon } from './icons';
import { LANDING_LINKS } from './landing-links';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', open);
    if (!open) return;
    menuRef.current?.querySelector('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const wide = matchMedia('(min-width: 961px)');
    const onWide = () => setOpen(false);
    addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
      document.documentElement.classList.remove('menu-open');
    };
  }, [open]);

  return (
    <header className="top" id="top">
      <div className="wrap bar">
        <a className="brand" href="#main" aria-label="Porden home">
          <PordenSymbol />
          porden
        </a>
        <nav
          className={open ? 'nav open' : 'nav'}
          id="menu"
          aria-label="Main"
          ref={menuRef}
          onClick={(e) => {
            if (e.target instanceof Element && e.target.closest('a')) setOpen(false);
          }}
        >
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          {LANDING_LINKS.docs && <a href={LANDING_LINKS.docs}>Docs</a>}
          {LANDING_LINKS.signIn && (
            <a className="nav__signin" href={LANDING_LINKS.signIn}>
              Sign in
            </a>
          )}
          <ThemeToggle variant="menu" />
        </nav>
        <div className="bar__end">
          {LANDING_LINKS.signIn && (
            <a className="bar__signin" href={LANDING_LINKS.signIn}>
              Sign in
            </a>
          )}
          <ThemeToggle variant="bar" />
          <a className="btn btn--primary btn--sm" href={LANDING_LINKS.getStarted}>
            Get started
          </a>
          <button
            className="menu-btn"
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls="menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(!open)}
          >
            <MenuOpenIcon />
            <MenuCloseIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
