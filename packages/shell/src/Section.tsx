import { useCallback, useState, type ReactNode } from 'react';

import { appKey } from './storage.js';

/**
 * A collapsible panel section.
 *
 * The panel has eleven groups and only a few matter while you are actually solving, so everything
 * else folds away. Open/closed state is remembered per section, because the set you want open is a
 * working preference rather than a per-visit decision.
 */

function readState(): Record<string, boolean> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(appKey('sections')) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeState(state: Record<string, boolean>): void {
  try {
    globalThis.localStorage?.setItem(appKey('sections'), JSON.stringify(state));
  } catch {
    /* a forgotten layout is not worth surfacing */
  }
}

export function Section({
  id,
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  /** Stable key for remembering this section's state. */
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** A short summary shown on the header when collapsed, so folding loses no information. */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readState()[id] ?? defaultOpen);

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      writeState({ ...readState(), [id]: next });
      return next;
    });
  }, [id]);

  return (
    <div className={open ? 'group open' : 'group'}>
      <button className="group-head" onClick={toggle} aria-expanded={open}>
        <Chevron open={open} />
        <h2>{title}</h2>
        {!open && badge !== undefined && <span className="group-badge">{badge}</span>}
      </button>
      {open && <div className="group-body">{children}</div>}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="chevron"
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : undefined }}
    >
      <polyline points="5 3 11 8 5 13" />
    </svg>
  );
}
