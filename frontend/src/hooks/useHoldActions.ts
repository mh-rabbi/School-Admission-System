import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { cancelHold, confirmHold } from '../api/holds'
import type { MyHold } from '../api/types'
import { SUCCESS, messageFor } from '../i18n/messages'
import { useStudentId } from '../state/StudentIdProvider'
import { useToast } from '../state/ToastProvider'
import { CLASSES_KEY } from './useClasses'
import { useInFlight } from './useInFlight'
import { holdsKey } from './useMyHolds'

/**
 * Pay the fee (confirm, idempotent) and cancel an application. One lock per hold covers both actions, so Pay and
 * Cancel cannot run at the same time on the same application. Every outcome, including 404/409, re-reads the lists
 * so the UI converges to what the server says; the buttons stay busy until that refresh is done.
 */
export function useHoldActions() {
  const { studentId } = useStudentId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { run, isBusy } = useInFlight()

  const refresh = useCallback(
    (sid: string) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: CLASSES_KEY }),
        queryClient.invalidateQueries({ queryKey: holdsKey(sid) }),
      ]),
    [queryClient],
  )

  const pay = useCallback(
    async (hold: MyHold) => {
      if (!studentId) return
      await run(hold.holdId, async () => {
        try {
          await confirmHold(hold.holdId, studentId) // simulated payment: a successful call = fee paid
          toast.success(SUCCESS.confirmed(hold.className))
        } catch (error) {
          toast.error(messageFor(error, 'confirm'))
        } finally {
          await refresh(studentId)
        }
      })
    },
    [studentId, run, toast, refresh],
  )

  const cancel = useCallback(
    async (hold: MyHold) => {
      if (!studentId) return
      await run(hold.holdId, async () => {
        try {
          await cancelHold(hold.holdId, studentId)
          toast.success(SUCCESS.cancelled)
        } catch (error) {
          toast.error(messageFor(error, 'cancel'))
        } finally {
          await refresh(studentId)
        }
      })
    },
    [studentId, run, toast, refresh],
  )

  return { pay, cancel, isBusy }
}
