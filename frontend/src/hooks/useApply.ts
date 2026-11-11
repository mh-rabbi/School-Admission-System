import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { applyForSeat } from '../api/holds'
import { ApiError } from '../api/errors'
import { SUCCESS, messageFor } from '../i18n/messages'
import { useStudentId } from '../state/StudentIdProvider'
import { useToast } from '../state/ToastProvider'
import { CLASSES_KEY } from './useClasses'
import { holdsKey } from './useMyHolds'
import { useInFlight } from './useInFlight'

/** Apply for a seat in a class (POST /classes/{id}/holds) with friendly outcomes. */
export function useApply() {
  const { studentId, focusInput } = useStudentId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { run, isBusy } = useInFlight()

  const apply = useCallback(
    async (classId: string) => {
      if (!studentId) {
        focusInput()
        toast.error(messageFor(new ApiError(400, 'INVALID_STUDENT_ID'), 'apply'))
        return
      }
      await run(classId, async () => {
        try {
          await applyForSeat(classId, studentId)
          toast.success(SUCCESS.applied)
        } catch (error) {
          toast.error(messageFor(error, 'apply'))
        } finally {
          // Whatever happened, re-read the truth. The button stays busy until both lists are fresh, so it can never
          // flash "Apply" again between the response and the refetch.
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: CLASSES_KEY }),
            queryClient.invalidateQueries({ queryKey: holdsKey(studentId) }),
          ])
        }
      })
    },
    [studentId, focusInput, toast, queryClient, run],
  )

  return { apply, isBusy }
}
