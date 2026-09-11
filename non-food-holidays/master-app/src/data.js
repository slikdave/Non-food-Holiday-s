import { auth, db } from './firebase';
import {
  doc, setDoc, onSnapshot, collection, addDoc, updateDoc, deleteDoc, getDoc,
} from 'firebase/firestore';

const ROSTER_DOC = doc(db, 'meta', 'roster');
const REQUESTS_COL = collection(db, 'requests');
const BLACKOUTS_COL = collection(db, 'blackouts');
const BLACKOUT_REASONS_COL = collection(db, 'blackoutReasons');

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

export async function createRequest(fields) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to create a request.');
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
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in as a master to save a blackout date.');
  const now = Date.now();
  const docRef = await addDoc(BLACKOUTS_COL, {
    ...data,
    createdAt: now,
    updatedAt: now,
    createdBy: user.uid,
  });

  return { id: docRef.id, ...data, createdAt: now, updatedAt: now, createdBy: user.uid };
}

export async function deleteBlackout(id) {
  await deleteDoc(doc(db, 'blackouts', id));
}

function reasonDocumentId(name) {
  return encodeURIComponent(String(name).trim().replace(/\s+/g, ' ').toLowerCase());
}

export function subscribeBlackoutReasons(cb, onError) {
  return onSnapshot(BLACKOUT_REASONS_COL, (snap) => {
    cb(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
  }, (err) => {
    console.error('blackout reasons subscribe error', err);
    if (onError) onError(err);
  });
}

export async function createBlackoutReason(name) {
  const user = auth.currentUser;
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  if (!user) throw new Error('You must be signed in as a master to save a blackout reason.');
  if (!cleaned) throw new Error('Custom blackout reason cannot be empty.');

  const reasonRef = doc(BLACKOUT_REASONS_COL, reasonDocumentId(cleaned));
  const existing = await getDoc(reasonRef);

  if (existing.exists()) {
    const existingData = existing.data() || {};
    if (existingData.disabled === true) {
      await setDoc(reasonRef, {
        name: cleaned,
        disabled: false,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      }, { merge: true });
      return { id: reasonRef.id, name: cleaned, disabled: false };
    }
    throw new Error('That blackout reason already exists.');
  }

  const now = Date.now();
  await setDoc(reasonRef, {
    name: cleaned,
    disabled: false,
    createdAt: now,
    createdBy: user.uid,
  });

  return { id: reasonRef.id, name: cleaned, disabled: false, createdAt: now, createdBy: user.uid };
}

export async function deleteBlackoutReason(name) {
  const user = auth.currentUser;
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');

  if (!user) throw new Error('You must be signed in as a master to remove a blackout reason.');
  if (!cleaned) throw new Error('Blackout reason cannot be empty.');

  const reasonRef = doc(BLACKOUT_REASONS_COL, reasonDocumentId(cleaned));

  await setDoc(reasonRef, {
    name: cleaned,
    disabled: true,
    updatedAt: Date.now(),
    updatedBy: user.uid,
  }, { merge: true });

  return {
    id: reasonRef.id,
    name: cleaned,
    disabled: true
  };
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
