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
    const body = await req.json();

    const schoolId = String(body.schoolId || "").trim();
    const studentCode = String(body.studentCode || "").trim();
    const schoolEmail = String(body.schoolEmail || "").trim().toLowerCase();

    if (!schoolId || !studentCode || !schoolEmail) {
      return new Response(JSON.stringify({
        error: "缺少必要欄位"
      }), { status: 400 });
    }

    // 產生 token
    const token = crypto.randomUUID();

    await db.collection("campusVerificationRequests").doc(token).set({
      schoolId,
      studentCode,
      schoolEmail,
      token,
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 👉 這裡你之後可以接寄信
    const verifyUrl = `${new URL(req.url).origin}/campus-verify-complete.html?token=${token}`;

    return new Response(JSON.stringify({
      ok: true,
      verifyUrl
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error(err);

    return new Response(JSON.stringify({
      error: err.message || "伺服器錯誤"
    }), { status: 500 });
  }
}