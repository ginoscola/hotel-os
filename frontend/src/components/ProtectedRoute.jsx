import { Navigate, useLocation, useNavigate } from 'react-router-dom'

/**
 * Legge l'utente corrente da localStorage.
 * Restituisce { username, ruolo } o null se non loggato.
 */
export function getUtenteCorrente() {
  try {
    const token = localStorage.getItem('auth_token')
    const user = localStorage.getItem('auth_user')
    if (!token || !user) return null

    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      return null
    }
    return JSON.parse(user)
  } catch {
    return null
  }
}

/**
 * Legge i permessi modulo salvati in localStorage dopo il login.
 * Formato: { revenue: { puo_vedere, puo_modificare, puo_importare }, ... }
 */
export function getPermessiModuli() {
  try {
    const raw = localStorage.getItem('moduli_permessi')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Verifica se l'utente può vedere il modulo indicato.
 * Se i permessi non sono ancora caricati (null) lascia passare
 * per evitare flash di "accesso negato" durante il caricamento.
 */
export function puoVedereModulo(moduleCode) {
  const permessi = getPermessiModuli()
  if (!permessi) return true
  return permessi[moduleCode]?.puo_vedere !== false
}

/**
 * Protegge una route: se non loggato → /login, se ruolo insufficiente → 403,
 * se modulo senza puo_vedere → pagina accesso modulo negato.
 *
 * Props:
 *   - ruoloRichiesto: 'admin' | undefined
 *   - moduleCode: code del modulo (es. 'budget') da verificare in module_permissions
 */
export default function ProtectedRoute({ children, ruoloRichiesto, moduleCode }) {
  const location = useLocation()
  const utente = getUtenteCorrente()

  if (!utente) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (ruoloRichiesto === 'admin' && utente.ruolo !== 'admin') {
    return <PaginaAccesoNegato
      titolo="Accesso non autorizzato"
      messaggio="Questa sezione è riservata agli amministratori."
    />
  }

  if (moduleCode && !puoVedereModulo(moduleCode)) {
    return <PaginaAccesoNegato
      titolo="Accesso al modulo non autorizzato"
      messaggio="Non hai i permessi per accedere a questo modulo. Contatta un amministratore."
    />
  }

  return children
}

function PaginaAccesoNegato({ titolo, messaggio }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', gap: '1rem', color: '#374151',
    }}>
      <div style={{ fontSize: 64, lineHeight: 1 }}>403</div>
      <h2 style={{ margin: 0, color: '#dc2626' }}>{titolo}</h2>
      <p style={{ color: '#6b7280', margin: 0 }}>{messaggio}</p>
      <a href="/dashboard/gruppo"
        style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
        ← Torna alla dashboard
      </a>
    </div>
  )
}
