// Conferme e avvisi temporanei dell'app — sostituiscono window.confirm() / alert().
//
//   const conferma = useConferma()
//   if (!(await conferma({ titolo: 'Eliminare il movimento?', pericolo: true }))) return
//
//   const avvisi = useAvvisi()
//   avvisi.successo('Valori salvati')          // sparisce da solo
//   avvisi.errore(mostraErrore(e))             // resta finché non si chiude
//
// <UiProvider> è montato una sola volta in App.jsx.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal.jsx'
import { cx } from './classi.js'

const ConfermaCtx = createContext(null)
const AvvisiCtx = createContext(null)

const DURATA_AVVISO_MS = 4000

function DialogoConferma({ opz, onEsito }) {
  const ritardo = opz.ritardoMs ?? 0
  const [attivo, setAttivo] = useState(ritardo === 0)
  const btnRef = useRef(null)

  useEffect(() => {
    if (ritardo === 0) return
    const t = setTimeout(() => setAttivo(true), ritardo)
    return () => clearTimeout(t)
  }, [ritardo])

  useEffect(() => { if (attivo) btnRef.current?.focus() }, [attivo])

  return (
    <Modal
      titolo={opz.titolo ?? 'Confermi?'}
      onChiudi={() => onEsito(false)}
      footer={<>
        <button className="ui-btn ui-btn-secondary" onClick={() => onEsito(false)}>
          {opz.annullaLabel ?? 'Annulla'}
        </button>
        <button
          ref={btnRef}
          className={cx('ui-btn', opz.pericolo ? 'ui-btn-danger' : 'ui-btn-primary')}
          disabled={!attivo}
          onClick={() => onEsito(true)}
        >
          {opz.confermaLabel ?? (opz.pericolo ? 'Elimina' : 'Conferma')}
        </button>
      </>}
    >
      {opz.messaggio}
    </Modal>
  )
}

export function UiProvider({ children }) {
  const [dialogo, setDialogo] = useState(null) // { opz, resolve }
  const [avvisi, setAvvisi] = useState([])
  const idRef = useRef(0)

  /** opz: { titolo, messaggio, confermaLabel, annullaLabel, pericolo, ritardoMs } → Promise<boolean> */
  const conferma = useCallback((opz = {}) => new Promise(resolve => {
    setDialogo({ opz: typeof opz === 'string' ? { titolo: opz } : opz, resolve })
  }), [])

  const chiudiDialogo = (esito) => {
    dialogo?.resolve(esito)
    setDialogo(null)
  }

  const rimuovi = useCallback((id) => setAvvisi(a => a.filter(x => x.id !== id)), [])

  const aggiungi = useCallback((tipo, testo, persistente) => {
    const id = ++idRef.current
    setAvvisi(a => [...a, { id, tipo, testo }])
    if (!persistente) setTimeout(() => rimuovi(id), DURATA_AVVISO_MS)
  }, [rimuovi])

  const apiAvvisi = useMemo(() => ({
    successo:   (t) => aggiungi('ok', t, false),
    info:       (t) => aggiungi('info', t, false),
    attenzione: (t) => aggiungi('warn', t, true),
    errore:     (t) => aggiungi('err', t, true),
  }), [aggiungi])

  return (
    <ConfermaCtx.Provider value={conferma}>
      <AvvisiCtx.Provider value={apiAvvisi}>
        {children}
        {dialogo && <DialogoConferma opz={dialogo.opz} onEsito={chiudiDialogo} />}
        {avvisi.length > 0 && (
          <div className="ui-toasts" aria-live="polite">
            {avvisi.map(a => (
              <div key={a.id} className={cx('ui-toast', `ui-toast-${a.tipo}`)} role={a.tipo === 'err' ? 'alert' : 'status'}>
                <div className="ui-msg-testo">{a.testo}</div>
                <button className="ui-msg-chiudi" onClick={() => rimuovi(a.id)} aria-label="Chiudi">×</button>
              </div>
            ))}
          </div>
        )}
      </AvvisiCtx.Provider>
    </ConfermaCtx.Provider>
  )
}

export function useConferma() {
  const c = useContext(ConfermaCtx)
  if (!c) throw new Error('useConferma() richiede <UiProvider> (App.jsx)')
  return c
}

export function useAvvisi() {
  const c = useContext(AvvisiCtx)
  if (!c) throw new Error('useAvvisi() richiede <UiProvider> (App.jsx)')
  return c
}
