import { ExpiryWatcher } from '../components/ExpiryWatcher'
import { IdBar } from '../components/IdBar'
import { Tabs, type TabDef } from '../components/Tabs'
import { useRoute } from '../hooks/useRoute'
import { ClassesTab } from './tabs/ClassesTab'
import { AdminTab } from './tabs/AdminTab'
import { MyApplicationsTab } from './tabs/MyApplicationsTab'
import type { PortalTab } from '../lib/route'
import { panelDomId, tabDomId } from '../lib/tabIds'

const TABS: readonly TabDef<PortalTab>[] = [
  { id: 'classes', label: 'Classes' },
  { id: 'applications', label: 'My Applications' },
  { id: 'admin', label: 'Admin' },
]
const PREFIX = 'portal'

export function Portal({ tab }: { tab: PortalTab }) {
  const { navigate } = useRoute()
  return (
    <div className="wrap">
      <h1 className="sr-only">Admission portal</h1>
      <IdBar />
      <ExpiryWatcher />
      <Tabs
        tabs={TABS}
        active={tab}
        idPrefix={PREFIX}
        label="Portal sections"
        onChange={(id) => navigate({ page: 'portal', tab: id })}
      />
      <div role="tabpanel" id={panelDomId(PREFIX, tab)} aria-labelledby={tabDomId(PREFIX, tab)} tabIndex={0}>
        {tab === 'classes' && <ClassesTab />}
        {tab === 'applications' && <MyApplicationsTab />}
        {tab === 'admin' && <AdminTab />}
      </div>
    </div>
  )
}
