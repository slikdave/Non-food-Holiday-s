import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, Bell, CalendarDays, ListChecks, Users, PenSquare, Check, Trash2, Clock } from 'lucide-react';
import { subscribeRoster, subscribeRequests, subscribeBlackouts, saveRoster, createRequest, patchRequest, createBlackout, deleteBlackout } from './data';

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

function CalendarGrid({ year, month, approvedByDate, pendingByDate, blackoutByDate }){
  const weeks = buildMonthMatrix(year, month);
  const today = toISO(new Date());
  return (
    <div className="rounded-xl overflow-hidden border border-emerald-700">
      <div className="grid grid-cols-7 bg-emerald-800 text-emerald-50 text-xs font-semibold">
        {WEEKDAYS.map(w => <div key={w} className="text-center py-1.5">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((iso, idx) => {
          const entries = iso ? (approvedByDate[iso] || []) : [];
          const pending = iso ? (pendingByDate[iso] || []) : [];
          const blackout = iso ? (blackoutByDate[iso] || []) : [];
          const isToday = iso === today;
          return (
            <div key={idx} className={`min-h-[76px] border-b border-r border-emerald-800 p-1 align-top ${iso ? (blackout.length > 0 ? 'bg-red-950/50' : 'bg-emerald-900/55') : 'bg-emerald-900/30'}`}>
              {iso && (
                <>
                  <div className={`text-[11px] mb-1 inline-flex items-center justify-center w-5 h-5 rounded-full ${isToday ? 'bg-emerald-400 text-emerald-950 font-bold' : 'text-emerald-100'}`}>
                    {fromISO(iso).getDate()}
                  </div>
                  {blackout.length > 0 && (
                    <div className="text-[9px] leading-tight rounded px-1 py-0.5 mb-0.5 bg-red-500/25 text-red-200 border border-red-500/40 truncate font-semibold" title={blackout.map(b=>b.reason || 'Blackout date').join(', ')}>
                      {blackout[0].reason ? `BLACKOUT — ${blackout[0].reason}` : 'BLACKOUT'}
                    </div>
                  )}
                  {pending.length > 0 && (
                    <div className="text-[9px] leading-tight rounded px-1 py-0.5 mb-0.5 bg-gray-500/50 text-gray-100 border border-gray-400/40 truncate" title={pending.map(p=>`${p.name} — ${p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}`).join(', ')}>
                      Pending
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {entries.slice(0,3).map((e,i) => (
                      <div key={i} title={e.name} className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate font-medium ${listChipClasses(e.list)}`}>
                        {e.name}
                      </div>
                    ))}
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


function BlackoutManager({ blackouts = [], onAdd, onDelete, busy }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const submit = async (e) => {
    e.preventDefault();

    if (!startDate || !reason.trim()) return;

    await onAdd(
      startDate,
      endDate || startDate,
      reason.trim()
    );

    setStartDate("");
    setEndDate("");
    setReason("");
  };

  const dateValue = (b) =>
    b.startDate || b.date || b.blackoutDate || "";

  return (
    <div className="space-y-4">

      <form
        onSubmit={submit}
        className="rounded-xl border border-emerald-800 bg-emerald-900/50 p-4"
      >
        <div
          className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >

          <div className="min-w-0 w-full">
            <label className="mb-1 block text-xs font-medium text-emerald-300">
              From
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="box-border block h-10 w-full min-w-0 rounded-lg border border-emerald-700 bg-emerald-950 px-3 text-sm text-emerald-50"
            />
          </div>

          <div className="min-w-0 w-full">
            <label className="mb-1 block text-xs font-medium text-emerald-300">
              To (optional)
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="box-border block h-10 w-full min-w-0 rounded-lg border border-emerald-700 bg-emerald-950 px-3 text-sm text-emerald-50"
            />
          </div>

          <div className="min-w-0 w-full">
            <label className="mb-1 block text-xs font-medium text-emerald-300">
              Reason
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="box-border block h-10 w-full min-w-0 rounded-lg border border-emerald-700 bg-emerald-950 px-3 text-sm text-emerald-50"
            >
              <option value="">Select a reason...</option>
              <option value="Christmas shutdown">Christmas shutdown</option>
              <option value="Bank holiday">Bank holiday</option>
              <option value="Company shutdown">Company shutdown</option>
              <option value="Other">Other</option>
            </select>
          </div>

        </div>

        <button
          type="submit"
          disabled={busy || !startDate || !reason.trim()}
          className="mt-4 rounded-lg border border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Adding..." : "Add blackout date"}
        </button>
      </form>

      <section className="rounded-xl border border-emerald-800 bg-emerald-900/50 p-4">
        <h3 className="mb-3 text-sm font-bold text-emerald-100">
          Current blackout dates
        </h3>

        {blackouts.length === 0 ? (
          <p className="text-sm text-emerald-400">
            No blackout dates.
          </p>
        ) : (
          <div className="space-y-2">
            {blackouts.map((b) => {
              const from = dateValue(b);
              const to = b.endDate || from;

              return (
                <div
                  key={b.id}
                  className="flex w-full flex-col gap-3 rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-emerald-100">
                      {from}
                      {to && to !== from ? ` – ${to}` : ""}
                    </div>

                    <div className="text-sm text-emerald-400">
                      {b.reason || "Blackout"}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!b.id) return;
                      await onDelete(b.id);
                    }}
                    className="shrink-0 rounded-lg border border-red-500 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const submit = async (e) => {
    e.preventDefault();

    if (!startDate || !reason.trim()) return;

    await onAdd(
      startDate,
      endDate || startDate,
      reason.trim()
    );

    setStartDate("");
    setEndDate("");
    setReason("");
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={submit}
        className="rounded-xl border border-emerald-800 bg-emerald-900/50 p-4"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">

          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-emerald-300">
              From
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="block w-full min-w-0 rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-emerald-400"
            />
          </label>

          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-emerald-300">
              To (optional)
            </span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="block w-full min-w-0 rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-emerald-400"
            />
          </label>

          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-emerald-300">
              Reason
            </span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="block w-full min-w-0 rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-emerald-400"
            >
              <option value="">Select a reason...</option>
              <option value="Christmas shutdown">Christmas shutdown</option>
              <option value="Bank holiday">Bank holiday</option>
              <option value="Company shutdown">Company shutdown</option>
              <option value="Other">Other</option>
            </select>
          </label>

        </div>

        <div className="mt-4">
          <button
            type="submit"
            disabled={busy || !startDate || !reason.trim()}
            className="rounded-lg border border-emerald-500 bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Adding..." : "Add blackout date"}
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-emerald-800 bg-emerald-900/50 p-4">
        <h3 className="mb-3 text-sm font-bold text-emerald-100">
          Current blackout dates
        </h3>

        {(!blackouts || blackouts.length === 0) ? (
          <p className="text-sm text-emerald-400">
            No blackout dates.
          </p>
        ) : (
          <div className="space-y-2">
            {blackouts.map((b) => (
              <div
                key={b.id}
                className="flex flex-col gap-3 rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-emerald-100">
                    {b.startDate || b.date || b.blackoutDate}
                    {(b.endDate && b.endDate !== (b.startDate || b.date || b.blackoutDate))
                      ? ` – ${b.endDate}`
                      : ""}
                  </div>

                  <div className="text-sm text-emerald-400">
                    {b.reason}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(b.id)}
                  className="shrink-0 rounded-lg border border-red-500/70 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const submit = async (e) => {
    e.preventDefault();

    if (!startDate || !reason.trim()) return;

    await onAdd(
      startDate,
      endDate || startDate,
      reason.trim()
    );

    setStartDate("");
    setEndDate("");
    setReason("");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-800 bg-emerald-900/60 p-4 sm:p-5">
        <h2 className="text-lg font-bold text-emerald-50">
          Blackout dates
        </h2>

        <p className="mt-1 text-sm text-emerald-400">
          Blackout dates are visible in both apps and can only be changed here.
        </p>

        <form
          onSubmit={submit}
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <label className="block text-[11px] font-medium text-emerald-300">
            From
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-emerald-400"
            />
          </label>

          <label className="block text-[11px] font-medium text-emerald-300">
            To (optional)
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-emerald-400"
            />
          </label>

          <label className="block text-[11px] font-medium text-emerald-300">
            Reason
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-emerald-400"
            >
              <option value="">Select a reason...</option>
              <option value="Company event">Company event</option>
              <option value="Christmas shutdown">Christmas shutdown</option>
              <option value="New Year shutdown">New Year shutdown</option>
              <option value="Bank holiday">Bank holiday</option>
              <option value="System maintenance">System maintenance</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <div className="sm:col-span-3 flex flex-wrap justify-end gap-2">
            <button
              type="submit"
              disabled={busy || !startDate || !reason}
              className="rounded-lg border border-emerald-500 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-emerald-500"
            >
              {busy ? "Saving..." : "Add blackout"}
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-2">
        {blackouts.length === 0 ? (
          <p className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 text-sm text-emerald-400">
            No blackout dates configured.
          </p>
        ) : (
          blackouts.map((b) => (
            <div
              key={b.id}
              className="flex flex-col gap-3 rounded-xl border border-emerald-800 bg-emerald-900/50 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium text-emerald-50">
                  {b.startDate || b.date || b.blackoutDate}
                  {(b.endDate &&
                    b.endDate !== (b.startDate || b.date || b.blackoutDate)) &&
                    ` → ${b.endDate}`}
                </div>

                <div className="mt-1 text-sm text-emerald-400">
                  {b.reason || "Blackout"}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(b.id)}
                className="shrink-0 rounded-lg border border-red-500/70 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function App(){
  const [roster, setRoster] = useState({ GM: [], George: [] });
  const [requests, setRequests] = useState([]);
  const [blackouts, setBlackouts] = useState([]);
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

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterList, setFilterList] = useState('all');

  useEffect(() => {
    const unsub1 = subscribeRoster(setRoster);
    const unsub2 = subscribeRequests(setRequests);
    const unsub3 = subscribeBlackouts(setBlackouts);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

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

  const approveRequest = (id) => patchRequest(id, { status: 'approved', updatedAt: Date.now() });
  const denyRequest = (id) => patchRequest(id, { status: 'denied', updatedAt: Date.now() });
  const deleteRequest = (id) => patchRequest(id, { status: 'deleted', updatedAt: Date.now() });

  const submitManualApproval = async () => {
    const name = (manualCustomName.trim() || manualName).trim();
    const dates = Object.keys(manualDateFlags).filter(k=>manualDateFlags[k]).sort();
    if(!name || dates.length === 0) return;
    setBusy(true);
    if(!(roster[manualList]||[]).includes(name)){
      await saveRoster({ ...roster, [manualList]: [...(roster[manualList]||[]), name] });
    }
    await createRequest({ name, list: manualList, dates, status: 'approved', manual: true, createdAt: Date.now(), updatedAt: Date.now() });
    setManualCustomName(''); setManualName(''); setManualDateFlags({});
    setBusy(false);
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
            <div className="flex items-center gap-4 text-xs text-emerald-300">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400 border border-amber-500 inline-block"/> GM</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-black inline-block"/> George</span>
            </div>
          </div>
        )}

        {tab === 'blackouts' && (
          <BlackoutManager blackouts={blackouts} busy={busy}
            onAdd={async (startDate, endDate, reason) => {
  setBusy(true);
  try {
    const created = await createBlackout({
      startDate,
      endDate,
      reason
    });

    if (created) {
      setBlackouts(prev => [...prev, created]);
    }
  } catch (e) {
    console.error("Failed to create blackout:", e);
  } finally {
    setBusy(false);
  }
}}
            onDelete={async (id) => {
              setBusy(true);
              try { await deleteBlackout(id); }
              catch (e) { console.error(e); }
              setBusy(false);
            }} />
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
            <button onClick={submitManualApproval} disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-emerald-950 font-semibold text-sm hover:bg-emerald-400 disabled:opacity-40">
              Add approved entry
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
