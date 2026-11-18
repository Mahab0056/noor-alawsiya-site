import type { ReactNode } from 'react';

/** A labelled form field with an optional hint and an error message tied to the input by id. */
export function Field({ id, label, hint, error, required, children }: { id: string; label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <em className="req"> *</em> : null}
      </label>
      {children}
      {hint && !error ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="err" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Props that connect an input to the Field around it. */
export const fieldProps = (id: string, error?: string, hint?: string) => ({
  id,
  name: id,
  className: 'inp',
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
});
