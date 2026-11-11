import { useMemo } from 'react'
import { ClassCard } from '../../components/ClassCard'
import { ClassCardSkeleton } from '../../components/ClassCardSkeleton'
import { ErrorBanner } from '../../components/ErrorBanner'
import { useApply } from '../../hooks/useApply'
import { useClasses } from '../../hooks/useClasses'
import { useMyHolds } from '../../hooks/useMyHolds'
import { messageFor } from '../../i18n/messages'
import type { MyHold } from '../../api/types'

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString()

export function ClassesTab() {
  const classes = useClasses()
  const holds = useMyHolds()
  const { apply, isBusy } = useApply()

  // classId -> the student's active (HELD or CONFIRMED) application. Server statuses only for now.
  const activeByClass = useMemo(() => {
    const map = new Map<string, MyHold>()
    for (const h of holds.data ?? []) {
      if (h.status === 'HELD' || h.status === 'CONFIRMED') map.set(h.classId, h)
    }
    return map
  }, [holds.data])

  return (
    <section aria-labelledby="open-classes-title">
      <h2 id="open-classes-title" className="section-title">
        Open classes
      </h2>

      {classes.isPending && (
        <>
          <p className="sr-only" role="status">
            Loading classes…
          </p>
          <div className="grid" aria-busy="true">
            <ClassCardSkeleton />
            <ClassCardSkeleton />
            <ClassCardSkeleton />
          </div>
        </>
      )}

      {classes.isError && !classes.data && (
        <ErrorBanner onRetry={() => void classes.refetch()}>{messageFor(classes.error, 'load')}</ErrorBanner>
      )}

      {classes.data && (
        <>
          {classes.isError && (
            <ErrorBanner>
              {messageFor(classes.error, 'load')} Showing the last known seat numbers (updated{' '}
              {formatTime(classes.dataUpdatedAt)}).
            </ErrorBanner>
          )}
          {classes.data.length === 0 ? (
            <div className="glass banner">
              <p>No classes are open for admission yet. They will appear here as soon as the school adds them.</p>
            </div>
          ) : (
            <div className={`grid${classes.isError ? ' stale' : ''}`}>
              {classes.data.map((cls) => (
                <ClassCard
                  key={cls.id}
                  cls={cls}
                  activeHold={activeByClass.get(cls.id)}
                  busy={isBusy(cls.id)}
                  onApply={(id) => void apply(id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
