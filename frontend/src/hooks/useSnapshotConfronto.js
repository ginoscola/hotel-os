import { useMemo } from 'react'
import { addDays } from '../utils/format.js'

/**
 * Calcola la snapshot di confronto in base al flag attivo.
 * Usato da DashboardHotel e DashboardGruppo.
 *
 * @param {object[]} snapshots - lista snapshot ordinate dalla più recente
 * @param {number}   snapIdx   - indice snapshot corrente
 * @param {boolean}  confrontaPrevSett  - confronta snapshot precedente
 * @param {boolean}  confrontaPrevAnno  - confronta anno precedente (−364 gg, tolleranza 30 gg)
 * @returns {object|null} snapshot di confronto, o null se non disponibile
 */
export function useSnapshotConfronto({ snapshots, snapIdx, confrontaPrevSett, confrontaPrevAnno }) {
  return useMemo(() => {
    const currentSnap = snapshots[snapIdx] || null
    if (!currentSnap) return null

    if (confrontaPrevSett) {
      return snapshots[snapIdx + 1] || null
    }

    if (confrontaPrevAnno) {
      const targetDate = addDays(currentSnap.snapshot_date, -364)
      const target = new Date(targetDate + 'T00:00:00')
      const closest = snapshots.reduce((best, s) => {
        if (!best) return s
        const diff = Math.abs(new Date(s.snapshot_date + 'T00:00:00') - target)
        const bestDiff = Math.abs(new Date(best.snapshot_date + 'T00:00:00') - target)
        return diff < bestDiff ? s : best
      }, null)
      if (!closest) return null
      const diffDays = Math.abs(
        (new Date(closest.snapshot_date + 'T00:00:00') - target) / 86400000
      )
      return diffDays <= 30 ? closest : null
    }

    return null
  }, [snapshots, snapIdx, confrontaPrevSett, confrontaPrevAnno])
}
