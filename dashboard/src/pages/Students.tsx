import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch, apiGet, apiPost, apiPut } from '../utils/api';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface BusInfo {
  id: string;
  routeId: string;
  route: { id: string; name: string; waypoints: any[] };
}

interface Student {
  id: string;
  name: string;
  class: string;
  busId: string | null;
  currentState: string;
  guardianName?: string | null;
  guardianPhone?: string | null;
  wardTole?: string | null;
  homeLat?: number | null;
  homeLon?: number | null;
  routeOrder?: number | null;
  bus?: BusInfo | null;
}

function StudentForm({ student, onSave, onCancel }: {
  student?: Student;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(student?.name || '');
  const [cls, setCls] = useState(student?.class || '');
  const [busId, setBusId] = useState(student?.busId || '');
  const [guardianName, setGuardianName] = useState(student?.guardianName || '');
  const [guardianPhone, setGuardianPhone] = useState(student?.guardianPhone || '');
  const [wardTole, setWardTole] = useState(student?.wardTole || '');
  const [homeLat, setHomeLat] = useState(student?.homeLat?.toString() || '');
  const [homeLon, setHomeLon] = useState(student?.homeLon?.toString() || '');
  const [buses, setBuses] = useState<BusInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<BusInfo[]>('/students/buses').then(setBuses).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const lat = parseFloat(homeLat) || 27.6939;
    const lon = parseFloat(homeLon) || 85.3374;
    const map = L.map(mapContainer.current, { center: [lat, lon], zoom: 14, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      setHomeLat(e.latlng.lat.toFixed(6));
      setHomeLon(e.latlng.lng.toFixed(6));
      if (markerRef.current) {
        markerRef.current.setLatLng(e.latlng);
      } else {
        const icon = L.divIcon({
          className: '',
          html: '<div style="background:#2dd4bf;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
          iconSize: [14, 14], iconAnchor: [7, 7],
        });
        markerRef.current = L.marker(e.latlng, { icon }).addTo(map);
      }
    });

    if (homeLat && homeLon) {
      const icon = L.divIcon({
        className: '',
        html: '<div style="background:#2dd4bf;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
        iconSize: [14, 14], iconAnchor: [7, 7],
      });
      markerRef.current = L.marker([parseFloat(homeLat), parseFloat(homeLon)], { icon }).addTo(map);
    }

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Auto-suggest bus when home coordinates change
  useEffect(() => {
    if (!homeLat || !homeLon || buses.length === 0) return;
    const lat = parseFloat(homeLat);
    const lon = parseFloat(homeLon);
    if (isNaN(lat) || isNaN(lon)) return;
    apiGet<{ routeId: string; distance: number }[]>(`/students/suggest-routes?lat=${encodeURIComponent(homeLat)}&lon=${encodeURIComponent(homeLon)}`)
      .then((suggestions) => {
        if (suggestions.length === 0) return;
        const best = suggestions[0];
        const match = buses.find((b) => b.routeId === best.routeId);
        if (match) setBusId(match.id);
      })
      .catch(() => {});
  }, [homeLat, homeLon, buses]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        class: cls.trim() || 'Unknown',
        busId: busId || undefined,
        guardianName: guardianName.trim() || undefined,
        guardianPhone: guardianPhone.trim() || undefined,
        wardTole: wardTole.trim() || undefined,
        homeLat: homeLat || undefined,
        homeLon: homeLon || undefined,
      };
      await onSave(payload);
    } catch (err: any) {
      setError(err.message || 'Save failed');
      setSaving(false);
    }
  };

  const selectedBus = buses.find((b) => b.id === busId);
  const suggestedRoutes = selectedBus?.route?.name ? [selectedBus.route.name] : [];

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Full Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required
            placeholder="Suman Poudel"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all" />
        </div>
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Class / Section</label>
          <input value={cls} onChange={(e) => setCls(e.target.value)}
            placeholder="Grade 8-A"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all" />
        </div>
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Bus</label>
          <select value={busId} onChange={(e) => setBusId(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-teal-400/40 transition-all">
            <option value="" className="bg-[#111]">— No bus —</option>
            {buses.map((b) => (
              <option key={b.id} value={b.id} className="bg-[#111]">{b.id} — {b.route?.name || '?'}</option>
            ))}
          </select>
          {suggestedRoutes.length > 0 && (
            <p className="text-[10px] text-teal-400/60 mt-1">{suggestedRoutes[0]}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Guardian Name</label>
          <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)}
            placeholder="Ram Shrestha"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all" />
        </div>
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Guardian Phone</label>
          <input value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)}
            placeholder="+977-98xxxxxxxx"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all" />
        </div>
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Ward / Tole</label>
          <input value={wardTole} onChange={(e) => setWardTole(e.target.value)}
            placeholder="Ward 10, Old Baneshwor"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Home Lat</label>
          <input value={homeLat} onChange={(e) => setHomeLat(e.target.value)}
            placeholder="27.7080"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all font-mono" />
        </div>
        <div>
          <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Home Lon</label>
          <input value={homeLon} onChange={(e) => setHomeLon(e.target.value)}
            placeholder="85.3390"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all font-mono" />
        </div>
        <div className="flex items-end">
          <p className="text-[10px] text-white/20">Click the map to set a pin</p>
        </div>
      </div>

      <div ref={mapContainer} className="h-48 rounded-xl border border-white/[0.08] overflow-hidden" />

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 rounded-lg text-xs bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 text-teal-400 transition-all disabled:opacity-50">
          {saving ? 'Saving…' : student ? 'Update Student' : 'Add Student'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/50 transition-all">
          Cancel
        </button>
      </div>
    </form>
  );
}

