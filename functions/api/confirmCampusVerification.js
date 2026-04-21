import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

export async function onRequestPost(context) {
  try {
    const req = context.request;

    // 🔐 解析 Firebase Auth token
    const authHeader = req.headers.get("Authorization") || "";
    const idToken = authHeader.replace("Bearer ", "");

    if (!idToken) {
      return new Response(JSON.stringify({
        error: "未授權"
      }), { status: 401 });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const body = await req.json();
    const token = String(body.token || "").trim();

    if (!token) {
      return new Response(JSON.stringify({
        error: "缺少 token"
      }), { status: 400 });
    }

    const ref = db.collection("campusVerificationRequests").doc(token);
    const snap = await ref.get();

    if (!snap.exists) {
      return new Response(JSON.stringify({
        error: "驗證連結不存在"
      }), { status: 400 });
    }

    const data = snap.data();

    if (data.used) {
      return new Response(JSON.stringify({
        error: "此驗證連結已使用"
      }), { status: 400 });
    }

    // 👉 寫入使用者
    await db.collection("users").doc(uid).set({
      verifiedSchoolId: data.schoolId,
      verifiedSchoolName: data.schoolId,
      verifyMethod: "email",
      schoolEmail: data.schoolEmail,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 👉 標記 token 已使用
    await ref.update({
      used: true,
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      usedBy: uid
    });

    return new Response(JSON.stringify({
      ok: true,
      verifiedSchoolId: data.schoolId,
      schoolEmail: data.schoolEmail
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error(err);

    return new Response(JSON.stringify({
      error: err.message || "驗證失敗"
    }), { status: 500 });
  }
}