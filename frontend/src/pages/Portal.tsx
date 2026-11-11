import { IdBar } from '../components/IdBar'
import { Tabs, type TabDef } from '../components/Tabs'
import { useRoute } from '../hooks/useRoute'
import type { PortalTab } from '../lib/route'
import { panelDomId, tabDomId } from '../lib/tabIds'

const TABS: readonly TabDef<PortalTab>[] = [
  { id: 'classes', label: 'Classes' },
  { id: 'applications', label: 'My Applications' },
  { id: 'admin', label: 'Admin' },
]
const PREFIX = 'portal'

/** Placeholder panel text; each tab's real content arrives in Steps 5, 7 and 8. */
const PLACEHOLDER: Record<PortalTab, string> = {
  classes: 'Open classes will appear here.',
  applications: 'Your applications will appear here.',
  admin: 'Class creation will appear here.',
}

export function Portal({ tab }: { tab: PortalTab }) {
  const { navigate } = useRoute()
  return (
    <div className="wrap">
      <IdBar />
      <Tabs
        tabs={TABS}
        active={tab}
        idPrefix={PREFIX}
        label="Portal sections"
        onChange={(id) => navigate({ page: 'portal', tab: id })}
      />
      <div role="tabpanel" id={panelDomId(PREFIX, tab)} aria-labelledby={tabDomId(PREFIX, tab)} tabIndex={0}>
        <p className="muted">{PLACEHOLDER[tab]}</p>
      </div>
    </div>
  )
}
