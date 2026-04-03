// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDtF2pHo84vy2n_dJAkCisopllaLAWjaj0",
  authDomain: "concert-1ff7e.firebaseapp.com",
  projectId: "concert-1ff7e",
  storageBucket: "concert-1ff7e.firebasestorage.app",
  messagingSenderId: "704757384914",
  appId: "1:704757384914:web:9f58e4085dd71180c5cf0b"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export async function getPartnerSchools() {
  const q = query(
    collection(db, "partnerSchools"),
    where("enabled", "==", true)
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}

export async function getPublishedApprovedEvents() {
  const q = query(
    collection(db, "events"),
    where("published", "==", true),
    where("approvalStatus", "==", "approved")
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}

export async function getEventById(eventId) {
  const snap = await getDoc(doc(db, "events", eventId));
  if (!snap.exists()) return null;
  return {
    id: snap.id,
    ...snap.data()
  };
}

export function norm(v) {
  return String(v ?? "").trim();
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#39;"
  }[m]));
}

export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleString("zh-Hant", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function formatDateOnly(value) {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleDateString("zh-Hant", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

export function getEventStatus(event) {
  const now = Date.now();
  const saleStart = toDate(event.saleStartAt)?.getTime() ?? null;
  const saleEnd = toDate(event.saleEndAt)?.getTime() ?? null;
  const eventEnd = toDate(event.eventEndAt)?.getTime() ?? null;

  if (event.published !== true) {
    return { text: "未公開", className: "status-muted", key: "all" };
  }

  if (saleStart && now < saleStart) {
    return { text: "尚未開賣", className: "status-upcoming", key: "upcoming" };
  }

  if (saleStart && saleEnd && now >= saleStart && now <= saleEnd) {
    return { text: "開賣中", className: "status-selling", key: "selling" };
  }

  if (saleEnd && eventEnd && now > saleEnd && now <= eventEnd) {
    return { text: "已截止", className: "status-ended", key: "ended" };
  }

  if (eventEnd && now > eventEnd) {
    return { text: "活動已結束", className: "status-ended", key: "ended" };
  }

  return { text: "活動資訊", className: "status-muted", key: "all" };
}