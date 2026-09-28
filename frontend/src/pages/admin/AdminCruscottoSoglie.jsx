import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import { meseNome } from '../../utils/corrispettiviHelpers.js'
import { Button, Input, Messaggio, PageHeader, Table, Td, Th, useAvvisi } from '../../components/ui'
import { colors } from '../../styles/tokens.js'

const NOME_KPI = {
  occupancy: 'Occupancy',
  adr: 'ADR (mensile)',
  revenue_stagione_vs_budget: 'Revenue vs budget',
  revpar_vs_budget: 'RevPAR vs budget',
  adr_vs_budget: 'ADR vs budget',
  pickup_7gg: 'Pickup 7 giorni',
  delta_rt_pms: 'Δ RT vs PMS',
  labor_cost_ratio: 'Costo lavoro / revenue',
  perc_ota: '% ricavi da OTA',
  perc_contante: '% incassi in contante',
}

const NOME_DIREZIONE = {
  alto_meglio: 'più alto è meglio',
  basso_meglio: 'più basso è meglio',
  target: 'bidirezionale (scarto da un target)',
}

/** Righe editabili: cutoff rosso/arancio/verde dei tachimetri della Home / Cruscotto gruppo.
 * Solo le soglie di default (hotel_code = NULL) sono seminate ed editabili in questa v1 —
 * il modello supporta override per hotel (colonna hotel_code) per un'estensione futura. */
export default function AdminCruscottoSoglie() {
  const [soglie, setSoglie] = useState([])
  const [modifiche, setModifiche] = useState({})
  const [salvando, setSalvando] = useState(null)
  const avvisi = useAvvisi()
  const [errore, setErrore] = useState(null)

  const carica = useCallback(() => {
    api.get('/home/soglie')
      .then(r => setSoglie(r.data))
      .catch(e => setErrore(mostraErrore(e)))
  }, [])

  useEffect(() => { carica() }, [carica])

  function campo(id, chiave, valore) {
    setModifiche(m => ({ ...m, [id]: { ...(m[id] || {}), [chiave]: valore } }))
  }

  async function salva(s) {
    const mod = modifiche[s.id] || {}
    setSalvando(s.id)
    try {
      await api.put(`/home/soglie/${s.id}`, {
        soglia_rossa: mod.soglia_rossa ?? s.soglia_rossa,
        soglia_arancione: mod.soglia_arancione ?? s.soglia_arancione,
        target: mod.target ?? s.target,
      })
      avvisi.successo(`${NOME_KPI[s.kpi_code] || s.kpi_code}${s.mese ? ` (${meseNome(s.mese)})` : ''}: soglia aggiornata`)
      setModifiche(m => { const c = { ...m }; delete c[s.id]; return c })
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSalvando(null)
    }
  }

  if (errore) return <Messaggio tipo="err">{errore}</Messaggio>

  const unita = (s) => s.unita === 'perc' ? '%' : s.unita === 'euro' ? '€' : ''
  const campoNum = (s, chiave, valore, larghezza = 84) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Input type="number" defaultValue={valore} className="ui-num" style={{ width: larghezza, textAlign: 'right', padding: '3px 6px' }}
        onChange={e => campo(s.id, chiave, parseFloat(e.target.value))} />
      <span className="ui-text-muted">{unita(s)}</span>
    </span>
  )

  return (
    <div>
      <PageHeader title="Cruscotto — soglie tachimetri" />
      <p className="ui-text-muted" style={{ fontSize: 'var(--fs-base)', maxWidth: 760, marginTop: -8 }}>
        Cutoff rosso / arancio / verde di ogni tachimetro della Home. "Rosso" e "arancio" sono i
        valori di passaggio tra una fascia e la successiva — sopra (o sotto, a seconda della
        direzione) l'arancione la zona è verde. Occupancy e ADR hanno anche una soglia per
        singolo mese (righe indentate): un mese senza override usa quella "Tutto l'anno" come
        fallback.
      </p>

      <Table compact>
        <thead>
          <tr>
            <Th>KPI</Th><Th>Mese</Th><Th>Direzione</Th><Th num>Target</Th>
            <Th num>Soglia rossa</Th><Th num>Soglia arancione</Th><Th />
          </tr>
        </thead>
        <tbody>
          {soglie.map((s, i) => {
            const mod = modifiche[s.id] || {}
            const sporca = Object.keys(mod).length > 0
            // Etichetta KPI ripetuta solo sulla prima riga del gruppo (righe già ordinate per
            // kpi_code dal backend) — le righe mensili restano indentate sotto, senza ripetere.
            const primoDelGruppo = i === 0 || soglie[i - 1].kpi_code !== s.kpi_code
            return (
              <tr key={s.id} className={sporca ? 'ui-riga-avviso' : undefined}
                style={primoDelGruppo && i > 0 ? { borderTop: `2px solid ${colors.border}` } : undefined}>
                <Td style={{ fontWeight: primoDelGruppo ? 600 : 400 }}>{primoDelGruppo ? (NOME_KPI[s.kpi_code] || s.kpi_code) : ''}</Td>
                <Td style={{ color: s.mese == null ? colors.textSubtle : undefined }}>
                  {s.mese == null ? 'Tutto l\'anno' : <>↳ {meseNome(s.mese)}</>}
                </Td>
                <Td style={{ color: colors.textMuted }}>{NOME_DIREZIONE[s.direzione] || s.direzione}</Td>
                <Td num>{s.direzione === 'target' ? campoNum(s, 'target', s.target ?? 0, 72) : '—'}</Td>
                <Td num>{campoNum(s, 'soglia_rossa', s.soglia_rossa)}</Td>
                <Td num>{campoNum(s, 'soglia_arancione', s.soglia_arancione)}</Td>
                <Td center>
                  <Button size="sm" disabled={!sporca || salvando === s.id} onClick={() => salva(s)}>
                    {salvando === s.id ? 'Salvo…' : 'Salva'}
                  </Button>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
