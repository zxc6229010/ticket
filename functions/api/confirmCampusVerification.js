export async function onRequestPost(context) {
  try {
    const { token } = await context.request.json();

    if (!token) {
      return json({ error: "缺少 token" }, 400);
    }

    // 讀 token
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${context.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/campusVerificationTokens/${token}`,
      {
        headers: {
          "Authorization": `Bearer ${context.env.FIREBASE_SERVICE_TOKEN}`
        }
      }
    );

    if (!res.ok) {
      return json({ error: "驗證連結無效" }, 400);
    }

    const data = await res.json();
    const f = data.fields;

    const schoolId = f.schoolId.stringValue;
    const schoolEmail = f.schoolEmail.stringValue;
    const studentCode = f.studentCode.stringValue;
    const expiresAt = Number(f.expiresAt.integerValue);

    if (Date.now() > expiresAt) {
      return json({ error: "驗證連結已過期" }, 400);
    }

    // 🔥 寫入 users（⚠️ 你這裡要用登入使用者 UID）
    // 👉 這裡簡化：用 email_index 找 uid（你原本就有）

    const emailKey = schoolEmail.toLowerCase();

    const indexRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${context.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/email_index/${emailKey}`,
      {
        headers: {
          "Authorization": `Bearer ${context.env.FIREBASE_SERVICE_TOKEN}`
        }
      }
    );

    if (!indexRes.ok) {
      return json({ error: "找不到使用者" }, 400);
    }

    const indexData = await indexRes.json();
    const uid = indexData.fields.uid.stringValue;

    // 寫 users
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${context.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${context.env.FIREBASE_SERVICE_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: {
            verifiedSchoolId: { stringValue: schoolId },
            verifyMethod: { stringValue: "student_id" },
            schoolEmail: { stringValue: schoolEmail },
            studentCode: { stringValue: studentCode },
            verifiedAt: { integerValue: Date.now() }
          }
        })
      }
    );

    return json({ ok: true });

  } catch (err) {
    return json({ error: err.message }, 500);
  }
}