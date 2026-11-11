import { api } from './client'
import type { CreateClassInput, SchoolClass } from './types'

export const listClasses = (signal?: AbortSignal) => api.request<SchoolClass[]>('/classes', { signal })

export const createClass = (input: CreateClassInput) =>
  api.request<SchoolClass>('/classes', { method: 'POST', body: input })
