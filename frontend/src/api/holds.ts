import { api } from './client'
import type { HoldConfirmed, HoldCreated, MyHold } from './types'

const id = encodeURIComponent

export const applyForSeat = (classId: string, studentId: string) =>
  api.request<HoldCreated>(`/classes/${id(classId)}/holds`, { method: 'POST', studentId })

export const listMyHolds = (studentId: string, signal?: AbortSignal) =>
  api.request<MyHold[]>('/me/holds', { studentId, signal })

export const confirmHold = (holdId: string, studentId: string) =>
  api.request<HoldConfirmed>(`/holds/${id(holdId)}/confirm`, { method: 'POST', studentId })

export const cancelHold = (holdId: string, studentId: string) =>
  api.request<void>(`/holds/${id(holdId)}`, { method: 'DELETE', studentId })
