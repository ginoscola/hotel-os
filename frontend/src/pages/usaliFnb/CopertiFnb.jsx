// Coperti mensili inseriti a mano: Mare Mosso (totale dal gestionale Menu, ospiti Du Parc compresi)
// e Buona Onda (numero di scontrini). Clienti esterni MMS = coperti Menu − pasti ospiti Du Parc.
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { isAdmin } from '../../utils/auth.js'
import { formatN, mostraErrore } from '../../utils/format.js'
import { Card, Input, Loading, Messaggio, Table, Td, Th, useAvvisi } from '../../components/ui'
import { colors } from '../../styles/tokens.js'
import { MESI_LUNGHI } from '../usaliContabile/helpers.jsx'

function CellaNumero({ valore, onSalva }) {
  const [testo, setTesto] = useState(valore == null ? '' : String(valore))
  useEffect(() => { setTesto(valore == null ? '' : String(valore)) }, [valore])

  const salva = () => {
    const pulito = testo.trim().replace(/\./g, '')
    const prima = valore == null ? '' : String(valore)
    if (pulito === prima) return
    if (pulito !== '' && !/^\d+$/.test(pulito)) {
      setTesto(prima)
      return
    }
    onSalva(pulito === '' ? null : Number(pulito))
  }
  return (
    <Input value={testo} inputMode="numeric" onChange={e => setTesto(e.target.value)} onBlur={salva}
      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      style={{ width: 90, textAlign: 'right', padding: '4px 6px' }} />
  )
}

export default function CopertiFnb({ anno, onSalvato }) {
  const admin = isAdmin()
  const avvisi = useAvvisi()
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)

  const carica = useCallback(async () => {
    setErrore(null)
    try {
      const { data } = await api.get('/usali/fnb/coperti', { params: { anno } })
      setDati(data)
    } catch (e) {
      setDati(null)
      setErrore(mostraErrore(e))
    }
  }, [anno])

  useEffect(() => { carica() }, [carica])

  async function salva(struttura_code, mese, valore) {
    try {
      await api.put('/usali/fnb/coperti', { struttura_code, anno, mese, valore })
      await carica()
      onSalvato?.()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    }
  }

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

  const valore = (v) => (v == null ? <span style={{ color: colors.textSubtle }}>—</span> : formatN(v))
  const tot = (k) => dati.mesi.reduce((s, m) => s + (m[k] ?? 0), 0)

  return (
    <Card title={`Coperti ${anno}`}>
      <Table compact>
        <thead>
          <tr>
            <Th>Mese</Th>
            <Th num gruppo title="Totale dal gestionale Menu, ospiti Du Parc compresi">Mare Mosso — coperti Menu</Th>
            <Th num title="Pranzi e cene degli ospiti Du Parc addebitati in Welcome (Produzione)">di cui ospiti Du Parc</Th>
            <Th num title="Coperti Menu − pasti ospiti Du Parc">Clienti esterni</Th>
            <Th num gruppo>Buona Onda — scontrini</Th>
          </tr>
        </thead>
        <tbody>
          {dati.mesi.map(m => {
            const negativo = m.mms_esterni != null && m.mms_esterni < 0
            return (
              <tr key={m.mese} className={negativo ? 'ui-riga-errore' : undefined}>
                <Td>{MESI_LUNGHI[m.mese - 1]}</Td>
                <Td num gruppo>
                  {admin ? <CellaNumero valore={m.mms_coperti} onSalva={v => salva('MMS', m.mese, v)} /> : valore(m.mms_coperti)}
                </Td>
                <Td num>{m.ospiti_dph ? formatN(m.ospiti_dph) : valore(null)}</Td>
                <Td num title={negativo ? 'Coperti Menu inferiori ai pasti degli ospiti: verificare' : undefined}>
                  {valore(m.mms_esterni)}
                </Td>
                <Td num gruppo>
                  {admin ? <CellaNumero valore={m.bon_scontrini} onSalva={v => salva('BON', m.mese, v)} /> : valore(m.bon_scontrini)}
                </Td>
              </tr>
            )
          })}
          <tr className="ui-riga-totale">
            <Td>Totale</Td>
            <Td num gruppo>{formatN(tot('mms_coperti'))}</Td>
            <Td num>{formatN(tot('ospiti_dph'))}</Td>
            <Td num>{formatN(tot('mms_esterni'))}</Td>
            <Td num gruppo>{formatN(tot('bon_scontrini'))}</Td>
          </tr>
        </tbody>
      </Table>
      <div style={{ marginTop: 8, fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>
        Mare Mosso: il totale del gestionale Menu comprende anche gli ospiti Du Parc ed è quasi tutto
        cena. Buona Onda: numero di scontrini del mese (dalle chiusure giornaliere), usato al posto dei
        coperti. {admin ? 'Svuotare una cella per cancellare il valore.' : ''}
      </div>
    </Card>
  )
}
