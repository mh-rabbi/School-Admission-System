import { useId } from 'react'
import { STUDENT_ID_MAX_INPUT } from '../lib/studentId'
import { useStudentId } from '../state/StudentIdProvider'

/** The identity field at the top of the portal (BRD §4.1). No login: this value is the user's identity. */
export function IdBar() {
  const { input, setInput, status, inputRef } = useStudentId()
  const inputId = useId()
  const hintId = useId()

  return (
    <div className="glass idbar">
      <label htmlFor={inputId}>Student registration number</label>
      <input
        ref={inputRef}
        id={inputId}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={STUDENT_ID_MAX_INPUT}
        placeholder="17 digits, e.g. 20152691234567890"
        aria-invalid={status.invalid}
        aria-describedby={hintId}
      />
      <span id={hintId} className={`idhint ${status.state === 'valid' ? 'ok' : status.invalid ? 'no' : 'muted'}`} aria-live="polite">
        {status.hint}
      </span>
    </div>
  )
}
