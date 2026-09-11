import { auth, db } from './firebase';
import {
  doc, setDoc, onSnapshot, collection, addDoc, updateDoc, deleteDoc, getDocs,
} from 'firebase/firestore';

const ROSTER_DOC = doc(db, 'meta', 'roster');
const REQUESTS_COL = collection(db, 'requests');
const BLACKOUTS_COL = collection(db, 'blackouts');

export function subscribeRoster(cb) {
  return onSnapshot(ROSTER_DOC, (snap) => {
    cb(snap.exists() ? snap.data() : { GM: [], George: [] });
  }, (err) => console.error('roster subscribe error', err));
}

export async function saveRoster(next) {
  await setDoc(ROSTER_DOC, next);
}

export function subscribeRequests(cb) {
  return onSnapshot(REQUESTS_COL, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(list);
  }, (err) => console.error('requests subscribe error', err));
}

function toDateOnly(value) {
  const [y, m, d] = String(value || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function datesOverlapBlackout(requestedDates, blackouts) {
  return requestedDates.some((iso) => {
    const requested = toDateOnly(iso);
    if (!requested) return false;

    return blackouts.some((blackout) => {
      const start = toDateOnly(blackout.startDate || blackout.date || blackout.blackoutDate);
      const end = toDateOnly(blackout.endDate || blackout.startDate || blackout.date || blackout.blackoutDate);
      if (!start || !end) return false;
      return requested >= start && requested <= end;
    });
  });
}

export async function createRequest(fields) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to create a request.');

  // Colleague requests must always respect blackout dates.
  // Master-created manual entries are deliberately allowed so the Master
  // can override a blackout when an exceptional circumstance requires it.
  if (!fields.manual) {
    const blackoutSnap = await getDocs(BLACKOUTS_COL);
    const blackouts = blackoutSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const requestedDates = Array.isArray(fields.dates)
      ? fields.dates.map((d) => String(d))
      : [];

    if (datesOverlapBlackout(requestedDates, blackouts)) {
      throw new Error('One or more selected dates are blackout dates and cannot be requested by colleagues.');
    }
  }

  await addDoc(REQUESTS_COL, { ...fields, createdBy: user.uid });
}

export async function patchRequest(id, patch) {
  await updateDoc(doc(db, 'requests', id), patch);
}

export function subscribeBlackouts(cb, onError) {
  return onSnapshot(BLACKOUTS_COL, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(list);
  }, (err) => {
    console.error('blackouts subscribe error', err);
    if (onError) onError(err);
  });
}

export async function createBlackout(data) {
  const docRef = await addDoc(BLACKOUTS_COL, {
    ...data,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { id: docRef.id, ...data, createdAt: Date.now(), updatedAt: Date.now() };
}

export async function deleteBlackout(id) {
  await deleteDoc(doc(db, 'blackouts', id));
}

// device-specific storage (genuinely per-browser/per-device, no account involved)
export function readLocal(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
export function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}
