import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, Bell, CalendarDays, ListChecks, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { subscribeRoster, subscribeRequests, subscribeBlackouts, createRequest, patchRequest, readLocal, writeLocal } from './data';
import { auth } from './firebase';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const NAME_KEY = 'device-active-name';
const DISMISS_KEY_PREFIX = 'dismissed-';

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
function formatFriendlyDateList(dates){
  return (Array.isArray(dates) ? dates : []).map((date) => {
    if (!date) return '';
    const d = fromISO(String(date));
    return `${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getDate()}`;
  }).filter(Boolean).join(', ');
}
function getTeamConflictDates({ requests = [], team, requestedDates = [] }){
  const teamName = String(team ?? '').trim();
  if (!['GM', 'George'].includes(teamName)) return [];
  const occupying = (requests || []).filter((request) => {
    if (!request) return false;
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
    return match?.reason || 'Restricted Dates date';
  });
}

function listChipClasses(list){
  return list === 'GM'
    ? 'bg-amber-400 text-black border border-amber-500'
    : 'bg-black text-white border border-black';
}
function statusBadge(status){
  switch(status){
    case 'pending': return { label: 'Pending', cls: 'bg-yellow-100 text-yellow-800 border border-yellow-300' };
    case 'approved': return { label: 'Approved', cls: 'bg-green-100 text-green-800 border border-green-300' };
    case 'denied': return { label: 'Denied', cls: 'bg-red-100 text-red-700 border border-red-300' };
    case 'cancelled': return { label: 'Cancelled by you', cls: 'bg-gray-100 text-gray-600 border border-gray-300' };
    case 'deleted': return { label: 'Removed by admin', cls: 'bg-gray-200 text-gray-600 border border-gray-300' };
    default: return { label: status, cls: 'bg-gray-100 text-gray-600 border border-gray-300' };
  }
}

