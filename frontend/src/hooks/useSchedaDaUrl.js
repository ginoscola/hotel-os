// Scheda di una pagina a schede scelta dall'indirizzo: `/tesoreria?tab=import` apre "Import e saldi".
// Usato dai link delle Attività ricorrenti per portare dove si fa l'attività. Senza `?tab=` la pagina resta com'è
// (ultima scheda usata). Dopo l'uso il parametro viene tolto dall'indirizzo, così una ricarica non torna lì.
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Scheda chiesta dall'indirizzo, se è tra quelle visibili (per lo stato iniziale, prima del primo disegno). */
export function schedaRichiesta(tabs) {
  try {
    const id = new URLSearchParams(window.location.search).get('tab')
    return tabs.some(t => t.id === id) ? id : null
  } catch {
    return null
  }
}

/** Apre la scheda chiesta con `?tab=` (anche se la pagina è già aperta) e toglie il parametro. */
export function useSchedaDaUrl(tabs, cambia) {
  const [params, setParams] = useSearchParams()
  const richiesta = params.get('tab')
  useEffect(() => {
    if (!richiesta) return
    if (tabs.some(t => t.id === richiesta)) cambia(richiesta)
    setParams(p => { p.delete('tab'); return p }, { replace: true })
  }, [richiesta]) // eslint-disable-line react-hooks/exhaustive-deps -- solo quando cambia il parametro
}
