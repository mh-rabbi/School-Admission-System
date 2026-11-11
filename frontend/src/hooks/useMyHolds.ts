import { useQuery } from '@tanstack/react-query'
import { listMyHolds } from '../api/holds'
import { POLL_BACKOFF_MS, POLL_HOLDS_MS } from '../lib/polling'
import { useStudentId } from '../state/StudentIdProvider'

export const holdsKey = (studentId: string | null) => ['holds', studentId] as const

/** The current student's applications (all statuses), polled. Runs only while the ID is valid. */
export function useMyHolds() {
  const { studentId } = useStudentId()
  return useQuery({
    queryKey: holdsKey(studentId),
    queryFn: ({ signal }) => listMyHolds(studentId!, signal),
    enabled: studentId !== null,
    refetchInterval: (query) => (query.state.status === 'error' ? POLL_BACKOFF_MS : POLL_HOLDS_MS),
  })
}
