'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type TabItem = {
  id: string;
  name: string;
  note: string;
  icon: ReactNode;
  panel: ReactNode;
};

// Product tabs: click, or arrow keys, Home and End once a tab has focus.
export function Tabs({ items, install }: { items: TabItem[]; install: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number, focus: boolean) {
    setSelected(index);
    if (focus) tabRefs.current[index]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    select(next, true);
  }

  return (
    <div className="product">
      <div className="tabs-col">
        <div className="tabs" role="tablist" aria-label="Products" aria-orientation="vertical">
          {items.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              className="tab"
              role="tab"
              id={`tab-${item.id}`}
              aria-controls={`panel-${item.id}`}
              aria-selected={i === selected}
              tabIndex={i === selected ? 0 : -1}
              type="button"
              onClick={() => select(i, false)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {item.icon}
              <span className="tab__name">{item.name}</span>
              <span className="tab__note">{item.note}</span>
            </button>
          ))}
        </div>
        {install}
      </div>
      <div className="panels">
        {items.map((item, i) => (
          <div
            key={item.id}
            className="panel well"
            role="tabpanel"
            id={`panel-${item.id}`}
            aria-labelledby={`tab-${item.id}`}
            tabIndex={0}
            hidden={i !== selected}
          >
            {item.panel}
          </div>
        ))}
      </div>
    </div>
  );
}
