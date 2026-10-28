// Helper condivisi del modulo Tesoreria: permessi, date locali, importi, elenchi di conti e
// categorie, e il modale di creazione/modifica regola (usato da Movimenti e da Admin → Regole).
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { getPermessiModuli } from '../../components/ProtectedRoute.jsx'
import { colors } from '../../styles/tokens.js'
import { formatEuro, mostraErrore } from '../../utils/format.js'
import { isAdmin } from '../../utils/auth.js'
import {
  Badge, Button, Field, Input, Messaggio, Modal, Select, Table, Td, Textarea, Th, useAvvisi,
} from '../../components/ui'

export const MODULO = 'tesoreria'

/** Permessi dell'utente sul modulo (admin sempre tutto, come il backend). */
export function permessiTesoreria() {
  if (isAdmin()) return { puo_vedere: true, puo_modificare: true, puo_importare: true }
  const p = getPermessiModuli()?.[MODULO] || {}
  return { puo_vedere: !!p.puo_vedere, puo_modificare: !!p.puo_modificare, puo_importare: !!p.puo_importare }
}

/** Data locale in formato ISO (mai toISOString: in Italia la mezzanotte diventa il giorno prima in UTC). */
export function isoLocale(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const oggiISO = () => isoLocale(new Date())

/** Importo in euro, rosso se negativo. */
export function Importo({ v, forte }) {
  if (v == null) return <span style={{ color: colors.textSubtle }}>—</span>
  return (
    <span className="ui-num" style={{ color: v < 0 ? colors.danger : undefined, fontWeight: forte ? 600 : undefined }}>
      {formatEuro(v)}
    </span>
  )
}

export function BadgeCategoria({ nome, colore, manuale }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <Badge colore={colore || undefined}>{nome || 'Da classificare'}</Badge>
      {manuale && <Badge tono="warn" title="Categoria assegnata a mano: le regole non la cambiano">manuale</Badge>}
    </span>
  )
}

export const ETICHETTE_TIPO_CONTO = {
  conto: 'Conto corrente', carta_credito: 'Carta di credito', prepagata: 'Prepagata', cassa: 'Cassa',
}
export const ETICHETTE_SEGNO = { entrata: 'Solo entrate', uscita: 'Solo uscite', entrambi: 'Entrate e uscite' }

/** Conti e categorie, ricaricabili. */
export function useAnagrafiche() {
  const [conti, setConti] = useState([])
  const [categorie, setCategorie] = useState([])
  const avvisi = useAvvisi()
  const carica = useCallback(async () => {
    try {
      const [c, k] = await Promise.all([api.get('/tesoreria/conti'), api.get('/tesoreria/categorie')])
      setConti(c.data)
      setCategorie(k.data)
    } catch (e) { avvisi.errore(mostraErrore(e)) }
  }, [avvisi])
  useEffect(() => { carica() }, [carica])
  return { conti, categorie, ricarica: carica }
}

export function SelectCategoria({ categorie, value, onChange, vuota = '— scegli —', soloAttive = true, ...rest }) {
  return (
    <Select value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} {...rest}>
      {vuota != null && <option value="">{vuota}</option>}
      {categorie.filter(c => !soloAttive || c.attivo || c.id === value).map(c => (
        <option key={c.id} value={c.id}>{c.nome}{c.attivo ? '' : ' (disattivata)'}</option>
      ))}
    </Select>
  )
}

const righe = testo => testo.split('\n').map(s => s.trim()).filter(Boolean)

/**
 * Modale regola: `iniziale` = regola esistente (con id) o proposta (senza id).
 * Prima di salvare si può provare l'effetto sui movimenti reali. Salvataggio con ricalcolo.
 */
