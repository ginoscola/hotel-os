import { Fragment, useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { formatEuro } from '../../utils/format'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import { STRUTTURE_HOTEL, NOMI, meseNome, campoValore, OPZIONI_STRUTTURA } from '../../utils/produzioneHelpers'
import { Loading, NavAnno, SegmentedControl, Table, Td, Th } from '../../components/ui'
import { colors } from '../../styles/tokens.js'

export default function TabReportMensile({ lordo }) {
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [struttura, setStruttura] = useState('')
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [espanso, setEspanso] = useState(null) // `${mese}_${sc}` oppure null

  const strutture = struttura ? [struttura] : STRUTTURE_HOTEL

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/produzione/report/mensile', {
        params: { anno, struttura_code: struttura || undefined },
      })
      setDati(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [anno, struttura])

  useEffect(() => { carica() }, [carica])

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        <NavAnno anno={anno} onChange={setAnno} />
        <SegmentedControl value={struttura} onChange={setStruttura} options={OPZIONI_STRUTTURA} />
        <span className="ui-text-muted">Clicca su un importo per il dettaglio per categoria</span>
        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu url={`/produzione/export/mensile?anno=${anno}${struttura ? `&struttura_code=${struttura}` : ''}`}
            nome={`produzione_mensile_${anno}`} />
        </div>
      </div>

      {loading && <Loading />}

      {dati && (
        <Table>
          <thead>
            <tr>
              <Th>Mese</Th>
              {strutture.map(sc => <Th key={sc} num>{NOMI[sc]}</Th>)}
              <Th num tot>Totale</Th>
            </tr>
          </thead>
          <tbody>
            {dati.mesi.map(mo => (
              <Fragment key={mo.mese}>
                <tr>
                  <Td style={{ fontWeight: 600 }}>{meseNome(mo.mese)}</Td>
                  {strutture.map(sc => {
                    const v = campoValore(mo.per_struttura[sc]?.totale, lordo)
                    const chiave = `${mo.mese}_${sc}`
                    return (
                      <Td key={sc} num style={{ cursor: v ? 'pointer' : 'default', color: v ? undefined : colors.borderStrong }}
                        onClick={() => v && setEspanso(espanso === chiave ? null : chiave)}>
                        {v ? formatEuro(v) : '—'}
                      </Td>
                    )
                  })}
                  <Td num tot style={{ fontWeight: 700 }}>{formatEuro(campoValore(mo.totale, lordo))}</Td>
                </tr>
                {strutture.map(sc => {
                  const chiave = `${mo.mese}_${sc}`
                  if (espanso !== chiave) return null
                  const perCat = mo.per_struttura[sc]?.per_categoria || {}
                  return (
                    <tr key={chiave} className="ui-riga-dettaglio">
                      <Td colSpan={strutture.length + 2}>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                          <span className="ui-text-muted">{NOMI[sc]} — {meseNome(mo.mese)}:</span>
                          {Object.entries(perCat).map(([code, agg]) => (
                            <div key={code}>
                              <span style={{ color: colors.textMuted }}>{code}: </span>
                              <strong className="ui-num">{formatEuro(campoValore(agg, lordo))}</strong>
                            </div>
                          ))}
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
                <Td key={sc} num>
                  {formatEuro(dati.mesi.reduce((s, mo) => s + campoValore(mo.per_struttura[sc]?.totale, lordo), 0))}
                </Td>
              ))}
              <Td num tot>{formatEuro(campoValore(dati.totale_anno, lordo))}</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </div>
  )
}
