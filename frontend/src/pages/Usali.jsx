import { useState } from 'react'
import UsaliContoEconomico from './UsaliContoEconomico'
import UsaliMovimentiAttivi from './UsaliMovimentiAttivi'

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
    <div style={{ padding: '20px 24px' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: '0 0 1.25rem' }}>USALI</h1>

      <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', gap: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => cambiaTab(t.id)} style={{
            padding: '8px 18px', border: 'none',
            borderBottom: tab === t.id ? '2px solid #1e3a5f' : '2px solid transparent',
            background: 'none', cursor: 'pointer', fontSize: '0.88rem',
            fontWeight: tab === t.id ? 700 : 400,
            color: tab === t.id ? '#1e3a5f' : '#64748b',
            marginBottom: -2, transition: 'all .15s',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'conto-economico' && <UsaliContoEconomico />}
      {tab === 'movimenti-attivi' && <UsaliMovimentiAttivi />}
    </div>
  )
}
