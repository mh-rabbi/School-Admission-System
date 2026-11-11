import { ApplicationRow } from '../../components/ApplicationRow'
import { ClassCardSkeleton } from '../../components/ClassCardSkeleton'
import { ErrorBanner } from '../../components/ErrorBanner'
import { useHoldActions } from '../../hooks/useHoldActions'
import { useMyHolds } from '../../hooks/useMyHolds'
import { ACTION_LABELS, messageFor } from '../../i18n/messages'
import { useStudentId } from '../../state/StudentIdProvider'

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString()

/** Every application of the entered student ID, past and present, newest first (GET /me/holds). */
export function MyApplicationsTab() {
  const { studentId, focusInput } = useStudentId()
  const holds = useMyHolds()
  const { pay, cancel, isBusy } = useHoldActions()

  return (
    <section aria-labelledby="my-apps-title">
      <h2 id="my-apps-title" className="section-title">
        My applications
      </h2>

      {studentId === null && (
        <div className="glass banner">
          <p>Enter your 17-digit registration number above to see your applications.</p>
          <button type="button" className="btn ghost" onClick={focusInput}>
            Go to the ID field
          </button>
        </div>
      )}

      {studentId !== null && holds.isPending && (
        <>
          <p className="sr-only" role="status">
            Loading your applications…
          </p>
          <div aria-busy="true">
            <ClassCardSkeleton />
          </div>
        </>
      )}

      {studentId !== null && holds.isError && !holds.data && (
        <ErrorBanner onRetry={() => void holds.refetch()}>{messageFor(holds.error, 'load')}</ErrorBanner>
      )}

      {studentId !== null && holds.data && (
        <>
          {holds.isError && (
            <ErrorBanner>
              {messageFor(holds.error, 'load')} Showing your applications as of {formatTime(holds.dataUpdatedAt)}.
            </ErrorBanner>
          )}
          {holds.data.length === 0 ? (
            <div className="glass banner">
              <p>No applications yet. Pick a class and press {ACTION_LABELS.apply}.</p>
            </div>
          ) : (
            <div className={holds.isError ? 'stale' : undefined}>
              {holds.data.map((h) => (
                <ApplicationRow
                  key={h.holdId}
                  hold={h}
                  busy={isBusy(h.holdId)}
                  onPay={(x) => void pay(x)}
                  onCancel={(x) => void cancel(x)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
