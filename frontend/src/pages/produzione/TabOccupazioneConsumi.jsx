import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { NOMI, isAdmin } from '../../utils/produzioneHelpers'
import { formatN, mostraErrore } from '../../utils/format'
import { Badge, Input, Loading, NavAnno, SegmentedControl, Table, Td, Th, useAvvisi } from '../../components/ui'
import { colors } from '../../styles/tokens.js'

// Du Parc e Mare Mosso sono una struttura sola (DPH), come nel Conto Economico USALI
const STRUTTURE = ['DPH', 'CLB', 'INT', 'BON']
const OPZIONI = STRUTTURE.map(sc => ({ value: sc, label: sc === 'DPH' ? 'Du Parc + Mare Mosso' : NOMI[sc] }))
const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
const LS_STRUTTURA = 'prod_occupazione_struttura'

/**
 * Cella modificabile (solo admin). L'input contiene solo il valore inserito a mano: per le voci
 * automatiche il valore calcolato compare come placeholder grigio; scrivere un numero lo
 * sostituisce (viola), svuotare il campo ripristina il calcolo automatico.
 */
function CellaInput({ cella, auto, onSalva }) {
  const iniziale = cella.manuale ?? ''
  const [testo, setTesto] = useState(String(iniziale))
  useEffect(() => { setTesto(String(cella.manuale ?? '')) }, [cella.manuale])

  const salva = () => {
    const pulito = testo.trim().replace(',', '.')
    if (pulito === String(iniziale)) return
    if (pulito !== '' && (isNaN(Number(pulito)) || Number(pulito) < 0)) {
      setTesto(String(iniziale))
      return
    }
    onSalva(pulito === '' ? null : Number(pulito))
  }
  const corretto = auto && cella.manuale != null
  return (
    <Input
      value={testo}
      inputMode="decimal"
      placeholder={cella.automatico != null ? String(cella.automatico) : ''}
      onChange={e => setTesto(e.target.value)}
      onBlur={salva}
      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      title={corretto ? `Corretto a mano (automatico: ${formatN(cella.automatico)}) — svuota per ripristinare` : undefined}
      style={{
        width: 76, textAlign: 'right', padding: '4px 6px',
        ...(corretto ? { color: colors.accent, borderColor: colors.accent, background: colors.accentSoft } : {}),
      }}
    />
  )
}

export default function TabOccupazioneConsumi() {
  const admin = isAdmin()
  const avvisi = useAvvisi()
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [struttura, setStruttura] = useState(() => {
    const v = localStorage.getItem(LS_STRUTTURA)
    return STRUTTURE.includes(v) ? v : 'DPH'
  })
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/produzione/occupazione-consumi', { params: { struttura, anno } })
      setDati(data)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
    finally { setLoading(false) }
  }, [struttura, anno]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carica() }, [carica])

  const cambiaStruttura = (sc) => {
    setStruttura(sc)
    localStorage.setItem(LS_STRUTTURA, sc)
  }

  const salva = async (voce, mese, valore) => {
    try {
      await api.put('/produzione/occupazione-consumi', {
        struttura_code: struttura, anno, mese, voce_code: voce.voce_code, valore,
      })
      await carica()
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <NavAnno anno={anno} onChange={setAnno} />
        <SegmentedControl value={struttura} onChange={cambiaStruttura} options={OPZIONI} />
      </div>
      <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 16 }}>
        <Badge tono="info">auto</Badge> = calcolato da Revenue, prenotazioni Welcome e conteggio pasti
        {admin && <> (in grigio; scrivi un numero per correggerlo — in <span style={{ color: colors.accent }}>viola</span> — svuota il campo per tornare al calcolo)</>}.
        {' '}Le altre voci si inseriscono a mano.
        {struttura !== 'BON' && <> Presenze ristorante = solo ospiti dell'hotel (pranzi e cene dal conteggio pasti){struttura === 'DPH' && ', senza i clienti esterni del Mare Mosso'}.</>}
      </p>

      {loading && !dati && <Loading />}

      {dati && (
        <Table>
          <thead>
            <tr>
              <Th>Reparto</Th>
              <Th>Dato di occupazione o consumo</Th>
              {MESI.map(m => <Th key={m} num>{m}</Th>)}
              <Th num tot>Totale</Th>
            </tr>
          </thead>
          <tbody>
            {dati.voci.map(voce => {
              const auto = voce.tipo === 'auto'
              return (
                <tr key={voce.voce_code}>
                  <Td style={{ whiteSpace: 'nowrap' }}>{voce.reparto}</Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    {voce.dato} {auto && <Badge tono="info">auto</Badge>}
                  </Td>
                  {voce.mesi.map(cella => (
                    <Td key={cella.mese} num style={{ padding: admin ? '3px 4px' : undefined }}>
                      {admin
                        ? <CellaInput cella={cella} auto={auto} onSalva={v => salva(voce, cella.mese, v)} />
                        : <span style={auto && cella.manuale != null ? { color: colors.accent } : undefined}>
                            {formatN(cella.valore)}
                          </span>}
                    </Td>
                  ))}
                  <Td num tot style={{ fontWeight: 600 }}>{formatN(voce.totale)}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
