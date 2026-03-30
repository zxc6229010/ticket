// ====== Firebase SDK (v9) ======
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// 把這裡換成你 Firebase Console 的設定
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