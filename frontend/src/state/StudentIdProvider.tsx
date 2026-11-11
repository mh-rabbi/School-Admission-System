import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { readStorage, writeStorage } from '../lib/storage'
import { describeStudentId, isValidStudentId, normalizeStudentId, type StudentIdStatus } from '../lib/studentId'

export const STUDENT_ID_STORAGE_KEY = 'sas.studentId'

interface StudentIdValue {
  /** Normalised text of the field (Bengali digits already converted), valid or not. */
  input: string
  setInput: (raw: string) => void
  status: StudentIdStatus
  /** The 17-digit ID when valid, otherwise null. API calls must use this and never `input`. */
  studentId: string | null
  /** Attached to the ID field so other screens can send the user back to it. */
  inputRef: RefObject<HTMLInputElement>
  focusInput: () => void
}

const StudentIdContext = createContext<StudentIdValue | null>(null)

export function StudentIdProvider({ children }: { children: ReactNode }) {
  const [input, setInputState] = useState(() => normalizeStudentId(readStorage(STUDENT_ID_STORAGE_KEY) ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)

  const setInput = useCallback((raw: string) => {
    const normalized = normalizeStudentId(raw)
    setInputState(normalized)
    writeStorage(STUDENT_ID_STORAGE_KEY, normalized) // survives refresh and browser restart
  }, [])

  const focusInput = useCallback(() => inputRef.current?.focus(), [])

  const value = useMemo<StudentIdValue>(
    () => ({
      input,
      setInput,
      status: describeStudentId(input),
      studentId: isValidStudentId(input) ? input : null,
      inputRef,
      focusInput,
    }),
    [input, setInput, focusInput],
  )

  return <StudentIdContext.Provider value={value}>{children}</StudentIdContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStudentId(): StudentIdValue {
  const ctx = useContext(StudentIdContext)
  if (!ctx) throw new Error('useStudentId must be used inside <StudentIdProvider>')
  return ctx
}
