'use client';

import { useActionState, useState } from 'react';
import { saveAttendanceAction, type AttendanceState } from '@/app/admin/progress/actions';

type Status = 'present' | 'absent' | 'excused';
const STATUSES: { v: Status; label: string }[] = [
  { v: 'present', label: 'حاضر' },
  { v: 'absent', label: 'غائب' },
  { v: 'excused', label: 'مجاز' },
];
const MAX_NOTE = 300;
const ar = (n: number) => new Intl.NumberFormat('ar-EG', { useGrouping: false }).format(n);

export type AttendanceRow = { studentId: number; name: string; status: Status | null; note: string | null };

/**
 * One session's attendance. Everyone starts as «حاضر» (design: a class with nobody absent is one tap); the teacher
 * changes the absent and excused ones only. What was picked stays on screen when the server reports a problem.
 * `readOnly`: the day is past the edit window for this recorder; the marks are shown, nothing is sent.
 */
export function AttendanceForm({ courseId, day, rows, readOnly }: { courseId: number; day: string; rows: AttendanceRow[]; readOnly: boolean }) {
  const [marks, setMarks] = useState<Record<number, Status>>(() => Object.fromEntries(rows.map((r) => [r.studentId, r.status ?? 'present'])));
  const [notes, setNotes] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((r) => [r.studentId, r.note ?? ''])));
  const [state, action, pending] = useActionState<AttendanceState, FormData>(saveAttendanceAction, undefined);
  const saved = rows.some((r) => r.status !== null);
  const count = (s: Status) => rows.filter((r) => marks[r.studentId] === s).length;

  return (
    <form action={action} className="att" noValidate>
      <input type="hidden" name="course" value={courseId} />
      <input type="hidden" name="date" value={day} />
      {readOnly ? null : (
        <p className="att-hint mute">
          {saved ? 'هذا ما سُجِّل لهذا اليوم. غيّر ما تريد ثم اضغط «حفظ الحضور».' : 'الكل مؤشَّر «حاضر». غيّر الغائب والمجاز فقط، ثم اضغط «حفظ الحضور».'} الملاحظة يقرؤها الطالب وولي أمره في «حسابي»: اكتب عن الدرس فقط.
        </p>
      )}
      <ol className="att-list">
        {rows.map((r, i) => {
          const noteId = `note-${r.studentId}`;
          const tooLong = (notes[r.studentId] ?? '').length > MAX_NOTE;
          return (
            <li key={r.studentId}>
              <input type="hidden" name="student" value={r.studentId} />
              <fieldset className="att-row" disabled={readOnly}>
                <legend>
                  <span className="qn">{ar(i + 1)}</span> {r.name}
                </legend>
                <div className="att-seg" role="radiogroup" aria-label={`حضور ${r.name}`}>
                  {STATUSES.map((s) => (
                    <label key={s.v} className={`att-opt ${s.v}`}>
                      <input type="radio" name={`status-${r.studentId}`} value={s.v} checked={marks[r.studentId] === s.v} onChange={() => setMarks({ ...marks, [r.studentId]: s.v })} />
                      {s.label}
                    </label>
                  ))}
                </div>
                <label className="vh" htmlFor={noteId}>
                  ملاحظة عن {r.name}
                </label>
                <input
                  id={noteId}
                  name={noteId}
                  className="inp att-note"
                  placeholder={readOnly ? undefined : 'ملاحظة (اختيارية)'}
                  maxLength={MAX_NOTE}
                  value={notes[r.studentId] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [r.studentId]: e.target.value })}
                  aria-invalid={tooLong || state?.noteFor === r.studentId ? true : undefined}
                  autoComplete="off"
                />
              </fieldset>
            </li>
          );
        })}
      </ol>
      {/* The messages sit in the bar, next to the button the teacher just pressed: at the top of a long list they would be off screen. */}
      <div className={`att-bar${readOnly ? ' still' : ''}`}>
        {state?.error ? (
          <p className="alert bad" role="alert">
            {state.error}
          </p>
        ) : null}
        {state?.ok ? (
          <p className="alert ok" role="status">
            {state.ok}
          </p>
        ) : null}
        <p className="mute" aria-live="polite">
          حاضر {ar(count('present'))}، غائب {ar(count('absent'))}، مجاز {ar(count('excused'))}
        </p>
        {readOnly ? null : (
          <button className="btn k" type="submit" disabled={pending}>
            {pending ? 'جارٍ الحفظ…' : 'حفظ الحضور'}
          </button>
        )}
      </div>
    </form>
  );
}
