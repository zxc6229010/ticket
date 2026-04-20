export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) {
      return json({ error: "缺少 DB 綁定" }, 500);
    }

    const body = await context.request.json();
    const token = norm(body.token);

    if (!token) {
      return json({ error: "缺少 token" }, 400);
    }

    const verifyRecord = await getDoc(db, "campusVerificationTokens", token);
    if (!verifyRecord) {
      return json({ error: "驗證連結不存在或已失效" }, 404);
    }

    if (verifyRecord.status === "used") {
      return json({ error: "此驗證連結已使用過" }, 400);
    }

    if (Number(verifyRecord.expiresAt || 0) < Date.now()) {
      return json({ error: "此驗證連結已過期" }, 400);
    }

    const uid = norm(verifyRecord.uid);
    const schoolId = norm(verifyRecord.schoolId);
    const schoolName = norm(verifyRecord.schoolName);
    const schoolEmail = lower(verifyRecord.schoolEmail);
    const studentCode = norm(verifyRecord.studentCode);

    if (!uid || !schoolId) {
      return json({ error: "驗證資料不完整" }, 400);
    }

    const userDoc = await getDoc(db, "users", uid);
    if (!userDoc) {
      return json({ error: "找不到使用者資料" }, 404);
    }

    const oldVerifiedSchoolId = norm(userDoc.verifiedSchoolId);
    if (oldVerifiedSchoolId && oldVerifiedSchoolId !== schoolId) {
      return json({ error: "此帳號已綁定其他學校" }, 400);
    }

    const updatedUser = {
      ...userDoc,
      verifiedSchoolId: schoolId,
      verifiedSchoolName: schoolName,
      verifyMethod: "student_id_email",
      verifiedAt: Date.now(),
      schoolEmail,
      studentCode,
      updatedAt: Date.now()
    };

    await putDoc(db, "users", uid, updatedUser);

    const updatedToken = {
      ...verifyRecord,
      status: "used",
      usedAt: Date.now(),
      updatedAt: Date.now()
    };

    await putDoc(db, "campusVerificationTokens", token, updatedToken);

    return json({
      ok: true,
      schoolId,
      schoolName,
      schoolEmail
    });
  } catch (err) {
    return json({ error: err?.message || "伺服器錯誤" }, 500);
  }
}

function norm(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return norm(v).toLowerCase();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function getDoc(db, collectionName, docId) {
  const stmt = db.prepare(
    `SELECT data FROM documents WHERE collection = ? AND id = ? LIMIT 1`
  );
  const row = await stmt.bind(collectionName, docId).first();
  return row ? JSON.parse(row.data) : null;
}

async function putDoc(db, collectionName, docId, data) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO documents (collection, id, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(collection, id)
    DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);
  await stmt.bind(
    collectionName,
    docId,
    JSON.stringify(data),
    now,
    now
  ).run();
}