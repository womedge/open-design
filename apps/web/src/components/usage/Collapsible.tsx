import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Accordion body using the shared `.accordion-collapsible` motion. React 18.3
 * does not forward the `inert` prop, so the attribute is set on the DOM node:
 * collapsed content must not be focusable.
 */
export function Collapsible({
  open,
  id,
  children,
}: {
  open: boolean;
  id?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.toggleAttribute('inert', !open);
  }, [open]);
  return (
    <div id={id} ref={ref} className={`accordion-collapsible ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="accordion-collapsible-inner">{children}</div>
    </div>
  );
}
