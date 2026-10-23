import { useState } from 'react'
import UsaliContoEconomico from './UsaliContoEconomico'
import UsaliMovimentiAttivi from './UsaliMovimentiAttivi'
import UsaliContabile from './usaliContabile/UsaliContabile.jsx'
import UsaliFnb from './usaliFnb/UsaliFnb.jsx'
import { PageHeader, Tabs } from '../components/ui'

const LS_TAB = 'usali_tab'

const TABS = [
  { id: 'conto-economico', label: 'Conto Economico' },
  { id: 'movimenti-attivi', label: 'Movimenti Attivi' },
  { id: 'contabile', label: 'Conto Economico contabile' },
  { id: 'fnb', label: 'Food & Beverage' },
]

export default function Usali() {
  const [tab, setTab] = useState(() => localStorage.getItem(LS_TAB) || 'conto-economico')

  const cambiaTab = (id) => {
    setTab(id)
    localStorage.setItem(LS_TAB, id)
  }

  return (
    <div>
      <PageHeader title="USALI" />
      <Tabs tabs={TABS} value={tab} onChange={cambiaTab} />

      {tab === 'conto-economico' && <UsaliContoEconomico />}
      {tab === 'movimenti-attivi' && <UsaliMovimentiAttivi />}
      {tab === 'contabile' && <UsaliContabile />}
      {tab === 'fnb' && <UsaliFnb />}
    </div>
  )
}
