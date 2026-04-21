import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

function getFirebaseAdmin() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: "concert-1ff7e",
        clientEmail: "firebase-adminsdk-xxxxx@concert-1ff7e.iam.gserviceaccount.com",
        privateKey: (globalThis.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
      })
    });
  }

  return {
    auth: getAuth(),
    db: getFirestore()
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export async function onRequestPost(context) {
  try {
    globalThis.FIREBASE_PRIVATE_KEY = context.env.FIREBASE_PRIVATE_KEY;

    const { db } = getFirebaseAdmin();
    const body = await context.request.json();
    const token = String(body.token || "").trim();

    if (!token) {
      return json({ error: "缺少 token" }, 400);
    }

    const tokenRef = db.collection("campusVerificationTokens").doc(token);
    const tokenSnap = await tokenRef.get();

    if (!tokenSnap.exists) {
      return json({ error: "驗證連結不存在或已失效" }, 404);
    }

    const tokenData = tokenSnap.data() || {};
    const used = tokenData.used === true;
    const uid = String(tokenData.uid || "").trim();
    const schoolId = String(tokenData.schoolId || "").trim();
    const schoolName = String(tokenData.schoolName || "").trim();
    const schoolEmail = String(tokenData.schoolEmail || "").trim().toLowerCase();
    const verifyMethod = String(tokenData.verifyMethod || "email").trim();

    if (!uid || !schoolId) {
      return json({ error: "驗證資料不完整" }, 400);
    }

    if (used) {
      return json({ error: "此驗證連結已使用過" }, 400);
    }

    let expiresAtMs = 0;
    try {
      if (tokenData.expiresAt?.toDate) {
        expiresAtMs = tokenData.expiresAt.toDate().getTime();
      } else if (tokenData.expiresAt) {
        expiresAtMs = new Date(tokenData.expiresAt).getTime();
      }
    } catch (_) {}

    if (!expiresAtMs || Date.now() > expiresAtMs) {
      return json({ error: "此驗證連結已過期" }, 400);
    }

    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (tx) => {
      const freshTokenSnap = await tx.get(tokenRef);
      if (!freshTokenSnap.exists) {
        throw new Error("驗證連結不存在");
      }

      const freshToken = freshTokenSnap.data() || {};
      if (freshToken.used === true) {
        throw new Error("此驗證連結已使用過");
      }

      tx.set(userRef, {
        verifiedSchoolId: schoolId,
        verifiedSchoolName: schoolName,
        verifyMethod,
        schoolEmail,
        verifiedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      tx.update(tokenRef, {
        used: true,
        status: "verified",
        verifiedAt: FieldValue.serverTimestamp()
      });
    });

    return json({
      ok: true,
      schoolId,
      schoolName,
      schoolEmail
    });
  } catch (err) {
    return json({ error: err.message || "驗證失敗" }, 500);
  }
}