export function ModaleRegola({ iniziale, categorie, onChiudi, onSalvata }) {
  const [r, setR] = useState(() => ({
    categoria_id: iniziale?.categoria_id ?? null,
    campo: iniziale?.campo || 'descrizione',
    operatore: iniziale?.operatore || 'contiene',
    valori: (iniziale?.valori || []).join('\n'),
    valori_anche: (iniziale?.valori_anche || []).join('\n'),
    segno: iniziale?.segno || 'entrambi',
    priorita: iniziale?.priorita ?? '',
    note: iniziale?.note || '',
    attiva: iniziale?.attiva ?? true,
  }))
  const [prova, setProva] = useState(null)
  const [errore, setErrore] = useState(null)
  const [lavoro, setLavoro] = useState(false)
  const avvisi = useAvvisi()
  const set = patch => { setR(prev => ({ ...prev, ...patch })); setProva(null) }

  const corpo = () => ({
    ...r, id: iniziale?.id, valori: righe(r.valori), valori_anche: righe(r.valori_anche),
    priorita: r.priorita === '' ? undefined : Number(r.priorita),
  })

  async function provaRegola() {
    setLavoro(true); setErrore(null)
    try {
      const b = corpo()
      if (b.priorita === undefined) b.priorita = 999999
      setProva((await api.post('/tesoreria/regole/prova', b)).data)
    } catch (e) { setErrore(mostraErrore(e)) } finally { setLavoro(false) }
  }

  async function salva() {
    setLavoro(true); setErrore(null)
    try {
      const b = { ...corpo(), ricalcola: true }
      const res = iniziale?.id ? await api.put(`/tesoreria/regole/${iniziale.id}`, b) : await api.post('/tesoreria/regole', b)
      avvisi.successo(`Regola salvata: ${res.data.ricalcolo?.n_cambiati ?? 0} movimenti riclassificati`)
      onSalvata()
    } catch (e) { setErrore(mostraErrore(e)) } finally { setLavoro(false) }
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={onChiudi}>Annulla</Button>
      <Button variant="secondary" onClick={provaRegola} disabled={lavoro || !righe(r.valori).length}>Prova sui movimenti</Button>
      <Button onClick={salva} disabled={lavoro || !r.categoria_id || !righe(r.valori).length}>Salva e ricalcola</Button>
    </>
  )

  return (
    <Modal titolo={iniziale?.id ? 'Modifica regola' : 'Nuova regola'} onChiudi={onChiudi} footer={footer}
      larghezza={760} chiudiSuSfondo={false}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Categoria" style={{ gridColumn: 'span 3' }}>
          <SelectCategoria categorie={categorie} value={r.categoria_id} onChange={v => set({ categoria_id: v })} />
        </Field>
        <Field label="Campo">
          <Select value={r.campo} onChange={e => set({ campo: e.target.value })}>
            <option value="descrizione">Descrizione</option>
            <option value="controparte">Controparte (nome)</option>
          </Select>
        </Field>
        <Field label="Confronto">
          <Select value={r.operatore} onChange={e => set({ operatore: e.target.value })}>
            <option value="inizia">Inizia con</option>
            <option value="contiene">Contiene</option>
          </Select>
        </Field>
        <Field label="Movimenti">
          <Select value={r.segno} onChange={e => set({ segno: e.target.value })}>
            {Object.entries(ETICHETTE_SEGNO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Valori (uno per riga, basta uno)" style={{ gridColumn: 'span 2' }}>
          <Textarea rows={3} value={r.valori} onChange={e => set({ valori: e.target.value })} />
        </Field>
        <Field label="E contiene anche (facoltativo)">
          <Textarea rows={3} value={r.valori_anche} onChange={e => set({ valori_anche: e.target.value })} />
        </Field>
        <Field label="Priorità (più bassa = vince)">
          <Input type="number" value={r.priorita} placeholder="in fondo" onChange={e => set({ priorita: e.target.value })} />
        </Field>
        <Field label="Note" style={{ gridColumn: 'span 2' }}>
          <Input value={r.note} onChange={e => set({ note: e.target.value })} />
        </Field>
      </div>
      <p className="ui-text-muted" style={{ marginTop: 8 }}>
        Maiuscole e spazi doppi non contano. I movimenti classificati a mano non vengono mai cambiati.
      </p>
      <Messaggio>{errore}</Messaggio>
      {prova && (
        <div style={{ marginTop: 12 }}>
          <Messaggio tipo="info">
            Corrisponde a <b>{prova.n_corrispondenti}</b> movimenti ({formatEuro(prova.importo_corrispondenti)}):{' '}
            <b>{prova.n_cambierebbero}</b> cambierebbero categoria
            {prova.da_categorie.length > 0 && <> (da {prova.da_categorie.map(d => `${d.categoria} ${d.n}`).join(', ')})</>}
            {prova.n_manuali > 0 && <>, {prova.n_manuali} classificati a mano restano com'erano</>}.
          </Messaggio>
          {prova.esempi.length > 0 && (
            <Table compact maxHeight="30vh">
              <thead><tr><Th>Data</Th><Th>Descrizione</Th><Th num>Importo</Th><Th>Categoria attuale</Th></tr></thead>
              <tbody>
                {prova.esempi.map(m => (
                  <tr key={m.id}>
                    <Td>{m.data_contabile.split('-').reverse().join('/')}</Td>
                    <Td style={{ maxWidth: 360 }}>{m.descrizione}</Td>
                    <Td num><Importo v={m.importo} /></Td>
                    <Td><BadgeCategoria nome={m.categoria_nome} colore={m.categoria_colore} manuale={m.categoria_manuale} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </Modal>
  )
}