const STATE_COLORS: Record<string, string> = {
  NOT_BOARDED: 'text-white/30',
  BOARDED: 'text-amber-400',
  ARRIVED_SCHOOL: 'text-teal-400',
  DEPARTED: 'text-amber-400',
  ARRIVED_HOME: 'text-blue-400',
};
const STATE_LABELS: Record<string, string> = {
  NOT_BOARDED: 'Not Boarded', BOARDED: 'Boarded',
  ARRIVED_SCHOOL: 'At School', DEPARTED: 'Departed', ARRIVED_HOME: 'Home',
};

export function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [enrollId, setEnrollId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Record<string, string>>({});

  const handleEnrollFace = async (studentId: string, file: File) => {
    setEnrollId(studentId);
    setEnrollment((prev) => ({ ...prev, [studentId]: 'uploading' }));
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const res = await apiFetch(`/students/${studentId}/enroll-face`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      setEnrollment((prev) => ({
        ...prev,
        [studentId]: res.ok ? 'enrolled' : `error: ${(data as any).message || res.status}`,
      }));
    } catch (e: any) {
      setEnrollment((prev) => ({ ...prev, [studentId]: 'error' }));
    } finally {
      setEnrollId(null);
    }
  };

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await apiGet<Student[]>('/students');
      setStudents(data);
    } catch {
      setError('Failed to load students. Retrying…');
      setTimeout(load, 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (payload: any) => {
    await apiPost<Student>('/students', payload);
    setShowAdd(false);
    load();
  };

  const handleEdit = async (payload: any) => {
    if (!editing) return;
    await apiPut(`/students/${editing.id}`, payload);
    setEditing(null);
    load();
  };

  const filtered = students.filter((s) => {
    const q = query.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.class || '').toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-white/90">Students</h1>
            <p className="text-xs text-white/40">{students.length} student{students.length !== 1 ? 's' : ''} enrolled</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowAdd(true); setEditing(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 text-teal-400 font-medium transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Student
          </button>
        </div>
      </div>

      {error && <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 text-xs text-amber-400">{error}</div>}

      {(showAdd || editing) && (
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white/70 mb-4">{editing ? 'Edit Student' : 'New Student'}</h2>
          <StudentForm
            student={editing || undefined}
            onSave={editing ? handleEdit : handleAdd}
            onCancel={() => { setShowAdd(false); setEditing(null); }}
          />
        </div>
      )}

      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or class…"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-xs text-white/80 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all" />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-white/30">Loading students…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-white/30">{query ? 'No matches.' : 'No students enrolled yet.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-5 py-3 text-left font-medium">Class</th>
                  <th className="px-5 py-3 text-left font-medium">Bus / Route</th>
                  <th className="px-5 py-3 text-left font-medium">Ward / Tole</th>
                  <th className="px-5 py-3 text-left font-medium">Route Order</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  return (
                    <tr key={s.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3.5 font-medium text-white/90">{s.name}</td>
                      <td className="px-5 py-3.5 text-white/50">{s.class || '—'}</td>
                      <td className="px-5 py-3.5 text-xs">
                        {s.bus ? (
                          <span className="text-white/70">{s.bus.route?.name || s.busId}</span>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-white/40">{s.wardTole || '—'}</td>
                      <td className="px-5 py-3.5 text-xs text-white/40">{s.routeOrder ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-medium ${STATE_COLORS[s.currentState] || 'text-white/40'}`}>
                          {STATE_LABELS[s.currentState] || s.currentState}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditing(s); setShowAdd(false); }}
                            className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/40 hover:text-white/60 transition-all">Edit</button>
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => document.getElementById(`face-${s.id}`)?.click()}
                              disabled={enrollId === s.id}
                              title="Enroll face for identification"
                              className={`px-2.5 py-1 rounded-md text-xs border transition-all ${
                                enrollment[s.id] === 'enrolled'
                                  ? 'bg-teal-400/20 border-teal-400/30 text-teal-400'
                                  : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/60'
                              } ${enrollId === s.id ? 'opacity-50 cursor-wait' : ''}`}
                            >
                              {enrollId === s.id ? 'Uploading…' : enrollment[s.id] === 'enrolled' ? '✓ Face' : 'Face'}
                            </button>
                            <input
                              id={`face-${s.id}`}
                              type="file"
                              accept="image/jpeg,image/png"
                              className="hidden"
                              disabled={enrollId !== null}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleEnrollFace(s.id, file);
                                e.target.value = '';
                              }}
                            />
                          </span>
                        </div>
                        {enrollment[s.id] && enrollment[s.id] !== 'enrolled' && enrollment[s.id] !== 'uploading' && (
                          <p className="text-[10px] text-red-400 mt-1">{enrollment[s.id]}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}