import type { ReactNode } from 'react';

/** A labelled form field with an optional hint and an error message tied to the input by id. `after` sits under them (a helper button, say). */
export function Field({ id, label, hint, error, required, after, children }: { id: string; label: string; hint?: ReactNode; error?: string; required?: boolean; after?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? (
          <em className="req" aria-hidden="true">
            {' '}
            *
          </em>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="err" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
      {after}
    </div>
  );
}

/** Props that connect an input to the Field around it. Errors are announced once, by the summary above the form. */
export const fieldProps = (id: string, { error, hint = false, required = false, ltr = false }: { error?: string; hint?: boolean; required?: boolean; ltr?: boolean } = {}) => ({
  id,
  name: id,
  className: ltr ? 'inp ltr' : 'inp',
  'aria-invalid': error ? true : undefined,
  'aria-required': required ? true : undefined,
  'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
});
