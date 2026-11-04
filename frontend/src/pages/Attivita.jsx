// Attività ricorrenti (scadenziario operativo, solo admin): cosa caricare o aggiornare e quando. Lo stato viene dagli
// import dei moduli; "Segna fatta" per le attività che HotelOS non può verificare o per una scadenza senza file.
// Frequenze e giorni si cambiano in Admin → Comune → Attività ricorrenti.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client.js'
import { formatDataIt, mostraErrore } from '../utils/format.js'
import {
  Badge, Button, Card, KpiTile, Loading, Messaggio, NavMese, PageHeader, StatoVuoto, Table, Td, Th, useAvvisi,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

const STATO = {
  in_ritardo: { tono: 'err', testo: 'in ritardo' },
  da_fare: { tono: 'neutral', testo: 'da fare' },
  fatta: { tono: 'ok', testo: 'fatta' },
}
const PARTI = { disdetta: 'disdette', non_disdetta: 'non disdette' }
const gg = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function Dettaglio({ v }) {
  if (v.giorni) {
    const mancano = v.giorni.filter(g => g.stato === 'in_ritardo').map(g => g.data)
    const fatti = v.giorni.filter(g => g.stato === 'fatta').length
    return (
      <span>
        {fatti}/{v.giorni.length} giorni
        {mancano.length > 0 && <span style={{ color: colors.danger }}> · mancano {mancano.map(gg).join(', ')}</span>}
      </span>
    )
  }
  if (v.stato !== 'fatta' && v.mancanti.length) return <span>manca {v.mancanti.map(p => PARTI[p] || p).join(', ')}</span>
  return v.manuale ? <span className="ui-text-muted">segnata a mano</span> : null
}

function RigaVoce({ v, onFatto }) {
  const s = STATO[v.stato]
  const daSegnare = v.giorni ? v.giorni.filter(g => g.stato !== 'fatta').map(g => g.scadenza) : v.scadenze
  const daTogliere = v.giorni ? v.giorni.filter(g => g.manuale).map(g => g.scadenza) : (v.manuale ? v.scadenze : [])
  return (
    <tr className={v.stato === 'in_ritardo' ? 'ui-riga-avviso' : v.stato === 'fatta' ? 'ui-riga-ok' : undefined}>
      <Td><Badge tono={s.tono}>{s.testo}</Badge></Td>
      <Td>
        <div>{v.titolo}{!v.automatica && <span className="ui-text-muted"> · da spuntare a mano</span>}</div>
        {v.nota && <div className="ui-text-muted" style={{ fontSize: 'var(--fs-sm)' }}>{v.nota}</div>}
      </Td>
      <Td muted>{v.gruppo}</Td>
      <Td>{v.giorni ? `${gg(v.giorni[0].data)}–${gg(v.giorni.at(-1).data)}` : formatDataIt(v.scadenza)}</Td>
      <Td><Dettaglio v={v} /></Td>
      <Td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
        {v.link && <Link to={v.link} className="ui-btn ui-btn-ghost ui-btn-sm">Vai</Link>}{' '}
        {daSegnare.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => onFatto(v.codice, daSegnare, true)}>
            {v.giorni && daSegnare.length > 1 ? `Segna fatti (${daSegnare.length})` : 'Segna fatta'}
          </Button>
        )}
        {daTogliere.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onFatto(v.codice, daTogliere, false)}>Togli spunta</Button>
        )}
      </Td>
    </tr>
  )
}

function TabellaVoci({ voci, onFatto }) {
  return (
    <Table compact>
      <thead>
        <tr><Th>Stato</Th><Th>Attività</Th><Th>Modulo</Th><Th>Scadenza</Th><Th>Dettaglio</Th><Th /></tr>
      </thead>
      <tbody>
        {voci.map(v => <RigaVoce key={`${v.codice}-${v.scadenze[0]}`} v={v} onFatto={onFatto} />)}
      </tbody>
    </Table>
  )
}

export default function Attivita() {
  const oggi = new Date()
  const [periodo, setPeriodo] = useState({ anno: oggi.getFullYear(), mese: oggi.getMonth() + 1 })
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [versione, setVersione] = useState(0)
  const avvisi = useAvvisi()

  useEffect(() => {
    let annullato = false
    setErrore(null)
    api.get('/attivita', { params: periodo })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [periodo, versione])

  async function segna(codice, scadenze, fatto) {
    try {
      await api.post('/attivita/fatto', { codice, scadenze, fatto })
      setVersione(v => v + 1)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function segnaTuttiRitardi() {
    try {
      for (const v of dati.in_ritardo) await api.post('/attivita/fatto', { codice: v.codice, scadenze: v.scadenze, fatto: true })
      avvisi.successo('Ritardi segnati come fatti')
      setVersione(v => v + 1)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  async function scaricaPdf() {
    try {
      const res = await api.get('/attivita/export', { params: periodo, responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `attivita_${periodo.anno}-${String(periodo.mese).padStart(2, '0')}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) { avvisi.errore(mostraErrore(e, 'Errore export')) }
  }

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

  const r = dati.riepilogo
  const imp = dati.impegni
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Attività ricorrenti" subtitle="Cosa caricare o aggiornare, settimana per settimana">
        <NavMese anno={periodo.anno} mese={periodo.mese} onChange={setPeriodo} selettore />
        <Button variant="secondary" onClick={scaricaPdf}>Scarica PDF</Button>
        <Link to="/admin?s=attivita" className="ui-btn ui-btn-ghost">Frequenze</Link>
      </PageHeader>

      <div className="ui-kpi-row">
        <KpiTile label="In ritardo nel mese" value={r.in_ritardo} colore={r.in_ritardo ? colors.danger : undefined} />
        <KpiTile label="Da fare" value={r.da_fare} />
        <KpiTile label="Fatte" value={r.fatta} colore={colors.success} />
        {imp.totale > 0 && (
          <KpiTile label="Impegni Tesoreria del mese" value={imp.da_pagare}
            sub={`da pagare su ${imp.totale}${imp.scaduti ? ` · ${imp.scaduti} scaduti` : ''}`}
            colore={imp.scaduti ? colors.danger : undefined} />
        )}
      </div>

      {dati.in_ritardo.length > 0 && (
        <Card title={`In ritardo (mese scorso e mese in corso): ${dati.in_ritardo.length}`}
          actions={<Button size="sm" variant="ghost" onClick={segnaTuttiRitardi}>Segna tutti come fatti</Button>}>
          <TabellaVoci voci={dati.in_ritardo} onFatto={segna} />
        </Card>
      )}

      {dati.settimane.map(s => (
        <Card key={s.inizio} title={`Settimana dal ${formatDataIt(s.inizio)} al ${formatDataIt(s.fine)}`}>
          {s.voci.length === 0 ? <StatoVuoto>Nessuna attività.</StatoVuoto>
            : <TabellaVoci voci={s.voci} onFatto={segna} />}
        </Card>
      ))}

      {imp.totale > 0 && (
        <p className="ui-text-muted">
          Le scadenze fiscali, gli affitti e il mutuo restano in <Link to="/tesoreria">Tesoreria → Impegni</Link>.
        </p>
      )}
    </div>
  )
}
