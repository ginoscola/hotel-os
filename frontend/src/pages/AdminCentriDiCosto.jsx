import { useEffect, useState } from 'react';
import api from '../api/client';

export default function AdminCentriDiCosto() {
  const [albero, setAlbero] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

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
      setMsg({ tipo: 'errore', testo: 'Errore caricamento centri di costo' });
    } finally {
      setLoading(false);
    }
  }

  function mostraMsg(tipo, testo) {
    setMsg({ tipo, testo });
    setTimeout(() => setMsg(null), 3500);
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

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>Caricamento...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <h2 style={{ marginBottom: 8, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>
        Gestione Centri di Costo
      </h2>
      <p style={{ marginBottom: 24, fontSize: 13, color: '#64748b' }}>
        Struttura a 3 livelli: Struttura → Categoria → Reparto
      </p>

      {msg && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          background: msg.tipo === 'ok' ? '#d1fae5' : '#fee2e2',
          color: msg.tipo === 'ok' ? '#065f46' : '#991b1b',
          border: `1px solid ${msg.tipo === 'ok' ? '#6ee7b7' : '#fca5a5'}`,
        }}>
          {msg.testo}
        </div>
      )}

      {albero.map(struttura => (
        <div key={struttura.id} style={{ marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>

          {/* ── Header struttura ── */}
          <div style={{ background: '#1e3a5f', color: 'white', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, background: 'rgba(255,255,255,0.15)', padding: '2px 10px', borderRadius: 5 }}>
              {struttura.code}
            </span>
            {editando?.id === struttura.id ? (
              <>
                <input value={editando.code} onChange={e => setEditando(p => ({ ...p, code: e.target.value }))}
                  placeholder="Sigla" style={{ width: 80, padding: '4px 8px', borderRadius: 5, border: 'none', fontSize: 13, fontFamily: 'monospace', textTransform: 'uppercase' }} />
                <input value={editando.name} onChange={e => setEditando(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && rinomina(struttura.id)}
                  style={{ flex: 1, padding: '4px 10px', borderRadius: 5, border: 'none', fontSize: 14 }} autoFocus />
                <BtnPicco onClick={() => rinomina(struttura.id)} color="#10b981">✓ Salva</BtnPicco>
                <BtnPicco onClick={() => setEditando(null)} color="#6b7280">✕</BtnPicco>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: 15 }}>{struttura.name}</span>
                <BtnPicco onClick={() => { setEditando({ id: struttura.id, code: struttura.code, name: struttura.name }); setFormAperto(null); }} color="#3b82f6">✎ Rinomina</BtnPicco>
              </>
            )}
            <BtnPicco onClick={() => apriForm('categoria', struttura.id)} color="#7c3aed">+ Categoria</BtnPicco>
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
              sfondo="#f0f4ff"
            />
          )}

          {/* ── Categorie ── */}
          {(struttura.categorie || []).length === 0 ? (
            <div style={{ padding: '12px 18px', color: '#94a3b8', fontStyle: 'italic', fontSize: 13 }}>
              Nessuna categoria configurata — usa "+ Categoria" per aggiungerne una
            </div>
          ) : (
            (struttura.categorie || []).map(cat => (
              <div key={cat.id} style={{ borderTop: '1px solid #e2e8f0' }}>

                {/* Header categoria */}
                <div style={{
                  background: cat.attivo ? '#f0f9ff' : '#f8fafc',
                  padding: '9px 18px 9px 36px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: '1px solid #e2e8f0',
                }}>
                  <span style={{ fontSize: 11, color: '#0369a1', fontWeight: 700, background: '#dbeafe', padding: '2px 8px', borderRadius: 10 }}>
                    categoria
                  </span>
                  {editando?.id === cat.id ? (
                    <>
                      <input value={editando.code} onChange={e => setEditando(p => ({ ...p, code: e.target.value }))}
                        placeholder="Sigla" style={{ width: 120, padding: '3px 8px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12, fontFamily: 'monospace', textTransform: 'uppercase' }} />
                      <input value={editando.name} onChange={e => setEditando(p => ({ ...p, name: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && rinomina(cat.id)}
                        style={{ flex: 1, padding: '3px 8px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 14 }} autoFocus />
                      <BtnPicco onClick={() => rinomina(cat.id)} color="#10b981">✓</BtnPicco>
                      <BtnPicco onClick={() => setEditando(null)} color="#6b7280">✕</BtnPicco>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: cat.attivo ? '#0f172a' : '#94a3b8' }}>
                        {cat.name}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>{cat.code}</span>
                      <BtnPicco onClick={() => { setEditando({ id: cat.id, code: cat.code, name: cat.name }); setFormAperto(null); }} color="#3b82f6">✎</BtnPicco>
                    </>
                  )}
                  <ToggleAttivo attivo={cat.attivo} onClick={() => toggleAttivo(cat.id, cat.attivo)} />
                  <BtnPicco onClick={() => apriForm('reparto', cat.id)} color="#059669">+ Reparto</BtnPicco>
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
                    sfondo="#f0fdf4"
                  />
                )}

                {/* Reparti */}
                {cat.reparti.length === 0 ? (
                  <div style={{ padding: '8px 18px 8px 60px', color: '#94a3b8', fontStyle: 'italic', fontSize: 12 }}>
                    Nessun reparto
                  </div>
                ) : (
                  cat.reparti.map((rep, idx) => (
                    <div key={rep.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 18px 7px 60px',
                      background: idx % 2 === 0 ? '#fafafa' : 'white',
                      borderTop: '1px solid #f1f5f9',
                    }}>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8', minWidth: 150 }}>
                        {rep.code}
                      </span>
                      {editando?.id === rep.id ? (
                        <>
                          <input value={editando.code} onChange={e => setEditando(p => ({ ...p, code: e.target.value }))}
                            placeholder="Sigla" style={{ width: 120, padding: '3px 8px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12, fontFamily: 'monospace', textTransform: 'uppercase' }} />
                          <input value={editando.name} onChange={e => setEditando(p => ({ ...p, name: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && rinomina(rep.id)}
                            style={{ flex: 1, padding: '3px 8px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 13 }} autoFocus />
                          <BtnPicco onClick={() => rinomina(rep.id)} color="#10b981">✓</BtnPicco>
                          <BtnPicco onClick={() => setEditando(null)} color="#6b7280">✕</BtnPicco>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: 13, color: rep.attivo ? '#1e293b' : '#94a3b8' }}>{rep.name}</span>
                          <BtnPicco onClick={() => { setEditando({ id: rep.id, code: rep.code, name: rep.name }); setFormAperto(null); }} color="#3b82f6">✎</BtnPicco>
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

function BtnPicco({ onClick, color, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '3px 10px', background: color, color: 'white',
      border: 'none', borderRadius: 4, cursor: 'pointer',
      fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {children}
    </button>
  );
}

function ToggleAttivo({ attivo, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '2px 10px', borderRadius: 10, border: 'none', cursor: 'pointer',
      fontSize: 11, fontWeight: 600,
      background: attivo ? '#d1fae5' : '#fee2e2',
      color: attivo ? '#065f46' : '#991b1b',
    }}>
      {attivo ? 'attivo' : 'inattivo'}
    </button>
  );
}

function FormAggiungi({ titolo, dati, onChange, onSubmit, onAnnulla, placeholderCode, placeholderName, sfondo }) {
  return (
    <form onSubmit={onSubmit} style={{
      padding: '12px 18px', background: sfondo,
      borderBottom: '1px solid #e2e8f0', display: 'flex',
      gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12, color: '#475569', fontWeight: 600, alignSelf: 'center' }}>{titolo}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 11, color: '#64748b' }}>Codice</label>
        <input value={dati.code} onChange={e => onChange(p => ({ ...p, code: e.target.value }))}
          placeholder={placeholderCode} style={{ ...inputStyle, width: 160 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 11, color: '#64748b' }}>Nome</label>
        <input value={dati.name} onChange={e => onChange(p => ({ ...p, name: e.target.value }))}
          placeholder={placeholderName} style={{ ...inputStyle, width: 200 }} />
      </div>
      <button type="submit" style={{
        padding: '7px 18px', background: '#1e40af', color: 'white',
        border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
      }}>
        Aggiungi
      </button>
      <button type="button" onClick={onAnnulla} style={{
        padding: '7px 12px', background: 'transparent', color: '#64748b',
        border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 13,
      }}>
        Annulla
      </button>
    </form>
  );
}

const inputStyle = {
  padding: '6px 10px', border: '1px solid #cbd5e1',
  borderRadius: 6, fontSize: 13,
};
