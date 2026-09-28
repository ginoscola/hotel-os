import { Fragment, useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { STRUTTURE_HOTEL, NOMI, meseNome, OPZIONI_STRUTTURA } from '../../utils/produzioneHelpers'
import { Loading, NavAnno, SegmentedControl, Table, Td, Th } from '../../components/ui'
import { colors } from '../../styles/tokens.js'

const SOTTOCOLONNE = ['colazione', 'pranzo', 'cena']
const LABEL_SOTTOCOLONNA = { colazione: 'Colazione', pranzo: 'Pranzo', cena: 'Cena' }

// Colazione = trattamento + extra sommati (numero pasti serviti); il dettaglio si vede
// espandendo la colonna. Pranzo/Cena non hanno sotto-categorie da espandere.
function colazioneTotale(agg) {
  return (agg?.colazione || 0) + (agg?.colazione_extra || 0)
}
function valoreSotto(agg, code) {
  return code === 'colazione' ? colazioneTotale(agg) : (agg?.[code] || 0)
}

export default function TabConteggioPasti() {
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [struttura, setStruttura] = useState('')
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [espanso, setEspanso] = useState(null) // `${mese}_${sc}` oppure null (dettaglio colazione)

  const strutture = struttura ? [struttura] : STRUTTURE_HOTEL
  const totColonne = 2 + strutture.length * SOTTOCOLONNE.length

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/produzione/report/conteggio-pasti', {
        params: { anno, struttura_code: struttura || undefined },
      })
      setDati(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [anno, struttura])

  useEffect(() => { carica() }, [carica])

  const totaleAnnoSotto = (sc, code) => dati.mesi.reduce((s, mo) => s + valoreSotto(mo.per_struttura[sc], code), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        <NavAnno anno={anno} onChange={setAnno} />
        <SegmentedControl value={struttura} onChange={setStruttura} options={OPZIONI_STRUTTURA} />
        <span className="ui-text-muted">Clicca su Colazione per il dettaglio trattamento/extra</span>
      </div>

      {loading && <Loading />}

      {dati && (
        <Table>
          <thead>
            {/* Riga 1: strutture */}
            <tr>
              <Th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Mese</Th>
              {strutture.map(sc => (
                <Th key={sc} center gruppo colSpan={SOTTOCOLONNE.length}>{NOMI[sc]}</Th>
              ))}
              <Th num gruppo rowSpan={2} style={{ verticalAlign: 'bottom' }}>Totale pasti</Th>
            </tr>
            {/* Riga 2: colazione/pranzo/cena */}
            <tr className="sub">
              {strutture.map(sc => (
                SOTTOCOLONNE.map((code, i) => (
                  <Th key={`${sc}_${code}`} num gruppo={i === 0}>{LABEL_SOTTOCOLONNA[code]}</Th>
                ))
              ))}
            </tr>
          </thead>
          <tbody>
            {dati.mesi.map(mo => (
              <Fragment key={mo.mese}>
                <tr>
                  <Td style={{ fontWeight: 600 }}>{meseNome(mo.mese)}</Td>
                  {strutture.map(sc => {
                    const agg = mo.per_struttura[sc]
                    const chiave = `${mo.mese}_${sc}`
                    return SOTTOCOLONNE.map((code, i) => {
                      const v = valoreSotto(agg, code)
                      const cliccabile = code === 'colazione' && v > 0
                      return (
                        <Td key={`${sc}_${code}`} num gruppo={i === 0}
                          style={{
                            cursor: cliccabile ? 'pointer' : 'default',
                            color: v ? undefined : colors.borderStrong,
                            textDecoration: cliccabile ? 'underline dotted' : 'none',
                          }}
                          onClick={() => cliccabile && setEspanso(espanso === chiave ? null : chiave)}
                          title={cliccabile ? 'Clicca per il dettaglio trattamento/extra' : undefined}
                        >
                          {v || '—'}
                        </Td>
                      )
                    })
                  })}
                  <Td num gruppo style={{ fontWeight: 700 }}>{mo.totale.totale || 0}</Td>
                </tr>
                {strutture.map(sc => {
                  const chiave = `${mo.mese}_${sc}`
                  if (espanso !== chiave) return null
                  const agg = mo.per_struttura[sc] || {}
                  return (
                    <tr key={chiave} className="ui-riga-dettaglio">
                      <Td colSpan={totColonne}>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                          <span className="ui-text-muted">{NOMI[sc]} — {meseNome(mo.mese)}:</span>
                          <div><span style={{ color: colors.textMuted }}>Colazione trattamento: </span><strong>{agg.colazione || 0}</strong></div>
                          <div><span style={{ color: colors.textMuted }}>Colazione extra: </span><strong>{agg.colazione_extra || 0}</strong></div>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
            <tr className="ui-riga-totale">
              <Td>ANNO</Td>
              {strutture.map(sc => (
                SOTTOCOLONNE.map((code, i) => (
                  <Td key={`tot_${sc}_${code}`} num gruppo={i === 0}>{totaleAnnoSotto(sc, code) || 0}</Td>
                ))
              ))}
              <Td num gruppo>{dati.totale_anno.totale || 0}</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </div>
  )
}
