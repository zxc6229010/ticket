export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await verifyBearerUser(request, env);
    const body = await readJson(request);
    const token = norm(body.token);

    if (!token) return badRequest("缺少 token");

    const tokenPath = `campusVerificationTokens/${token}`;
    const tokenDoc = await firestoreGetDoc(env, tokenPath);

    if (!tokenDoc) return badRequest("驗證連結不存在或已失效");
    if (tokenDoc.used === true || tokenDoc.status === "used") {
      return badRequest("此驗證連結已使用");
    }

    const expiresAt = new Date(tokenDoc.expiresAt || 0);
    if (!tokenDoc.expiresAt || Number.isNaN(expiresAt.getTime()) || Date.now() > expiresAt.getTime()) {
      return badRequest("此驗證連結已過期");
    }

    if (norm(tokenDoc.uid) !== user.uid) {
      return badRequest("目前登入帳號不是原本送出驗證的帳號");
    }

    const schoolId = norm(tokenDoc.schoolId);
    const schoolName = norm(tokenDoc.schoolName);
    const schoolEmail = lower(tokenDoc.schoolEmail);
    const studentCode = norm(tokenDoc.studentCode);

    if (!schoolId || !schoolName || !schoolEmail) {
      return serverError("驗證資料不完整");
    }

    const schoolDoc = await firestoreGetDoc(env, `partnerSchools/${schoolId}`);
    if (!schoolDoc) return badRequest("找不到對應學校");
    const verificationEnabled =
      schoolDoc.verificationEnabled === true ||
      schoolDoc.verifyEnabled === true ||
      schoolDoc.campusVerifyEnabled === true;

    if (!verificationEnabled) {
      return badRequest("此校目前未開放校園驗證");
    }

    const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};
    const alreadyVerifiedSchoolId = norm(userDoc.verifiedSchoolId);

    if (alreadyVerifiedSchoolId && alreadyVerifiedSchoolId !== schoolId) {
      return badRequest("你的帳號目前已綁定其他學校");
    }

    const now = new Date().toISOString();

    await firestoreSetDoc(
      env,
      `users/${user.uid}`,
      {
        email: user.email || "",
        verifiedSchoolId: schoolId,
        verifiedSchoolName: schoolName,
        verifyMethod: "email",
        schoolEmail,
        studentCode,
        verifiedAt: now,
        pendingVerifySchoolId: "",
        pendingVerifySchoolName: "",
        pendingStudentCode: "",
        pendingSchoolEmail: "",
        pendingVerifyMethod: "",
        updatedAt: now
      },
      true
    );

    await firestoreSetDoc(
      env,
      tokenPath,
      {
        used: true,
        status: "used",
        usedAt: now,
        usedByUid: user.uid
      },
      true
    );

    return json({
      ok: true,
      message: "校園驗證成功",
      verifiedSchoolId: schoolId,
      verifiedSchoolName: schoolName,
      schoolEmail
    });
  } catch (error) {
    console.error("confirmCampusVerification error:", error);
    return handleError(error);
  }
}

/* ---------------- helpers ---------------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function badRequest(message) {
  return json({ error: message }, 400);
}

function unauthorized(message = "未授權") {
  return json({ error: message }, 401);
}

function forbidden(message = "沒有權限") {
  return json({ error: message }, 403);
}

function serverError(message = "伺服器錯誤") {
  return json({ error: message }, 500);
}

function handleError(error) {
  const msg = String(error?.message || "");
  if (msg.startsWith("401:")) return unauthorized(msg.slice(4));
  if (msg.startsWith("403:")) return forbidden(msg.slice(4));
  if (msg.startsWith("400:")) return badRequest(msg.slice(4));
  return serverError(msg || "處理失敗");
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("400:JSON 格式錯誤");
  }
}

function norm(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return norm(v).toLowerCase();
}

async function verifyBearerUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("401:缺少 Bearer Token");

  const idToken = match[1];
  const apiKey = norm(env.FIREBASE_WEB_API_KEY);
  if (!apiKey) throw new Error("500:缺少 FIREBASE_WEB_API_KEY");

  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || !Array.isArray(data.users) || !data.users.length) {
    throw new Error("401:登入狀態已失效，請重新登入");
  }

  const u = data.users[0];
  return {
    uid: norm(u.localId),
    email: lower(u.email),
    emailVerified: !!u.emailVerified
  };
}

/* ---------------- Firestore REST ---------------- */

async function firestoreGetDoc(env, path) {
  const projectId = getProjectId(env);
  const accessToken = await getGoogleAccessToken(env);

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const resp = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (resp.status === 404) return null;

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Firestore 讀取失敗：${data?.error?.message || resp.status}`);
  }

  return decodeFirestoreDoc(data);
}

async function firestoreSetDoc(env, path, data, merge = false) {
  const projectId = getProjectId(env);
  const accessToken = await getGoogleAccessToken(env);

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`
  );

  if (merge) {
    Object.keys(data).forEach((key) => {
      url.searchParams.append("updateMask.fieldPaths", key);
    });
  }

  const resp = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      fields: encodeMap(data)
    })
  });

  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Firestore 寫入失敗：${result?.error?.message || resp.status}`);
  }

  return result;
}

function getProjectId(env) {
  const projectId = norm(env.GOOGLE_PROJECT_ID);
  if (!projectId) throw new Error("500:缺少 GOOGLE_PROJECT_ID");
  return projectId;
}

async function getGoogleAccessToken(env) {
  const clientEmail = norm(env.GOOGLE_CLIENT_EMAIL);
  const privateKey = normalizePrivateKey(env.GOOGLE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    throw new Error("500:缺少 Google Service Account 環境變數");
  }

  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await signJwt(signingInput, privateKey);
  const assertion = `${signingInput}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Google Access Token 取得失敗：${data?.error_description || data?.error || resp.status}`);
  }

  return data.access_token;
}

function normalizePrivateKey(value) {
  return norm(value).replace(/\\n/g, "\n");
}

function base64UrlEncode(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwt(input, privateKeyPem) {
  const pem = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return { timestampValue: value };
    return { stringValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: encodeMap(value) } };
  }
  return { stringValue: String(value) };
}

function encodeMap(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    out[k] = encodeValue(v);
  });
  return out;
}

function decodeFirestoreDoc(doc) {
  return decodeMap(doc?.fields || {});
}

function decodeMap(fields) {
  const out = {};
  Object.entries(fields || {}).forEach(([k, v]) => {
    out[k] = decodeValue(v);
  });
  return out;
}

function decodeValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeMap(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}