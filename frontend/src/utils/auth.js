/** Legge il ruolo dell'utente corrente da localStorage (impostato al login). */
export function isAdmin() {
  try { return JSON.parse(localStorage.getItem('auth_user') || '{}').ruolo === 'admin' } catch { return false }
}
