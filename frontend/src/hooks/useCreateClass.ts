import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { createClass } from '../api/classes'
import type { CreateClassInput, SchoolClass } from '../api/types'
import { CLASSES_KEY } from './useClasses'
import { useInFlight } from './useInFlight'

export type CreateClassOutcome = { ok: true; created: SchoolClass } | { ok: false; error: unknown }

/**
 * Creates a class (POST /classes). Returns the outcome instead of toasting, because the form decides where each
 * error belongs (a duplicate name is shown next to the Name field, other problems at the top of the form).
 * Returns undefined when a create is already running (double-submit guard).
 */
export function useCreateClass() {
  const queryClient = useQueryClient()
  const { run, isBusy } = useInFlight()

  const create = useCallback(
    (input: CreateClassInput): Promise<CreateClassOutcome | undefined> =>
      run('create', async (): Promise<CreateClassOutcome> => {
        try {
          const created = await createClass(input)
          await queryClient.invalidateQueries({ queryKey: CLASSES_KEY }) // the new class shows up in the list at once
          return { ok: true, created }
        } catch (error) {
          return { ok: false, error }
        }
      }),
    [queryClient, run],
  )

  return { create, pending: isBusy('create') }
}
