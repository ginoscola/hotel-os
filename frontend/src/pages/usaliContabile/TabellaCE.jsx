// Conto Economico USALI contabile: tabella sezione → reparto → sottoreparto → conto, con
// subtotali calcolati dal backend (Profitto reparti, GOP, EBITDA, Netto) sempre visibili.
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client.js'
import { formatPerc, mostraErrore } from '../../utils/format.js'
import {
  Button, Card, Loading, Messaggio, StatoVuoto, Table, Td, Th, useAvvisi,
} from '../../components/ui'
import { Euro, MESI_BREVI, scarica } from './helpers.jsx'

const CLASSE_RIGA = {
  sezione: 'ui-riga-sezione',
  subtotale: 'ui-riga-subtotale',
  totale: 'ui-riga-totale',
}

export default function TabellaCE({ struttura, segmentoId, anno, meseDa, meseA }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [loading, setLoading] = useState(false)
  const [aperti, setAperti] = useState(() => new Set())
  const [esportando, setEsportando] = useState(false)
  const avvisi = useAvvisi()

  const params = useMemo(() => ({
    struttura, anno, mese_da: meseDa, mese_a: meseA,
    ...(segmentoId ? { segmento_id: segmentoId } : {}),
  }), [struttura, anno, meseDa, meseA, segmentoId])

  useEffect(() => {
    let annullato = false
    setLoading(true)
    setErrore(null)
    api.get('/usali/contabile/report', { params })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) { setErrore(mostraErrore(e)); setDati(null) } })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [params])

  const { perId, conFigli } = useMemo(() => {
    const perId = {}
    const conFigli = new Set()
    for (const r of dati?.righe || []) {
      perId[r.id] = r
      if (r.parent) conFigli.add(r.parent)
    }
    return { perId, conFigli }
  }, [dati])

  const visibile = (r) => {
    let p = r.parent
    while (p) {
      if (!aperti.has(p)) return false
      p = perId[p]?.parent
    }
    return true
  }

  const toggle = (id) => setAperti(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  async function esporta() {
    setEsportando(true)
    try {
      await scarica('/usali/contabile/report/export', params,
        `CE_USALI_${struttura}_${anno}_${String(meseDa).padStart(2, '0')}-${String(meseA).padStart(2, '0')}.xlsx`)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore durante l\'export'))
    } finally {
      setEsportando(false)
    }
  }

  if (loading && !dati) return <Loading />
  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return null
  if (!dati.mesi_importati.length) {
    return <StatoVuoto>Nessun dato importato per {struttura} nel periodo selezionato.</StatoVuoto>
  }

  const prec = dati.prec_disponibile
  const azioni = (
    <div style={{ display: 'flex', gap: 6 }}>
      <Button size="sm" variant="secondary" onClick={() => setAperti(new Set(conFigli))}>Espandi tutto</Button>
      <Button size="sm" variant="secondary" onClick={() => setAperti(new Set())}>Comprimi</Button>
      <Button size="sm" variant="secondary" onClick={esporta} disabled={esportando}>
        {esportando ? '…' : '⬇ Esporta Excel'}
      </Button>
    </div>
  )

  return (
    <Card title="Conto Economico" actions={azioni}>
      {dati.errori_segmento.length > 0 && (
        <Messaggio tipo="warn">
          {dati.errori_segmento.length} conti non assegnati a nessun segmento (esclusi dai totali del
          segmento): {dati.errori_segmento.slice(0, 5).map(e => e.conto.split(' > ').at(-1)).join(', ')}
          {dati.errori_segmento.length > 5 && '…'}
        </Messaggio>
      )}
      <Table compact maxHeight="70vh">
        <thead>
          <tr>
            <Th style={{ minWidth: 280 }}>Voce</Th>
            {dati.mesi.map(m => (
              <Th key={m} num title={dati.mesi_importati.includes(m) ? undefined : 'Mese non importato'}>
                {MESI_BREVI[m - 1]}
              </Th>
            ))}
            <Th num tot>Totale</Th>
            <Th num>% ricavi</Th>
            <Th num gruppo>Progr. {anno}</Th>
            {prec && <Th num gruppo>{dati.mese_da === dati.mese_a ? MESI_BREVI[dati.mese_da - 1] : 'Periodo'} {anno - 1}</Th>}
            {prec && <Th num>Δ vs {anno - 1}</Th>}
          </tr>
        </thead>
        <tbody>
          {dati.righe.filter(visibile).map(r => {
            const espandibile = conFigli.has(r.id)
            const aperto = aperti.has(r.id)
            const scuro = r.tipo === 'totale'
            return (
              <tr key={r.id} className={CLASSE_RIGA[r.tipo]}>
                <Td
                  style={{
                    paddingLeft: 8 + r.livello * 18,
                    cursor: espandibile ? 'pointer' : undefined,
                    fontWeight: r.tipo === 'reparto' ? 600 : undefined,
                    whiteSpace: 'nowrap',
                  }}
                  onClick={espandibile ? () => toggle(r.id) : undefined}
                  title={r.tipo === 'conto' ? r.chiave : undefined}
                >
                  {espandibile ? (aperto ? '▾ ' : '▸ ') : ''}{r.nome}
                </Td>
                {r.valori.map((v, i) => <Td key={i} num><Euro v={v} scuro={scuro} /></Td>)}
                <Td num tot><Euro v={r.totale} scuro={scuro} /></Td>
                <Td num>{formatPerc(r.perc_ricavi)}</Td>
                <Td num gruppo><Euro v={r.progressivo} scuro={scuro} /></Td>
                {prec && <Td num gruppo><Euro v={r.anno_prec} scuro={scuro} /></Td>}
                {prec && <Td num><Euro v={r.delta_anno_prec} scuro={scuro} /></Td>}
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="ui-text-muted" style={{ marginTop: 8 }}>
        Totali ricalcolati dai singoli conti. Ricavi positivi, costi negativi (in rosso), come nel gestionale.
        «—» = mese non importato. «Progr.» = da gennaio all'ultimo mese selezionato.
      </p>
    </Card>
  )
}
