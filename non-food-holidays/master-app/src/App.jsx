import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, Bell, CalendarDays, ListChecks, Users, PenSquare, Check, Trash2, Clock } from 'lucide-react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { subscribeRoster, subscribeRequests, subscribeBlackouts, subscribeBlackoutReasons, saveRoster, createRequest, patchRequest, createBlackout, deleteBlackout, createBlackoutReason } from './data';
import { auth, db } from './firebase';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function pad(n){ return n < 10 ? '0' + n : '' + n; }
function toISO(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fromISO(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(iso, n){ const d = fromISO(iso); d.setDate(d.getDate()+n); return toISO(d); }
function dateRangeArray(startISO, endISO){
  if(!startISO || !endISO) return [];
  let a = startISO, b = endISO;
  if(fromISO(a) > fromISO(b)) { const t=a; a=b; b=t; }
  const out = []; let cur = a, guard = 0;
  while(cur <= b && guard < 731){ out.push(cur); cur = addDays(cur,1); guard++; }
  return out;
}
function buildMonthMatrix(year, month){
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells = [];
  for(let i=0;i<startWeekday;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(toISO(new Date(year,month,d)));
  while(cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for(let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));
  return weeks;
}
function fmtShort(iso){ const d = fromISO(iso); return `${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getDate()}`; }
function formatDatesSummary(dates){
  if(!dates || dates.length===0) return '';
  const sorted = [...dates].sort();
  const groups = []; let start = sorted[0], prev = sorted[0];
  for(let i=1;i<sorted.length;i++){
    const d = sorted[i];
    if(d === addDays(prev,1)){ prev = d; continue; }
    groups.push([start,prev]); start = d; prev = d;
  }
  groups.push([start,prev]);
  return groups.map(([s,e]) => s===e ? fmtShort(s) : `${fmtShort(s)}–${fmtShort(e)}`).join(', ');
}
function timeAgo(ts){
  const diff = Date.now() - ts;
  const mins = Math.floor(diff/60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}
function formatFriendlyDateList(dates){
  return (Array.isArray(dates) ? dates : []).map((date) => {
    if (!date) return '';
    const d = fromISO(String(date));
    return `${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getDate()}`;
  }).filter(Boolean).join(', ');
}
function getTeamConflictDates({ requests = [], team, requestedDates = [], ignoreRequestId = null }){
  const teamName = String(team ?? '').trim();
  if (!['GM', 'George'].includes(teamName)) return [];
  const occupying = (requests || []).filter((request) => {
    if (!request) return false;
    if (ignoreRequestId && request.id === ignoreRequestId) return false;
    if (!['pending', 'approved'].includes(String(request.status || '').trim().toLowerCase())) return false;
    return String(request.list || '').trim() === teamName;
  });
  return requestedDates.filter((date) => {
    const iso = String(date);
    return occupying.some((request) => Array.isArray(request.dates) && request.dates.map(d => String(d)).includes(iso));
  });
}
function getBlackoutConflictDates(blackouts = [], requestedDates = []) {
  const blackoutSet = {};
  (blackouts || []).forEach((blackout) => {
    const start = blackout.startDate || blackout.date || blackout.blackoutDate;
    const end = blackout.endDate || start;
    if (!start) return;
    dateRangeArray(start, end).forEach((d) => { blackoutSet[d] = true; });
  });
  return requestedDates.filter((date) => blackoutSet[String(date)]);
}
function getBlackoutReasonsForDates(blackouts = [], dates = []) {
  return dates.map((date) => {
    const match = (blackouts || []).find((blackout) => dateRangeArray(
      blackout.startDate || blackout.date || blackout.blackoutDate,
      blackout.endDate || blackout.startDate || blackout.date || blackout.blackoutDate,
    ).includes(String(date)));
    return match?.reason || 'Blackout date';
  });
}

function listChipClasses(list){
  return list === 'GM'
    ? 'bg-amber-400 text-black border border-amber-500'
    : 'bg-black text-white border border-neutral-700';
}
function statusBadge(status){
  switch(status){
    case 'pending': return { label: 'Pending', cls: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40' };
    case 'approved': return { label: 'Approved', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' };
    case 'denied': return { label: 'Denied', cls: 'bg-red-500/20 text-red-300 border border-red-500/40' };
    case 'cancelled': return { label: 'Cancelled by colleague', cls: 'bg-neutral-500/20 text-neutral-300 border border-neutral-500/40' };
    case 'deleted': return { label: 'Removed', cls: 'bg-neutral-500/20 text-neutral-400 border border-neutral-500/40' };
    default: return { label: status, cls: 'bg-neutral-500/20 text-neutral-300 border border-neutral-500/40' };
  }
}

function MonthJumpControls({ year, month, onChange }){
  const years = [];
  const nowY = new Date().getFullYear();
  for(let y = nowY - 2; y <= nowY + 4; y++) years.push(y);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={() => { let m = month-1, y = year; if(m<0){m=11;y--;} onChange(y,m); }}
        className="p-1.5 rounded-lg bg-emerald-900/60 border border-emerald-700 hover:bg-emerald-800 text-emerald-100">
        <ChevronLeft size={16} />
      </button>
      <select value={month} onChange={e => onChange(year, Number(e.target.value))}
        className="rounded-lg border border-emerald-700 bg-emerald-950 text-emerald-100 text-sm px-2 py-1.5 font-medium">
        {MONTH_NAMES.map((m,i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <select value={year} onChange={e => onChange(Number(e.target.value), month)}
        className="rounded-lg border border-emerald-700 bg-emerald-950 text-emerald-100 text-sm px-2 py-1.5 font-medium">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <button onClick={() => { let m = month+1, y = year; if(m>11){m=0;y++;} onChange(y,m); }}
        className="p-1.5 rounded-lg bg-emerald-900/60 border border-emerald-700 hover:bg-emerald-800 text-emerald-100">
        <ChevronRight size={16} />
      </button>
      <button onClick={() => { const n = new Date(); onChange(n.getFullYear(), n.getMonth()); }}
        className="text-xs px-2 py-1.5 rounded-lg border border-emerald-700 text-emerald-200 hover:bg-emerald-800">Today</button>
    </div>
  );
}

function CalendarGrid({ year, month, approvedByDate = {}, pendingByDate = {}, blackoutByDate = {} }){
  const weeks = buildMonthMatrix(year, month);
  const today = toISO(new Date());
  return (
    <div className="rounded-xl overflow-hidden border border-emerald-800">
      <div className="grid grid-cols-7 bg-emerald-800 text-emerald-50 text-xs font-semibold">
        {WEEKDAYS.map(w => <div key={w} className="text-center py-1.5">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((iso, idx) => {
          const approved = iso ? (approvedByDate[iso] || []) : [];
          const pending = iso ? (pendingByDate[iso] || []) : [];
          const blackout = iso ? (blackoutByDate[iso] || []) : [];
          const entries = [
            ...approved.map(e => ({ ...e, status: 'approved' })),
            ...pending
          ];
          const isToday = iso === today;
          return (
            <div key={idx} className={`min-h-[76px] border-b border-r border-emerald-800 p-1 align-top ${iso ? (blackout.length > 0 ? 'bg-red-950/60' : 'bg-emerald-200') : 'bg-emerald-900/30'}`}>
              {iso && (
                <>
                  <div className={`text-[11px] mb-1 inline-flex items-center justify-center w-5 h-5 rounded-full ${isToday ? 'bg-emerald-400 text-emerald-950 font-bold' : 'text-emerald-900'}`}>
                    {fromISO(iso).getDate()}
                  </div>
                  {blackout.length > 0 && (
                    <div className="text-[9px] leading-tight rounded px-1 py-0.5 mb-0.5 bg-red-700 text-white border border-red-500 truncate font-semibold" title={blackout.map(b => b.reason || 'Blackout date').join(', ')}>
                      {blackout.map(b => b.reason || 'Blackout date').join(', ')}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {entries.slice(0,3).map((e,i) => {
                      const isPending = e.status === 'pending';
                      return (
                        <div key={e.id || `${iso}-${e.name}-${i}`} title={`${e.name} — ${isPending ? 'Pending' : 'Approved'}`} className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate font-medium ${
                          isPending ? 'bg-gray-400 text-gray-800 border border-gray-500' : listChipClasses(e.list)
                        }`}>
                          {e.name}
                        </div>
                      );
                    })}
                    {entries.length > 3 && <div className="text-[9px] text-emerald-300">+{entries.length-3} more</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DateBuilder({ dateFlags, setDateFlags }){
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [singleDay, setSingleDay] = useState('');

  const addRange = () => {
    if(!rangeStart || !rangeEnd) return;
    const days = dateRangeArray(rangeStart, rangeEnd);
    setDateFlags(prev => { const next = { ...prev }; days.forEach(d => next[d]=true); return next; });
  };
  const addSingle = () => {
    if(!singleDay) return;
    setDateFlags(prev => ({ ...prev, [singleDay]: true }));
    setSingleDay('');
  };
  const removeDate = (iso) => setDateFlags(prev => { const n = {...prev}; delete n[iso]; return n; });
  const selectedDates = Object.keys(dateFlags).filter(k=>dateFlags[k]).sort();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[11px] text-emerald-300 mb-0.5">From</label>
          <input type="date" value={rangeStart} onChange={e=>setRangeStart(e.target.value)}
            className="border border-emerald-700 bg-emerald-950 text-emerald-50 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] text-emerald-300 mb-0.5">To</label>
          <input type="date" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)}
            className="border border-emerald-700 bg-emerald-950 text-emerald-50 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <button onClick={addRange} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500">Add range</button>
        <div className="w-px h-8 bg-emerald-800 mx-1" />
        <div>
          <label className="block text-[11px] text-emerald-300 mb-0.5">Add single day</label>
          <input type="date" value={singleDay} onChange={e=>setSingleDay(e.target.value)}
            className="border border-emerald-700 bg-emerald-950 text-emerald-50 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <button onClick={addSingle} className="px-2 py-1.5 rounded-lg border border-emerald-600 text-emerald-200 hover:bg-emerald-800"><Plus size={16} /></button>
      </div>
      {selectedDates.length > 0 && (
        <div>
          <p className="text-[11px] text-emerald-300 mb-1">Days included:</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedDates.map(iso => (
              <span key={iso} className="inline-flex items-center gap-1 bg-emerald-800/60 text-emerald-50 text-xs px-2 py-1 rounded-full border border-emerald-600">
                {fmtShort(iso)}
                <button onClick={()=>removeDate(iso)} className="hover:text-red-300"><X size={12}/></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BlackoutManager({ blackouts = [], onAdd, onDelete, busy, defaultReasons = [], customReasons = [], onSaveCustomReason, saveError, saveNotice, loading, loadError }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  const reasonOptions = [...new Set([...(defaultReasons || []), ...(customReasons || []).map(item => item.name)])];

  const submit = async (e) => {
    e.preventDefault();
    const resolvedReason = reason === 'custom' ? customReason.trim() : reason.trim();
    if (!startDate || !resolvedReason) {
      alert('Please choose a blackout date and enter a reason before saving.');
      return;
    }
    try {
      await onAdd(startDate, endDate || startDate, resolvedReason);
      setStartDate('');
      setEndDate('');
      setReason('');
      setCustomReason('');
    } catch (error) {
      console.error('Add blackout error:', error);
      alert(error?.message || 'Unable to save blackout date. Please try again.');
    }
  };

  const addCustomReason = async () => {
    const next = customReason.trim();
    if (!next) {
      alert('Please enter a custom blackout reason before saving it.');
      return;
    }
    if ((customReasons || []).some(item => item.name.toLowerCase() === next.toLowerCase())) {
      setReason(next);
      setCustomReason(next);
      return;
    }
    try {
      await onSaveCustomReason(next);
      setReason(next);
      setCustomReason(next);
    } catch (error) {
      console.error('Add custom blackout reason error:', error);
      alert(error?.message || 'Unable to save the custom blackout reason.');
    }
  };

  const effectiveReasonValue = reason === 'custom' ? customReason : reason;

  return (
    <div className="space-y-4">
      {saveError && (
        <div className="rounded-lg border border-red-400 bg-red-500/10 px-3 py-2 text-sm text-red-200">{saveError}</div>
      )}
      {saveNotice && (
        <div className="rounded-lg border border-emerald-400 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{saveNotice}</div>
      )}

      <form onSubmit={submit} className="rounded-xl border border-emerald-800 bg-emerald-900/60 p-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-emerald-300">From</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-emerald-300">To (optional)</label>
            <input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} className="block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-emerald-300">Reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50">
              <option value="">Select a reason...</option>
              {reasonOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
              <option value="custom">Custom reason</option>
            </select>
          </div>
        </div>

        {reason === 'custom' && (
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-700 bg-emerald-950/60 p-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-emerald-300">Custom blackout reason</label>
              <input value={customReason} onChange={e => setCustomReason(e.target.value)} placeholder="Type your custom reason" className="block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50" />
            </div>
            <button type="button" onClick={addCustomReason} disabled={busy || !customReason.trim()} className="rounded-lg border border-emerald-500 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Save custom reason</button>
          </div>
        )}

        <div className="rounded-lg border border-emerald-700 bg-emerald-950/60 p-3">
          <label className="mb-1 block text-xs font-medium text-emerald-300">Reason to save</label>
          <input value={effectiveReasonValue || ''} readOnly className="block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50" placeholder="No reason selected" />
        </div>

        <button type="submit" disabled={busy || !startDate || !(reason === 'custom' ? customReason.trim() : reason.trim())} className="rounded-lg border border-emerald-500 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Adding...' : 'Add blackout date'}</button>
      </form>

      <section className="rounded-xl border border-emerald-800 bg-emerald-900/50 p-4">
        <h3 className="mb-3 text-sm font-bold text-emerald-100">Current blackout dates</h3>
        {loading ? (
          <p className="text-sm text-emerald-300">Loading blackout dates...</p>
        ) : loadError ? (
          <p className="text-sm text-red-300">Unable to load blackout dates: {loadError}</p>
        ) : blackouts.length === 0 ? (
          <p className="text-sm text-emerald-400">No blackout dates.</p>
        ) : (
          <div className="space-y-2">
            {blackouts.map((b) => {
              const from = b.startDate || b.date || b.blackoutDate || '';
              const to = b.endDate || from;
              return (
                <div key={b.id} className="flex w-full flex-col gap-3 rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-emerald-100">{from}{to && to !== from ? ` – ${to}` : ''}</div>
                    <div className="text-sm text-emerald-400">{b.reason || 'Blackout'}</div>
                  </div>
                  <button type="button" disabled={busy} onClick={() => onDelete(b.id)} className="shrink-0 rounded-lg border border-red-500 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50">Remove</button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function MasterLogin({ email, setEmail, password, setPassword, onSubmit, busy, error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-950 to-emerald-900 p-6 text-emerald-50">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-emerald-800 bg-emerald-900/70 p-6 shadow-xl space-y-4">
        <div>
          <h1 className="text-xl font-bold">Non-food Holidays</h1>
          <p className="mt-1 text-sm text-emerald-300">Sign in with your provisioned master account.</p>
        </div>
        {error && <div className="rounded-lg border border-red-400 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
        <label className="block text-sm text-emerald-200">
          Email
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50" />
        </label>
        <label className="block text-sm text-emerald-200">
          Password
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50" />
        </label>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function App(){
  const [roster, setRoster] = useState({ GM: [], George: [] });
  const [requests, setRequests] = useState([]);
  const [blackouts, setBlackouts] = useState([]);
  const [blackoutReasons, setBlackoutReasons] = useState([]);
  const [blackoutsLoading, setBlackoutsLoading] = useState(false);
  const [blackoutsLoadError, setBlackoutsLoadError] = useState('');
  const [tab, setTab] = useState('notifications');
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [busy, setBusy] = useState(false);

  const [newNameGM, setNewNameGM] = useState('');
  const [newNameGeorge, setNewNameGeorge] = useState('');

  const [manualList, setManualList] = useState('GM');
  const [manualName, setManualName] = useState('');
  const [manualCustomName, setManualCustomName] = useState('');
  const [manualDateFlags, setManualDateFlags] = useState({});
  const [masterConflictOverride, setMasterConflictOverride] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [authUser, setAuthUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterList, setFilterList] = useState('all');

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setIsAdmin(false);
      if (!user) {
        setAuthLoading(false);
        return;
      }
      try {
        const adminSnap = await getDoc(doc(db, 'admins', user.uid));
        setIsAdmin(adminSnap.exists() && ['admin', 'master'].includes(String(adminSnap.data().role || '').toLowerCase()));
      } catch (error) {
        console.error('Admin authorization check failed:', error);
        setAuthError('Unable to verify master access. Check Firestore permissions and try again.');
      } finally {
        setAuthLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    setBlackoutsLoading(true);
    setBlackoutsLoadError('');
    const unsub1 = subscribeRoster(setRoster);
    const unsub2 = subscribeRequests(setRequests);
    const unsub3 = subscribeBlackouts((items) => {
      setBlackouts(items);
      setBlackoutsLoading(false);
    }, (error) => {
      setBlackoutsLoadError(error?.code === 'permission-denied' ? 'Permission denied for this account.' : (error?.message || 'Unknown Firestore error.'));
      setBlackoutsLoading(false);
    });
    const unsub4 = subscribeBlackoutReasons(setBlackoutReasons, (error) => {
      setSaveError(error?.code === 'permission-denied' ? 'Permission denied while loading blackout reasons.' : (error?.message || 'Unable to load blackout reasons.'));
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [isAdmin]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginBusy(true);
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setLoginPassword('');
    } catch (error) {
      console.error('Master sign-in failed:', error);
      setAuthError('Sign-in failed. Check your email and password, then try again.');
    } finally {
      setLoginBusy(false);
    }
  };

  const addName = async (list, name) => {
    const trimmed = name.trim();
    if(!trimmed || (roster[list]||[]).includes(trimmed)) return;
    setBusy(true);
    await saveRoster({ ...roster, [list]: [...(roster[list]||[]), trimmed] });
    if(list==='GM') setNewNameGM(''); else setNewNameGeorge('');
    setBusy(false);
  };
  const removeName = async (list, name) => {
    setBusy(true);
    await saveRoster({ ...roster, [list]: (roster[list]||[]).filter(n => n !== name) });
    setBusy(false);
  };

  const addCustomBlackoutReason = async (nextReason) => {
    const created = await createBlackoutReason(nextReason);
    setBlackoutReasons(prev => [...prev.filter(item => item.id !== created.id), created]);
    return created.name;
  };

  const approveRequest = async (id) => {
    const target = requests.find(r => r.id === id);
    if (!target) return;
    const targetDates = Array.isArray(target.dates) ? target.dates : [];
    const blackoutDates = getBlackoutConflictDates(blackouts, targetDates);
    if (blackoutDates.length > 0) {
      alert(`Blackout date\n${formatFriendlyDateList(blackoutDates)} is unavailable: ${getBlackoutReasonsForDates(blackouts, blackoutDates).join(', ')}.`);
      return;
    }
    const teamConflicts = getTeamConflictDates({ requests, team: target.list, requestedDates: targetDates, ignoreRequestId: id });
    const overrideUsed = teamConflicts.length > 0 && isAdmin && masterConflictOverride;
    if (teamConflicts.length > 0 && !overrideUsed) {
      alert(`Holiday conflict\nSomeone from your team is already booked off on:\n${formatFriendlyDateList(teamConflicts)}\n\nYou cannot approve this date because only one colleague from your team can be off at a time. Use the master override to continue.`);
      return;
    }
    setBusy(true);
    try {
      await patchRequest(id, {
        status: 'approved',
        updatedAt: Date.now(),
        ...(overrideUsed ? { masterOverride: true, overrideBy: authUser.uid, overrideAt: Date.now() } : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  const denyRequest = (id) => patchRequest(id, { status: 'denied', updatedAt: Date.now() });
  const deleteRequest = (id) => patchRequest(id, { status: 'deleted', updatedAt: Date.now() });

  const submitManualApproval = async () => {
    const name = (manualCustomName.trim() || manualName).trim();
    const dates = Object.keys(manualDateFlags).filter(k=>manualDateFlags[k]).sort();

    setSaveError('');
    setSaveNotice('');

    if(!name || dates.length === 0){
      setSaveError('Please select a colleague and add at least one date.');
      return;
    }

    const blackoutDates = getBlackoutConflictDates(blackouts, dates);
    if (blackoutDates.length > 0) {
      alert(`Blackout date\n${formatFriendlyDateList(blackoutDates)} is unavailable: ${getBlackoutReasonsForDates(blackouts, blackoutDates).join(', ')}.`);
      return;
    }

    const teamConflicts = getTeamConflictDates({ requests, team: manualList, requestedDates: dates });
    const overrideUsed = teamConflicts.length > 0 && isAdmin && masterConflictOverride;
    if (teamConflicts.length > 0 && !overrideUsed) {
      alert(`Holiday conflict\nSomeone from your team is already booked off on:\n${formatFriendlyDateList(teamConflicts)}\n\nYou cannot add this date because only one colleague from your team can be off at a time. Use the master override to continue.`);
      return;
    }

    setBusy(true);
    try {
      if(!(roster[manualList]||[]).includes(name)){
        await saveRoster({ ...roster, [manualList]: [...(roster[manualList]||[]), name] });
      }

      await createRequest({
        name,
        list: manualList,
        dates,
        status: 'approved',
        manual: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(overrideUsed ? { masterOverride: true, overrideBy: authUser.uid, overrideAt: Date.now() } : {}),
      });

      setManualCustomName('');
      setManualName('');
      setManualDateFlags({});
      setMasterConflictOverride(false);
      setSaveNotice('Approved holiday entry added successfully.');
    } catch (error) {
      console.error('Manual approval failed:', error);
      const code = error?.code ? ` (${error.code})` : '';
      setSaveError(`Could not add the approved entry${code}: ${error?.message || 'Unknown error.'}`);
    } finally {
      setBusy(false);
    }
  };

  const approvedByDate = {};
  requests.filter(r => r.status === 'approved').forEach(r => {
    (r.dates || []).forEach(d => { approvedByDate[d] = approvedByDate[d] || []; approvedByDate[d].push(r); });
  });
  const pending = requests.filter(r => r.status === 'pending').sort((a,b)=>a.createdAt-b.createdAt);
  const pendingByDate = {};
  pending.forEach(r => (r.dates || []).forEach(d => {
    pendingByDate[d] = pendingByDate[d] || []; pendingByDate[d].push(r);
  }));
  const blackoutByDate = {};
  blackouts.forEach(b => {
    const start = b.startDate || b.date || b.blackoutDate;
    const end = b.endDate || start;
    if(!start) return;
    dateRangeArray(start, end).forEach(d => {
      blackoutByDate[d] = blackoutByDate[d] || [];
      blackoutByDate[d].push(b);
    });
  });
  const allSorted = [...requests].sort((a,b)=>b.updatedAt-a.updatedAt).filter(r => {
    if(filterStatus !== 'all' && r.status !== filterStatus) return false;
    if(filterList !== 'all' && r.list !== filterList) return false;
    return true;
  });

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-emerald-950 text-emerald-200">Checking authentication...</div>;
  if (!authUser) return <MasterLogin email={loginEmail} setEmail={setLoginEmail} password={loginPassword} setPassword={setLoginPassword} onSubmit={handleLogin} busy={loginBusy} error={authError} />;
  if (!isAdmin) return (
    <div className="min-h-screen flex items-center justify-center bg-emerald-950 p-6 text-emerald-50">
      <div className="w-full max-w-md rounded-2xl border border-red-800 bg-red-950/40 p-6 space-y-4">
        <h1 className="text-xl font-bold">Master access not provisioned</h1>
        <p className="text-sm text-red-200">This account is authenticated but is not listed as a master/admin in Firestore.</p>
        <button onClick={() => signOut(auth)} className="rounded-lg border border-red-400 px-4 py-2 text-sm font-semibold text-red-100">Sign out</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-950 to-emerald-900 text-emerald-50">
      <header className="bg-emerald-950/90 backdrop-blur border-b border-emerald-800 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-emerald-950"><CalendarDays size={18}/></div>
            <div>
              <h1 className="text-base font-bold leading-none tracking-tight">Non-food Holidays</h1>
              <p className="text-[11px] text-emerald-400">Admin console</p>
            </div>
          </div>
          <button onClick={() => signOut(auth)} className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900">Sign out</button>
        </div>
        <div className="max-w-5xl mx-auto px-4 pb-2 flex gap-1.5 flex-wrap">
          {[
            { id:'notifications', label:'Requests', icon: Bell, badge: pending.length },
            { id:'calendar', label:'Calendar', icon: CalendarDays },
            { id:'allRequests', label:'All Requests', icon: ListChecks },
            { id:'roster', label:'Colleagues', icon: Users },
            { id:'manual', label:'Manual Approval', icon: PenSquare },
            { id:'blackouts', label:'Blackout Dates', icon: CalendarDays },
          ].map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition ${tab===t.id ? 'bg-emerald-500 text-emerald-950' : 'bg-emerald-900 text-emerald-200 border border-emerald-800 hover:bg-emerald-800'}`}>
              <t.icon size={14}/>{t.label}
              {!!t.badge && <span className="ml-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{t.badge}</span>}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {tab === 'notifications' && (
          <div className="space-y-2">
            <h2 className="text-lg font-bold">Pending requests</h2>
            {pending.length === 0 && <p className="text-sm text-emerald-400">No pending requests right now.</p>}
            {pending.map(r => (
              <div key={r.id} className="rounded-xl border border-emerald-800 bg-emerald-900/50 p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${listChipClasses(r.list)}`}>{r.name}</span>
                  <div>
                    <p className="text-sm font-medium">{formatDatesSummary(r.dates)}</p>
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1"><Clock size={11}/> submitted {timeAgo(r.createdAt)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={()=>approveRequest(r.id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-500 text-emerald-950 font-semibold hover:bg-emerald-400"><Check size={13}/> Approve</button>
                  <button disabled={busy} onClick={()=>denyRequest(r.id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-red-500 text-red-300 hover:bg-red-500/10"><X size={13}/> Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'calendar' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-bold">{MONTH_NAMES[viewMonth]} {viewYear}</h2>
              <MonthJumpControls year={viewYear} month={viewMonth} onChange={(y,m)=>{setViewYear(y);setViewMonth(m);}} />
            </div>
            <CalendarGrid year={viewYear} month={viewMonth} approvedByDate={approvedByDate} pendingByDate={pendingByDate} blackoutByDate={blackoutByDate} />
            <div className="flex items-center gap-4 text-xs text-emerald-300 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400 border border-amber-500 inline-block"/> GM</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-black inline-block"/> George</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-700 border border-red-500 inline-block"/> Blackout</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-400 border border-gray-500 inline-block"/> Pending</span>
            </div>
          </div>
        )}

        {tab === 'allRequests' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold mr-auto">All requests</h2>
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="text-sm rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5">
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
                <option value="cancelled">Cancelled</option>
                <option value="deleted">Removed</option>
              </select>
              <select value={filterList} onChange={e=>setFilterList(e.target.value)} className="text-sm rounded-lg border border-emerald-700 bg-emerald-950 px-2 py-1.5">
                <option value="all">Both lists</option>
                <option value="GM">GM</option>
                <option value="George">George</option>
              </select>
            </div>
            {allSorted.length === 0 && <p className="text-sm text-emerald-400">No requests match this filter.</p>}
            {allSorted.map(r => {
              const badge = statusBadge(r.status);
              return (
                <div key={r.id} className="rounded-xl border border-emerald-800 bg-emerald-900/40 p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${listChipClasses(r.list)}`}>{r.name}</span>
                    <div>
                      <p className="text-sm font-medium">{formatDatesSummary(r.dates)}</p>
                      <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      {r.manual && <span className="ml-2 text-[11px] text-emerald-400">Manual entry</span>}
                    </div>
                  </div>
                  {r.status !== 'deleted' && (
                    <button disabled={busy} onClick={()=>deleteRequest(r.id)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500 text-red-300 hover:bg-red-500/10">
                      <Trash2 size={13}/> Delete
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'roster' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 space-y-3">
              <h3 className="text-sm font-bold px-2 py-1 rounded inline-block bg-amber-400 text-black">GM</h3>
              <div className="flex gap-2">
                <input value={newNameGM} onChange={e=>setNewNameGM(e.target.value)} placeholder="Add a name…"
                  className="flex-1 border border-emerald-700 bg-emerald-950 rounded-lg px-2 py-1.5 text-sm" />
                <button onClick={()=>addName('GM', newNameGM)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-emerald-950 font-semibold text-sm hover:bg-emerald-400">Add</button>
              </div>
              <div className="space-y-1.5">
                {(roster.GM||[]).map(n => (
                  <div key={n} className="flex items-center justify-between bg-amber-400 text-black rounded-lg px-2.5 py-1.5 text-sm font-medium">
                    {n}
                    <button onClick={()=>removeName('GM', n)} className="hover:text-red-700"><X size={14}/></button>
                  </div>
                ))}
                {(roster.GM||[]).length === 0 && <p className="text-xs text-emerald-400">No names yet.</p>}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 space-y-3">
              <h3 className="text-sm font-bold px-2 py-1 rounded inline-block bg-black text-white">George</h3>
              <div className="flex gap-2">
                <input value={newNameGeorge} onChange={e=>setNewNameGeorge(e.target.value)} placeholder="Add a name…"
                  className="flex-1 border border-emerald-700 bg-emerald-950 rounded-lg px-2 py-1.5 text-sm" />
                <button onClick={()=>addName('George', newNameGeorge)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-emerald-950 font-semibold text-sm hover:bg-emerald-400">Add</button>
              </div>
              <div className="space-y-1.5">
                {(roster.George||[]).map(n => (
                  <div key={n} className="flex items-center justify-between bg-black text-white rounded-lg px-2.5 py-1.5 text-sm font-medium">
                    {n}
                    <button onClick={()=>removeName('George', n)} className="hover:text-red-400"><X size={14}/></button>
                  </div>
                ))}
                {(roster.George||[]).length === 0 && <p className="text-xs text-emerald-400">No names yet.</p>}
              </div>
            </div>
          </div>
        )}

        {tab === 'manual' && (
          <div className="rounded-xl border border-emerald-800 bg-emerald-900/40 p-4 space-y-4 max-w-xl">
            <h2 className="text-lg font-bold">Manual approval</h2>
            <p className="text-xs text-emerald-400">Directly add an approved entry — for example a request made outside the app.</p>
            <div className="flex gap-2">
              <button onClick={()=>{setManualList('GM'); setManualName('');}} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${manualList==='GM' ? 'bg-amber-400 text-black' : 'bg-emerald-950 border border-emerald-700 text-emerald-200'}`}>GM</button>
              <button onClick={()=>{setManualList('George'); setManualName('');}} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${manualList==='George' ? 'bg-black text-white' : 'bg-emerald-950 border border-emerald-700 text-emerald-200'}`}>George</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-emerald-300 mb-0.5">Choose existing name</label>
                <select value={manualName} onChange={e=>{setManualName(e.target.value); setManualCustomName('');}}
                  className="w-full border border-emerald-700 bg-emerald-950 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">—</option>
                  {(roster[manualList]||[]).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-emerald-300 mb-0.5">Or type a new name</label>
                <input value={manualCustomName} onChange={e=>{setManualCustomName(e.target.value); setManualName('');}} placeholder="New colleague name"
                  className="w-full border border-emerald-700 bg-emerald-950 rounded-lg px-2 py-1.5 text-sm" />
              </div>
            </div>
            <DateBuilder dateFlags={manualDateFlags} setDateFlags={setManualDateFlags} />
            <label className="flex items-center gap-2 text-sm text-emerald-200">
              <input type="checkbox" checked={masterConflictOverride} onChange={e => setMasterConflictOverride(e.target.checked)} className="h-4 w-4 rounded border-emerald-600 bg-emerald-950 text-emerald-500" />
              Master override for team conflict
            </label>
            {saveError && (
            <div className="rounded-lg border border-red-500 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {saveError}
            </div>
          )}
          {saveNotice && (
            <div className="rounded-lg border border-emerald-500 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {saveNotice}
            </div>
          )}
            <button onClick={submitManualApproval} disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-emerald-950 font-semibold text-sm hover:bg-emerald-400 disabled:opacity-40">
              Add approved entry
            </button>
          </div>
        )}

        {tab === 'blackouts' && (
          <BlackoutManager
            blackouts={blackouts}
            busy={busy}
            defaultReasons={['Christmas shutdown', 'Bank holiday', 'Company shutdown', 'Other']}
            customReasons={blackoutReasons}
            loading={blackoutsLoading}
            loadError={blackoutsLoadError}
            saveError={saveError}
            saveNotice={saveNotice}
            onSaveCustomReason={async (reasonText) => {
              try {
                const saved = await addCustomBlackoutReason(reasonText);
                setSaveNotice(`Saved blackout reason: ${saved}`);
                setSaveError('');
                return saved;
              } catch (error) {
                const message = error?.message || 'Unable to save the custom blackout reason.';
                setSaveError(message);
                throw error;
              }
            }}
            onAdd={async (startDate, endDate, reason) => {
              setBusy(true);
              setSaveError('');
              setSaveNotice('');
              try {
                const created = await createBlackout({ startDate, endDate, reason });
                if (created) {
                  setSaveNotice(`Blackout saved for ${startDate}${endDate && endDate !== startDate ? ` to ${endDate}` : ''}.`);
                  setBlackouts(prev => [...prev, created]);
                }
              } catch (error) {
                const message = error?.message || 'Unable to save blackout date. Please check your Firestore connection and permissions.';
                console.error('Failed to create blackout:', error);
                setSaveError(message);
                throw error;
              } finally {
                setBusy(false);
              }
            }}
            onDelete={async (id) => {
              setBusy(true);
              setSaveError('');
              setSaveNotice('');
              try {
                await deleteBlackout(id);
                setSaveNotice('Blackout date removed.');
              } catch (error) {
                const message = error?.message || 'Unable to remove blackout date.';
                console.error('Failed to delete blackout:', error);
                setSaveError(message);
                throw error;
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
