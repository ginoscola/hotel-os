import { useEffect, useState } from 'react';
import api from '../api/client';
import { Badge, Button, Field, Input, Loading, PageHeader, useAvvisi } from '../components/ui';
import { colors } from '../styles/tokens.js';

export default function AdminCentriDiCosto() {
  const [albero, setAlbero] = useState([]);
  const [loading, setLoading] = useState(true);
  const avvisi = useAvvisi();

  // Modifica inline: { id, code, name }
  const [editando, setEditando] = useState(null);

  // Form aggiunta: { tipo: 'categoria'|'reparto', parentId, strutturaCod }
  const [formAperto, setFormAperto] = useState(null);
  const [formDati, setFormDati] = useState({ code: '', name: '' });

  useEffect(() => { caricaAlbero(); }, []);

  async function caricaAlbero() {
    setLoading(true);
    try {
      const r = await api.get('/cost-centers/albero');
      setAlbero(r.data);
    } catch {
      avvisi.errore('Errore caricamento centri di costo');
    } finally {
      setLoading(false);
    }
  }

  // Esito delle azioni come avviso temporaneo (successo) o persistente (errore)
  function mostraMsg(tipo, testo) {
    if (tipo === 'ok') avvisi.successo(testo);
    else avvisi.errore(testo);
  }

  async function rinomina(id) {
    if (!editando?.name?.trim()) { mostraMsg('errore', 'Il nome non può essere vuoto'); return; }
    if (editando.code !== undefined && !editando.code.trim()) { mostraMsg('errore', 'Il codice non può essere vuoto'); return; }
    try {
      const payload = { name: editando.name.trim() };
      if (editando.code !== undefined) payload.code = editando.code.trim().toUpperCase();
      await api.put(`/cost-centers/${id}`, payload);
      setEditando(null);
      mostraMsg('ok', 'Aggiornato');
      await caricaAlbero();
    } catch (err) {
      mostraMsg('errore', err.response?.data?.detail || 'Errore aggiornamento');
    }
  }

  async function toggleAttivo(id, attuale) {
    try {
      await api.put(`/cost-centers/${id}`, { attivo: !attuale });
      mostraMsg('ok', attuale ? 'Disattivato' : 'Attivato');
      await caricaAlbero();
    } catch (err) {
      mostraMsg('errore', err.response?.data?.detail || 'Errore');
    }
  }

  async function crea(e) {
    e.preventDefault();
    if (!formDati.code.trim() || !formDati.name.trim()) {
      mostraMsg('errore', 'Compilare codice e nome');
      return;
    }
    try {
      await api.post('/cost-centers/', {
        code: formDati.code.trim().toUpperCase(),
        name: formDati.name.trim(),
        tipo: formAperto.tipo,
        parent_id: formAperto.parentId,
        ordine: 99,
      });
      mostraMsg('ok', `${formAperto.tipo === 'categoria' ? 'Categoria' : 'Reparto'} creato`);
      setFormAperto(null);
      setFormDati({ code: '', name: '' });
      await caricaAlbero();
    } catch (err) {
      mostraMsg('errore', err.response?.data?.detail || 'Errore creazione');
    }
  }

  function apriForm(tipo, parentId) {
    setFormAperto({ tipo, parentId });
    setFormDati({ code: '', name: '' });
    setEditando(null);
  }

  if (loading) return <Loading />;

  // Campi di modifica inline (sigla + nome) per struttura, categoria e reparto
  const campiModifica = (id, largSigla = 120) => (
    <>
      <Input value={editando.code} onChange={e => setEditando(p => ({ ...p, code: e.target.value }))}
        placeholder="Sigla" style={{ width: largSigla, fontFamily: 'monospace', textTransform: 'uppercase' }} />
      <Input value={editando.name} onChange={e => setEditando(p => ({ ...p, name: e.target.value }))}
        onKeyDown={e => e.key === 'Enter' && rinomina(id)} style={{ flex: 1 }} autoFocus />
      <Button size="sm" onClick={() => rinomina(id)}>✓ Salva</Button>
      <Button variant="secondary" size="sm" onClick={() => setEditando(null)} aria-label="Annulla">✕</Button>
    </>
  );

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader title="Centri di costo" subtitle="Struttura a 3 livelli: Struttura → Categoria → Reparto" />

      {albero.map(struttura => (
        <div key={struttura.id} className="ui-card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>

          {/* ── Header struttura ── */}
          <div style={{ background: colors.primary, color: '#fff', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 'var(--fs-md)', background: 'rgba(255,255,255,0.15)', padding: '2px 10px', borderRadius: 5 }}>
              {struttura.code}
            </span>
            {editando?.id === struttura.id ? campiModifica(struttura.id, 90) : (
              <>
                <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 600 }}>{struttura.name}</span>
                <Button variant="secondary" size="sm" onClick={() => { setEditando({ id: struttura.id, code: struttura.code, name: struttura.name }); setFormAperto(null); }}>✎ Rinomina</Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={() => apriForm('categoria', struttura.id)}>+ Categoria</Button>
          </div>

          {/* ── Form nuova categoria ── */}
          {formAperto?.tipo === 'categoria' && formAperto.parentId === struttura.id && (
            <FormAggiungi
              titolo={`Nuova categoria in ${struttura.code}`}
              dati={formDati}
              onChange={setFormDati}
              onSubmit={crea}
              onAnnulla={() => setFormAperto(null)}
              placeholderCode={`${struttura.code}_NUOVA`}
              placeholderName="es. Wellness, Spiaggia…"
            />
          )}

          {/* ── Categorie ── */}
          {(struttura.categorie || []).length === 0 ? (
            <div className="ui-text-muted" style={{ padding: '12px 18px', fontStyle: 'italic' }}>
              Nessuna categoria configurata — usa "+ Categoria" per aggiungerne una
            </div>
          ) : (
            (struttura.categorie || []).map(cat => (
              <div key={cat.id} style={{ borderTop: `1px solid ${colors.border}` }}>

                {/* Header categoria */}
                <div style={{
                  background: cat.attivo ? colors.infoSoft : colors.surfaceSoft,
                  padding: '8px 18px 8px 36px', display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: `1px solid ${colors.border}`,
                }}>
                  <Badge tono="info">categoria</Badge>
                  {editando?.id === cat.id ? campiModifica(cat.id) : (
                    <>
                      <span style={{ flex: 1, fontWeight: 600, color: cat.attivo ? colors.textStrong : colors.textSubtle }}>{cat.name}</span>
                      <code style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle }}>{cat.code}</code>
                      <Button variant="ghost" size="sm" onClick={() => { setEditando({ id: cat.id, code: cat.code, name: cat.name }); setFormAperto(null); }} aria-label="Rinomina">✎</Button>
                    </>
                  )}
                  <ToggleAttivo attivo={cat.attivo} onClick={() => toggleAttivo(cat.id, cat.attivo)} />
                  <Button variant="secondary" size="sm" onClick={() => apriForm('reparto', cat.id)}>+ Reparto</Button>
                </div>

                {/* Form nuovo reparto */}
                {formAperto?.tipo === 'reparto' && formAperto.parentId === cat.id && (
                  <FormAggiungi
                    titolo={`Nuovo reparto in "${cat.name}"`}
                    dati={formDati}
                    onChange={setFormDati}
                    onSubmit={crea}
                    onAnnulla={() => setFormAperto(null)}
                    placeholderCode={`${struttura.code}_NUOVO`}
                    placeholderName="es. Animazione, Spa…"
                  />
                )}

                {/* Reparti */}
                {cat.reparti.length === 0 ? (
                  <div className="ui-text-muted" style={{ padding: '8px 18px 8px 60px', fontStyle: 'italic', fontSize: 'var(--fs-sm)' }}>Nessun reparto</div>
                ) : (
                  cat.reparti.map((rep, idx) => (
                    <div key={rep.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 18px 6px 60px',
                      background: idx % 2 === 0 ? colors.surfaceSoft : colors.surface,
                      borderTop: `1px solid ${colors.surfaceAlt}`,
                    }}>
                      <code style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, minWidth: 150 }}>{rep.code}</code>
                      {editando?.id === rep.id ? campiModifica(rep.id) : (
                        <>
                          <span style={{ flex: 1, color: rep.attivo ? colors.text : colors.textSubtle }}>{rep.name}</span>
                          <Button variant="ghost" size="sm" onClick={() => { setEditando({ id: rep.id, code: rep.code, name: rep.name }); setFormAperto(null); }} aria-label="Rinomina">✎</Button>
                        </>
                      )}
                      <ToggleAttivo attivo={rep.attivo} onClick={() => toggleAttivo(rep.id, rep.attivo)} />
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

// ── Componenti interni ────────────────────────────────────────────────────────

// Stato attivo/inattivo cliccabile (a forma di badge)
function ToggleAttivo({ attivo, onClick }) {
  return (
    <button type="button" onClick={onClick} title={attivo ? 'Clicca per disattivare' : 'Clicca per attivare'}
      className={`ui-badge ${attivo ? 'ui-badge-ok' : 'ui-badge-err'}`}
      style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
      {attivo ? 'attivo' : 'inattivo'}
    </button>
  );
}

function FormAggiungi({ titolo, dati, onChange, onSubmit, onAnnulla, placeholderCode, placeholderName }) {
  return (
    <form onSubmit={onSubmit} style={{
      padding: '12px 18px', background: colors.surfaceSoft, borderBottom: `1px solid ${colors.border}`,
      display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 'var(--fs-sm)', color: colors.textSecond, fontWeight: 600, alignSelf: 'center' }}>{titolo}</span>
      <Field label="Codice">
        <Input value={dati.code} onChange={e => onChange(p => ({ ...p, code: e.target.value }))} placeholder={placeholderCode} style={{ width: 160 }} />
      </Field>
      <Field label="Nome">
        <Input value={dati.name} onChange={e => onChange(p => ({ ...p, name: e.target.value }))} placeholder={placeholderName} style={{ width: 200 }} />
      </Field>
      <Button type="submit">Aggiungi</Button>
      <Button variant="secondary" onClick={onAnnulla}>Annulla</Button>
    </form>
  );
}
