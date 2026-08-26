import { db } from './firebase';
import {
  doc, setDoc, onSnapshot, collection, addDoc, updateDoc,
} from 'firebase/firestore';

const ROSTER_DOC = doc(db, 'meta', 'roster');
const REQUESTS_COL = collection(db, 'requests');

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
  await addDoc(REQUESTS_COL, fields);
}

export async function patchRequest(id, patch) {
  await updateDoc(doc(db, 'requests', id), patch);
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
