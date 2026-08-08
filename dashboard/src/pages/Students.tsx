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
  faceEnrolled?: boolean;
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
  const [manage, setManage] = useState<Student | null>(null);
  const [mFile, setMFile] = useState<File | null>(null);
  const [mPreview, setMPreview] = useState<string | null>(null);
  const [mBusy, setMBusy] = useState(false);
  const [mMsg, setMMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mPhoto, setMPhoto] = useState<string | null>(null);
  const [mPhotoLoading, setMPhotoLoading] = useState(false);
  const storedUrlRef = useRef<string | null>(null);
  const faceInputRef = useRef<HTMLInputElement>(null);

  const loadStoredPhoto = useCallback(async (id: string) => {
    setMPhotoLoading(true);
    try {
      const res = await apiFetch(`/students/${id}/face-photo`);
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        if (storedUrlRef.current) URL.revokeObjectURL(storedUrlRef.current);
        storedUrlRef.current = url;
        setMPhoto(url);
      } else {
        if (storedUrlRef.current) URL.revokeObjectURL(storedUrlRef.current);
        storedUrlRef.current = null;
        setMPhoto(null);
      }
    } catch {
      if (storedUrlRef.current) URL.revokeObjectURL(storedUrlRef.current);
      storedUrlRef.current = null;
      setMPhoto(null);
    } finally {
      setMPhotoLoading(false);
    }
  }, []);

  const chooseFaceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      setMMsg({ ok: false, text: 'Only JPG or PNG images are allowed.' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMMsg({ ok: false, text: 'Photo must be 5 MB or smaller.' });
      return;
    }
    setMFile(file);
    setMMsg(null);
    if (mPreview) URL.revokeObjectURL(mPreview);
    setMPreview(URL.createObjectURL(file));
  };

  const closeFace = () => {
    if (mBusy) return;
    setManage(null);
    setMFile(null);
    if (mPreview) URL.revokeObjectURL(mPreview);
    setMPreview(null);
    if (storedUrlRef.current) URL.revokeObjectURL(storedUrlRef.current);
    storedUrlRef.current = null;
    setMPhoto(null);
    setMMsg(null);
    load();
  };

  const handleEnrollFace = async () => {
    if (!manage || !mFile) return;
    setMBusy(true);
    setMMsg(null);
    try {
      const fd = new FormData();
      fd.append('photo', mFile);
      const res = await apiFetch(`/students/${manage.id}/enroll-face`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMMsg({ ok: true, text: `✓ FACE ENROLLMENT SUCCESSFUL — ${manage.name} can now be recognized.` });
        setManage((prev) => (prev ? { ...prev, faceEnrolled: true } : prev));
        if (mPreview) URL.revokeObjectURL(mPreview);
        setMPreview(null);
        setMFile(null);
        loadStoredPhoto(manage.id);
        load();
      } else {
        setMMsg({ ok: false, text: (data as any).message || `Enrollment failed (${res.status})` });
      }
    } catch (e: any) {
      setMMsg({ ok: false, text: e.message || 'Enrollment failed' });
    } finally {
      setMBusy(false);
    }
  };

  const handleRemoveFace = async () => {
    if (!manage) return;
    if (!window.confirm(`Remove face enrollment for ${manage.name}? The student will no longer be recognized.`)) return;
    setMBusy(true);
    setMMsg(null);
    try {
      const res = await apiFetch(`/students/${manage.id}/enroll-face`, { method: 'DELETE' });
      if (res.ok) {
        setMMsg({ ok: true, text: `✓ FACE ENROLLMENT REMOVED — ${manage.name} is no longer recognized.` });
        setManage((prev) => (prev ? { ...prev, faceEnrolled: false } : prev));
        if (storedUrlRef.current) URL.revokeObjectURL(storedUrlRef.current);
        storedUrlRef.current = null;
        setMPhoto(null);
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        setMMsg({ ok: false, text: (data as any).message || `Remove failed (${res.status})` });
      }
    } catch (e: any) {
      setMMsg({ ok: false, text: e.message || 'Remove failed' });
    } finally {
      setMBusy(false);
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
                  <th className="px-5 py-3 text-left font-medium">Face</th>
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
                        {s.faceEnrolled ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-400">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                            Enrolled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-white/30">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /></svg>
                            Not Enrolled
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditing(s); setShowAdd(false); }}
                            className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/40 hover:text-white/60 transition-all">Edit</button>
                          <button onClick={() => { setManage(s); if (s.faceEnrolled) loadStoredPhoto(s.id); }}
                            className={`px-2.5 py-1 rounded-md text-xs border transition-all ${
                              s.faceEnrolled
                                ? 'bg-teal-400/20 border-teal-400/30 text-teal-400 hover:bg-teal-400/30'
                                : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/60'
                            }`}>
                            {s.faceEnrolled ? 'Manage Face' : 'Enroll Face'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {manage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={closeFace}>
          <div className="bg-[#0b0f14] border border-white/[0.08] rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white/90">Student Face Enrollment</h2>
                <p className="text-xs text-white/40 mt-0.5">{manage.name} · {manage.class || '—'}{manage.bus?.route?.name ? ` · ${manage.bus.route.name}` : ''}</p>
              </div>
              <button onClick={closeFace} className="text-white/30 hover:text-white/70">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white/40 uppercase tracking-wider">Face Status:</span>
                {manage.faceEnrolled ? (
                  <span className="inline-flex items-center gap-1 text-teal-400 font-medium">✓ Enrolled</span>
                ) : (
                  <span className="text-white/30">○ Not Enrolled</span>
                )}
              </div>

              <div className="flex flex-col items-center gap-3">
                {mPreview ? (
                  <img src={mPreview} alt="Face preview" className="w-32 h-32 object-cover rounded-xl border border-teal-400/30" />
                ) : mPhoto ? (
                  <img src={mPhoto} alt="Stored reference photo" className="w-32 h-32 object-cover rounded-xl border border-white/[0.08]" />
                ) : (
                  <div className="w-32 h-32 rounded-xl border border-dashed border-white/[0.15] flex items-center justify-center text-white/20">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  </div>
                )}
                <span className="text-[10px] text-white/30">
                  {mPreview
                    ? `New photo — ${mFile?.name} (${mFile ? (mFile.size / 1024 / 1024).toFixed(1) : 0} MB)`
                    : mPhoto
                      ? 'Stored reference photo — used for recognition'
                      : mPhotoLoading
                        ? 'Loading reference photo…'
                        : 'No reference photo yet'}
                </span>
                <button onClick={() => faceInputRef.current?.click()} disabled={mBusy}
                  className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/60 transition-all disabled:opacity-50">
                  {mFile ? 'Change Photo…' : mPhoto ? 'Replace Photo…' : 'Choose Photo…'}
                </button>
                <input ref={faceInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={chooseFaceFile} />
              </div>

              {mMsg && (
                <p className={`text-xs rounded-lg px-3 py-2 ${mMsg.ok ? 'bg-teal-400/10 border border-teal-400/20 text-teal-400' : 'bg-red-400/10 border border-red-400/20 text-red-400'}`}>
                  {mMsg.text}
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleEnrollFace}
                  disabled={mBusy || !mFile}
                  title="Upload & Enroll"
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 text-teal-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {mBusy ? 'Working…' : manage.faceEnrolled ? 'Replace Photo & Re-Enroll' : 'Upload & Enroll'}
                </button>
                {manage.faceEnrolled && (
                  <button
                    onClick={handleRemoveFace}
                    disabled={mBusy}
                    className="px-3 py-2 rounded-lg text-xs bg-red-400/10 hover:bg-red-400/20 border border-red-400/30 text-red-400 transition-all disabled:opacity-50">
                    Remove Enrollment
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}