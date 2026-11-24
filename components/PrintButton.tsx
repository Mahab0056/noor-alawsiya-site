'use client';

/** «اطبع»: the browser's own print dialog. Nothing is generated or downloaded by the site. */
export function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" className="btn y" onClick={() => window.print()}>
      {children}
    </button>
  );
}