function MonthJumpControls({ year, month, onChange }){
  const years = [];
  const nowY = new Date().getFullYear();
  for(let y = nowY - 2; y <= nowY + 4; y++) years.push(y);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={() => { let m = month-1, y = year; if(m<0){m=11;y--;} onChange(y,m); }}
        className="p-1.5 rounded-lg bg-white border border-green-300 hover:bg-green-50 text-green-800">
        <ChevronLeft size={16} />
      </button>
      <select value={month} onChange={e => onChange(year, Number(e.target.value))}
        className="rounded-lg border border-green-300 bg-white text-green-900 text-sm px-2 py-1.5 font-medium">
        {MONTH_NAMES.map((m,i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <select value={year} onChange={e => onChange(Number(e.target.value), month)}
        className="rounded-lg border border-green-300 bg-white text-green-900 text-sm px-2 py-1.5 font-medium">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <button onClick={() => { let m = month+1, y = year; if(m>11){m=0;y++;} onChange(y,m); }}
        className="p-1.5 rounded-lg bg-white border border-green-300 hover:bg-green-50 text-green-800">
        <ChevronRight size={16} />
      </button>
      <button onClick={() => { const n = new Date(); onChange(n.getFullYear(), n.getMonth()); }}
        className="text-xs px-2 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50">Today</button>
    </div>
  );
}

function CalendarGrid({ year, month, approvedByDate = {}, requests = [], blackoutByDate = {} }) {
  const weeks = buildMonthMatrix(year, month);
  const today = toISO(new Date());
  const pendingByDate = {};
  requests.filter(r => r && r.status === 'pending').forEach(r => {
    if (!Array.isArray(r.dates)) return;
    r.dates.forEach(iso => {
      if (!pendingByDate[iso]) pendingByDate[iso] = [];
      pendingByDate[iso].push({ ...r, status: 'pending' });
    });
  });

  return (
    <div className="calendar-light-green rounded-xl overflow-hidden border border-green-200 bg-white">
      <div className="grid grid-cols-7 bg-green-600 text-white text-xs font-semibold">
        {WEEKDAYS.map(w => (<div key={w} className="text-center py-1.5">{w}</div>))}
      </div>

      <div className="grid grid-cols-7">
        {weeks.flat().map((iso, idx) => {
          const approved = iso ? (approvedByDate[iso] || []) : [];
          const pending = iso ? (pendingByDate[iso] || []) : [];
          const blackout = iso ? (blackoutByDate[iso] || []) : [];
          const entries = [...approved.map(e => ({ ...e, status: 'approved' })), ...pending];
          const isToday = iso === today;

          return (
            <div key={idx} className={`bg-green-50 text-green-900 min-h-[76px] border-b border-r border-green-100 p-1 align-top ${iso ? (blackout.length > 0 ? 'bg-red-950/10' : 'bg-green-50') : 'bg-green-50/40'}`}>
              {iso && (
                <>
                  <div className={`text-[11px] mb-1 inline-flex items-center justify-center w-5 h-5 rounded-full ${isToday ? 'bg-green-600 text-white font-bold' : 'text-green-800'}`}>
                    {fromISO(iso).getDate()}
                  </div>

                  {blackout.length > 0 && (
                    <div className="text-[9px] leading-tight rounded px-1 py-0.5 mb-0.5 bg-red-600/20 text-red-700 border border-red-400/40 truncate font-semibold" title={blackout.map(b => b.reason || 'Blackout date').join(', ')}>
                      BLACKOUT
                    </div>
                  )}

                  <div className="flex flex-col gap-0.5">
                    {entries.slice(0, 3).map((e, i) => {
                      const isPending = e.status === 'pending';
                      return (
                        <div key={e.id || `${iso}-${e.name}-${i}`} title={`${e.name} — ${isPending ? 'Pending' : 'Approved'}`} className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate font-medium ${isPending ? 'bg-gray-200 text-gray-500 border border-gray-300' : listChipClasses(e.list)}`}>
                          {e.name}
                        </div>
                      );
                    })}
                    {entries.length > 3 && (<div className="text-[9px] text-green-700">+{entries.length - 3} more</div>)}
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

function RequestBuilder({ onSubmit, disabled }){
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [singleDay, setSingleDay] = useState('');
  const [dateFlags, setDateFlags] = useState({});

  const addRange = () => {
    if(!rangeStart || !rangeEnd) return;
    const days = dateRangeArray(rangeStart, rangeEnd);
    setDateFlags(prev => { const next = { ...prev }; days.forEach(d => { next[d] = true; }); return next; });
  };
  const addSingle = () => {
    if(!singleDay) return;
    setDateFlags(prev => ({ ...prev, [singleDay]: true }));
    setSingleDay('');
  };
  const removeDate = (iso) => setDateFlags(prev => { const n = { ...prev }; delete n[iso]; return n; });
  const selectedDates = Object.keys(dateFlags).filter(k => dateFlags[k]).sort();

  const submit = () => {
    if(selectedDates.length === 0) return;
    onSubmit(selectedDates);
    setDateFlags({}); setRangeStart(''); setRangeEnd('');
  };

  return (
    <div className="rounded-xl border border-green-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-green-900">New time off request</h3>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[11px] text-green-700 mb-0.5">From</label>
          <input type="date" value={rangeStart} onChange={e=>setRangeStart(e.target.value)} className="border border-green-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] text-green-700 mb-0.5">To</label>
          <input type="date" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)} className="border border-green-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <button onClick={addRange} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500">Add range</button>
        <div className="w-px h-8 bg-green-200 mx-1" />
        <div>
          <label className="block text-[11px] text-green-700 mb-0.5">Add single day</label>
          <input type="date" value={singleDay} onChange={e=>setSingleDay(e.target.value)} className="border border-green-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <button onClick={addSingle} className="px-2 py-1.5 rounded-lg border border-green-400 text-green-700 hover:bg-green-50"><Plus size={16} /></button>
      </div>

      {selectedDates.length > 0 && (
        <div>
          <p className="text-[11px] text-green-700 mb-1">Days included — remove any day you don't need:</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedDates.map(iso => (
              <span key={iso} className="inline-flex items-center gap-1 bg-green-100 text-green-900 text-xs px-2 py-1 rounded-full border border-green-300">
                {fmtShort(iso)}
                <button onClick={()=>removeDate(iso)} className="hover:text-red-600"><X size={12}/></button>
              </span>
            ))}
          </div>
        </div>
      )}

      <button disabled={disabled || selectedDates.length===0} onClick={submit} className="w-full sm:w-auto px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed">
        Submit request ({selectedDates.length} day{selectedDates.length===1?'':'s'})
      </button>
    </div>
  );
}

function HomeScreen({ roster, onSelect }){
  const [choice, setChoice] = useState('');
  const hasAny = (roster.GM?.length||0) + (roster.George?.length||0) > 0;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-green-50 to-green-100 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-green-200 p-6 space-y-4">
        <div className="text-center space-y-1">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-600 flex items-center justify-center text-white"><CalendarDays size={22} /></div>
          <h1 className="text-xl font-bold text-green-900">Holiday Requests</h1>
          <p className="text-sm text-green-700">Select your name to continue</p>
        </div>
        {!hasAny && (<p className="text-xs text-center text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">No colleagues have been added yet. Ask your admin to add names in Non-food Holidays.</p>)}
        <select value={choice} onChange={e=>setChoice(e.target.value)} className="w-full border border-green-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Choose your name…</option>
          {roster.GM?.length > 0 && (<optgroup label="GM">{roster.GM.map(n => <option key={'gm-'+n} value={JSON.stringify({name:n,list:'GM'})}>{n}</option>)}</optgroup>)}
          {roster.George?.length > 0 && (<optgroup label="George">{roster.George.map(n => <option key={'g-'+n} value={JSON.stringify({name:n,list:'George'})}>{n}</option>)}</optgroup>)}
        </select>
        <button disabled={!choice} onClick={() => onSelect(JSON.parse(choice))} className="w-full py-2.5 rounded-lg bg-green-700 text-white font-semibold hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed">Continue</button>
      </div>
    </div>
  );
}

export default function App(){
  const [roster, setRoster] = useState({ GM: [], George: [] });
  const [requests, setRequests] = useState([]);
  const [blackouts, setBlackouts] = useState([]);
  const [active, setActive] = useState(() => readLocal(NAME_KEY, null));
  const [tab, setTab] = useState('calendar');
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [dismissed, setDismissed] = useState([]);
  const [busy, setBusy] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthLoading(false);
    });
    signInAnonymously(auth).catch((error) => {
      console.error('Companion authentication failed:', error);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authUser) return undefined;
    const unsub1 = subscribeRoster(setRoster);
    const unsub2 = subscribeRequests(setRequests);
    const unsub3 = subscribeBlackouts(setBlackouts);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [authUser]);

  useEffect(() => {
    if(!active) return;
    setDismissed(readLocal(DISMISS_KEY_PREFIX + active.name, []));
  }, [active]);

  const handleSelectName = (choice) => {
    setActive(choice);
    writeLocal(NAME_KEY, choice);
  };

  const submitRequest = async (dates) => {
    if (!active) return;
    setBusy(true);

    try {
      const requestedDates = Array.isArray(dates) ? dates.map(d => String(d)) : [];
      const blackoutDates = getBlackoutConflictDates(blackouts, requestedDates);
      if (blackoutDates.length > 0) {
        alert(`Unavailable — Blackout date\n${formatFriendlyDateList(blackoutDates)}: ${getBlackoutReasonsForDates(blackouts, blackoutDates).join(', ')}.`);
        return;
      }

      const conflicts = getTeamConflictDates({ requests, team: active.list, requestedDates });
      if (conflicts.length > 0) {
        alert(`Holiday conflict\nSomeone from your team is already booked off on:\n${formatFriendlyDateList(conflicts)}\n\nYou cannot request this date because only one colleague from your team can be off at a time.`);
        return;
      }

      await createRequest({
        name: active.name,
        list: active.list,
        dates: requestedDates,
        status: 'pending',
        manual: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error('submitRequest error:', error);
      alert('Unable to submit the holiday request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (id) => {
    setBusy(true);
    await patchRequest(id, { status: 'cancelled', updatedAt: Date.now() });
    setBusy(false);
  };

  const dismissNotification = (id, status) => {
    if(!active) return;
    const next = [...dismissed, id + ':' + status];
    setDismissed(next);
    writeLocal(DISMISS_KEY_PREFIX + active.name, next);
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-green-50 text-green-800">Connecting...</div>;
  }
  if (!authUser) {
    return <div className="min-h-screen flex items-center justify-center bg-green-50 p-6 text-center text-red-700">Unable to connect securely. Please refresh and try again.</div>;
  }
  if(!active){
    return <HomeScreen roster={roster} onSelect={handleSelectName} />;
  }

  const approvedByDate = {};
  requests.filter(r => r.status === 'approved').forEach(r => {
    (r.dates || []).forEach(d => { approvedByDate[d] = approvedByDate[d] || []; approvedByDate[d].push(r); });
  });

  const blackoutByDate = {};
  blackouts.forEach((b) => {
    const start = b.startDate || b.date || b.blackoutDate;
    const end = b.endDate || start;
    if (!start) return;
    dateRangeArray(start, end).forEach((d) => {
      blackoutByDate[d] = blackoutByDate[d] || [];
      blackoutByDate[d].push(b);
    });
  });

  const myRequests = requests.filter(r => r.name === active.name).sort((a,b)=>b.createdAt-a.createdAt);
  const myNotifications = requests.filter(r => r.name === active.name && (r.status === 'approved' || r.status === 'denied') && !dismissed.includes(r.id + ':' + r.status));

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-green-100">
      <header className="bg-white/80 backdrop-blur border-b border-green-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center text-white"><CalendarDays size={18}/></div>
            <div>
              <h1 className="text-base font-bold text-green-900 leading-none">Holiday Requests</h1>
              <p className="text-[11px] text-green-600">Signed in as <span className="font-semibold">{active.name}</span></p>
            </div>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-2 flex gap-1.5">
          {[
            { id:'calendar', label:'Calendar', icon: CalendarDays },
            { id:'myRequests', label:'My Requests', icon: ListChecks },
            { id:'notifications', label:'Notifications', icon: Bell, badge: myNotifications.length },
          ].map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition ${tab===t.id ? 'bg-green-600 text-white' : 'bg-white text-green-700 border border-green-200 hover:bg-green-50'}`}>
              <t.icon size={14}/>{t.label}
              {!!t.badge && <span className="ml-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{t.badge}</span>}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {tab === 'calendar' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-bold text-green-900">{MONTH_NAMES[viewMonth]} {viewYear}</h2>
              <MonthJumpControls year={viewYear} month={viewMonth} onChange={(y,m)=>{setViewYear(y);setViewMonth(m);}} />
            </div>
            <p className="text-xs text-green-700">Everyone's approved time off — see who's already off before you request.</p>
            <CalendarGrid year={viewYear} month={viewMonth} approvedByDate={approvedByDate} requests={requests} blackoutByDate={blackoutByDate} />
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-green-700">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 border border-amber-500 inline-block" />GM</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-black border border-black inline-block" />George</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-600/20 border border-red-400/40 inline-block" />Restricted</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-400 border border-gray-500 inline-block" />Pending</span>
            </div>
          </div>
        )}

        {tab === 'myRequests' && (
          <div className="space-y-4">
            <RequestBuilder onSubmit={submitRequest} disabled={busy} />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-green-900">Your requests</h3>
              {myRequests.length === 0 && <p className="text-sm text-green-600">No requests yet.</p>}
              {myRequests.map(r => {
                const badge = statusBadge(r.status);
                const canCancel = r.status === 'pending' || r.status === 'approved';
                return (
                  <div key={r.id} className="rounded-xl border border-green-200 bg-white p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-green-900">{formatDatesSummary(r.dates)}</p>
                      <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      {r.manual && <span className="ml-2 text-[11px] text-green-500">Added by admin</span>}
                    </div>
                    {canCancel && (
                      <button onClick={()=>cancelRequest(r.id)} disabled={busy} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
                        <Trash2 size={13}/> Cancel
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-green-900">Notifications</h3>
            {myNotifications.length === 0 && <p className="text-sm text-green-600">You're all caught up.</p>}
            {myNotifications.map(r => (
              <div key={r.id} className={`rounded-xl border p-3 flex items-center justify-between gap-3 flex-wrap ${r.status==='approved' ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                <div className="flex items-center gap-2">
                  {r.status === 'approved' ? <CheckCircle2 size={18} className="text-green-600"/> : <XCircle size={18} className="text-red-500"/>}
                  <div>
                    <p className="text-sm font-medium text-green-900">Your request for {formatDatesSummary(r.dates)} was {r.status}.</p>
                  </div>
                </div>
                <button onClick={()=>dismissNotification(r.id, r.status)} className="text-xs px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-100">Dismiss</button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
