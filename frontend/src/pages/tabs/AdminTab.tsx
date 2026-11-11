import { useId, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/errors'
import { useCreateClass } from '../../hooks/useCreateClass'
import { SUCCESS, messageFor } from '../../i18n/messages'
import { CLASS_NAME_MAX, SEATS_MAX, SEATS_MIN, validateClassForm, type FieldErrors } from '../../lib/classForm'
import { useToast } from '../../state/ToastProvider'

/** School admin: create a class (BRD §4.1). Shifts of one grade are separate classes, e.g. "Class 6 - Day Shift". */
export function AdminTab() {
  const [name, setName] = useState('')
  const [seats, setSeats] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const seatsRef = useRef<HTMLInputElement>(null)
  const { create, pending } = useCreateClass()
  const toast = useToast()
  const ids = { name: useId(), nameErr: useId(), nameHint: useId(), seats: useId(), seatsErr: useId(), seatsHint: useId() }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return

    const checked = validateClassForm(name, seats)
    if (!checked.ok) {
      setErrors(checked.errors)
      setFormError(null)
      ;(checked.errors.name ? nameRef : seatsRef).current?.focus()
      return
    }
    setErrors({})
    setFormError(null)

    const outcome = await create(checked.value)
    if (!outcome) return
    if (outcome.ok) {
      toast.success(SUCCESS.classCreated(outcome.created.name))
      setName('')
      setSeats('')
      nameRef.current?.focus() // ready for the next class
    } else if (outcome.error instanceof ApiError && outcome.error.code === 'DUPLICATE_CLASS_NAME') {
      setErrors({ name: messageFor(outcome.error, 'createClass') })
      nameRef.current?.focus()
    } else {
      setFormError(messageFor(outcome.error, 'createClass')) // the typed values are kept so nothing is lost
    }
  }

  return (
    <section aria-labelledby="admin-title">
      <h2 id="admin-title" className="section-title">
        Create a class
      </h2>
      <form className="glass fld" onSubmit={(e) => void onSubmit(e)} noValidate aria-busy={pending}>
        <label htmlFor={ids.name}>
          Name
          <input
            ref={nameRef}
            id={ids.name}
            value={name}
            maxLength={CLASS_NAME_MAX}
            placeholder="Class 9 - Morning Shift"
            autoComplete="off"
            aria-invalid={errors.name !== undefined}
            aria-describedby={`${ids.nameHint}${errors.name ? ` ${ids.nameErr}` : ''}`}
            onChange={(e) => {
              setName(e.target.value)
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
            }}
          />
        </label>
        <p id={ids.nameHint} className="field-hint muted">
          Up to {CLASS_NAME_MAX} characters. Each shift is its own class.
        </p>
        {errors.name && (
          <p id={ids.nameErr} className="field-error" role="alert">
            {errors.name}
          </p>
        )}

        <label htmlFor={ids.seats}>
          Total seats
          <input
            ref={seatsRef}
            id={ids.seats}
            value={seats}
            inputMode="numeric"
            placeholder="120"
            autoComplete="off"
            aria-invalid={errors.seats !== undefined}
            aria-describedby={`${ids.seatsHint}${errors.seats ? ` ${ids.seatsErr}` : ''}`}
            onChange={(e) => {
              setSeats(e.target.value)
              if (errors.seats) setErrors((prev) => ({ ...prev, seats: undefined }))
            }}
          />
        </label>
        <p id={ids.seatsHint} className="field-hint muted">
          A whole number from {SEATS_MIN} to {SEATS_MAX.toLocaleString('en-US')}.
        </p>
        {errors.seats && (
          <p id={ids.seatsErr} className="field-error" role="alert">
            {errors.seats}
          </p>
        )}

        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}

        <button type="submit" className="btn pri" aria-disabled={pending}>
          {pending ? 'Creating…' : 'Create class'}
        </button>
        <p className="field-hint muted">
          There is no login in this version, so anyone who opens this page can create classes.
        </p>
      </form>
    </section>
  )
}
