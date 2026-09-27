import { useState } from 'react'
import UsaliContoEconomico from './UsaliContoEconomico'
import UsaliMovimentiAttivi from './UsaliMovimentiAttivi'
import { PageHeader, Tabs } from '../components/ui'

const LS_TAB = 'usali_tab'

const TABS = [
  { id: 'conto-economico', label: 'Conto Economico' },
  { id: 'movimenti-attivi', label: 'Movimenti Attivi' },
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
    </div>
  )
}
