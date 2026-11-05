// IVA mese per mese (Fase 5): liquidazione stimata da vendite (Corrispettivi) e acquisti (fatture SDI) con il credito
// riportato, confronto con il versato. Nel calendario fiscale la stima vale per i mesi conclusi con dati completi;
// i mesi futuri restano "ultimo agosto versato" (scelta dell'utente). Mostrata in fondo alla scheda Impegni.
import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { formatData, formatEuro, mostraErrore } from '../../utils/format.js'
import { Badge, Loading, Messaggio, NavAnno, SezioneApribile, Table, Td, Th } from '../../components/ui'
import { Importo, MESI_BREVI } from './helpers.jsx'

const LS_APERTA = 'tesoreria_iva_aperta'

export default function CardIva() {
  const [aperta, setAperta] = useState(() => { try { return localStorage.getItem(LS_APERTA) === '1' } catch { return false } })
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    if (!aperta) return
    let annullato = false
    setDati(null); setErrore(null)
    api.get('/tesoreria/iva', { params: { anno } })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [anno, aperta])

  const cambia = () => setAperta(a => {
    try { localStorage.setItem(LS_APERTA, a ? '0' : '1') } catch { /* preferenza non salvata */ }
    return !a
  })

  return (
    <SezioneApribile titolo="IVA mese per mese (stima)" nota="vendite dai Corrispettivi, acquisti dalle fatture SDI"
      aperta={aperta} onToggle={cambia} azioni={aperta ? <NavAnno anno={anno} onChange={setAnno} /> : null}>
      <Messaggio>{errore}</Messaggio>
      {!dati ? (!errore && <Loading />) : (
        <>
          <p className="ui-text-muted" style={{ marginBottom: 8 }}>
            IVA sulle vendite − IVA sugli acquisti (mese di ricezione della fattura) + credito del mese prima: si versa il 16
            del mese dopo solo se a debito. Nel calendario la stima vale per i mesi conclusi con dati completi; per i mesi
            futuri resta l'ultimo agosto versato. Le fatture SDI non comprendono tutti gli acquisti con IVA (sul 2025 circa il
            9% in meno della dichiarazione): la stima tende a sopravvalutare il dovuto.
            {dati.ultima_fattura && <> Ultima fattura ricevuta: {formatData(dati.ultima_fattura)}.</>}
          </p>
          <Table compact>
            <thead>
              <tr><Th>Mese</Th><Th num>IVA vendite</Th><Th num>IVA acquisti</Th><Th num>Credito riportato</Th><Th num>Saldo</Th>
                <Th num tot>Da versare (stima)</Th><Th>Entro il</Th><Th num>Versato</Th><Th num>Scarto</Th></tr>
            </thead>
            <tbody>
              {dati.mesi.map(m => (
                <tr key={m.mese} className={m.completo ? undefined : 'ui-riga-attenuata'}>
                  <Td>{MESI_BREVI[m.mese - 1]} {!m.completo && <Badge>dati incompleti</Badge>}</Td>
                  <Td num><Importo v={m.vendite} /></Td><Td num><Importo v={m.acquisti} /></Td>
                  <Td num>{m.credito_precedente == null ? '—' : <Importo v={m.credito_precedente} />}</Td>
                  <Td num>{m.saldo == null ? '—' : <Importo v={m.saldo} />}</Td>
                  <Td num tot>{m.versamento == null ? '—' : m.versamento > 0 ? formatEuro(m.versamento) : 'a credito'}</Td>
                  <Td>{formatData(m.scadenza)}</Td>
                  <Td num>{m.versato == null ? '—' : formatEuro(m.versato)}</Td>
                  <Td num>{m.scarto == null ? '—' : <Importo v={m.scarto} />}</Td>
                </tr>
              ))}
              <tr className="ui-riga-totale">
                <Td>Anno</Td><Td num>{formatEuro(dati.totale_vendite)}</Td><Td num>{formatEuro(dati.totale_acquisti)}</Td>
                <Td colSpan={6}>{dati.credito_fine_anno != null ? `Credito stimato a fine anno: ${formatEuro(dati.credito_fine_anno)} (solo confronto: in F24 vale quello della dichiarazione)` : ''}</Td>
              </tr>
            </tbody>
          </Table>
        </>
      )}
    </SezioneApribile>
  )
}
