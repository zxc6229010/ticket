export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await verifyBearerUser(request, env);

    const body = await readJson(request);
    const schoolId = norm(body.schoolId);
    const studentCode = norm(body.studentCode);
    const schoolEmail = lower(body.schoolEmail);

    if (!schoolId) return badRequest("缺少 schoolId");
    if (!studentCode) return badRequest("請輸入學號 / 身分代碼");
    if (!schoolEmail) return badRequest("缺少 schoolEmail");

    const schoolDoc = await firestoreGetDoc(env, `partnerSchools/${schoolId}`);
    if (!schoolDoc) return badRequest("找不到此校園");

    const schoolName = norm(
      schoolDoc.name ||
      schoolDoc.schoolName ||
      schoolDoc.title ||
      schoolId
    );

    const verificationEnabled =
      schoolDoc.verificationEnabled === true ||
      schoolDoc.verifyEnabled === true ||
      schoolDoc.campusVerifyEnabled === true;

    if (!verificationEnabled) {
      return badRequest("此校目前未開放校園驗證");
    }

    const authMethods = getAuthMethods(schoolDoc);
    if (!authMethods.includes("student_id")) {
      return badRequest("此校目前不是 Email 驗證模式");
    }

    const allowedDomains = getAllowedEmailDomains(schoolDoc);
    if (!allowedDomains.length) {
      return badRequest("此校尚未設定可用的學校信箱後綴");
    }

    const emailDomainOk = allowedDomains.some((domain) =>
      schoolEmail.endsWith(`@${domain}`)
    );
    if (!emailDomainOk) {
      return badRequest("學校信箱後綴不符合此校設定");
    }

    const userDoc = (await firestoreGetDoc(env, `users/${user.uid}`)) || {};

    const alreadyVerifiedSchoolId = norm(userDoc.verifiedSchoolId);
    if (alreadyVerifiedSchoolId && alreadyVerifiedSchoolId !== schoolId) {
      return badRequest("你的帳號目前已綁定其他學校，不能直接改綁");
    }

    if (alreadyVerifiedSchoolId === schoolId) {
      return json({
        ok: true,
        message: "你已經完成這間學校的驗證",
        alreadyVerified: true,
        verifiedSchoolId: schoolId,
        verifiedSchoolName: schoolName
      });
    }

    const token = crypto.randomUUID().replace(/-/g, "") + randomString(16);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 30);

    const tokenDocPath = `campusVerificationTokens/${token}`;

    await firestoreSetDoc(env, tokenDocPath, {
      token,
      status: "pending",
      uid: user.uid,
      loginEmail: lower(user.email),
      schoolId,
      schoolName,
      studentCode,
      schoolEmail,
      verifyMethod: "email",
      used: false,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    await firestoreSetDoc(
      env,
      `users/${user.uid}`,
      {
        email: user.email || "",
        pendingVerifySchoolId: schoolId,
        pendingVerifySchoolName: schoolName,
        pendingStudentCode: studentCode,
        pendingSchoolEmail: schoolEmail,
        pendingVerifyMethod: "email",
        pendingVerifyCreatedAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      true
    );

    const baseUrl = norm(env.PUBLIC_BASE_URL || "");
    if (!baseUrl) {
      return serverError("缺少 PUBLIC_BASE_URL 環境變數");
    }

    const verifyUrl = `${baseUrl.replace(/\/+$/, "")}/campus-verify-success.html?token=${encodeURIComponent(token)}`;

    const subject = `【${schoolName}】校園驗證信`;
    const html = `
      <div style="font-family:Arial,'Noto Sans TC',sans-serif;line-height:1.8;color:#111;">
        <h2 style="margin:0 0 16px;">Passium 校園驗證</h2>
        <p>你好，這封信是寄給 <strong>${escapeHtml(schoolEmail)}</strong> 的校園驗證確認信。</p>
        <p>你申請綁定的學校為：<strong>${escapeHtml(schoolName)}</strong></p>
        <p>學號 / 身分代碼：<strong>${escapeHtml(studentCode)}</strong></p>
        <p>請點擊下方按鈕完成驗證：</p>
        <p style="margin:24px 0;">
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:999px;font-weight:700;">
            完成校園驗證
          </a>
        </p>
        <p>若按鈕無法點擊，可直接開啟以下連結：</p>
        <p style="word-break:break-all;">${verifyUrl}</p>
        <p>此連結 30 分鐘內有效，且僅限目前發起驗證的帳號使用。</p>
      </div>
    `;

    await sendMail(env, {
      to: schoolEmail,
      subject,
      html
    });

    return json({
      ok: true,
      message: "驗證信已寄出",
      schoolId,
      schoolName,
      schoolEmail
    });
  } catch (error) {
    console.error("requestCampusVerification error:", error);
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

function randomString(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const arr = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function getAllowedEmailDomains(school) {
  if (Array.isArray(school?.allowedEmailDomains)) {
    return school.allowedEmailDomains.map(lower).filter(Boolean);
  }
  return [
    lower(school?.schoolEmailDomain),
    lower(school?.verifyEmailDomain)
  ].filter(Boolean);
}

function getAuthMethods(school) {
  if (Array.isArray(school?.authMethods) && school.authMethods.length) {
    return school.authMethods.map(lower);
  }

  const oldMode = lower(school?.verifyMode || school?.campusVerifyMode);
  if (oldMode === "google") return ["google"];
  if (oldMode === "email") return ["student_id"];
  return [];
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

async function sendMail(env, { to, subject, html }) {
  const apiKey = norm(env.RESEND_API_KEY);
  const fromEmail = norm(env.RESEND_FROM_EMAIL);
  const fromName = norm(env.RESEND_FROM_NAME || "Passium");

  if (!apiKey) {
    throw new Error("缺少 RESEND_API_KEY");
  }

  if (!fromEmail) {
    throw new Error("缺少 RESEND_FROM_EMAIL");
  }

  const from = `${fromName} <${fromEmail}>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html
    })
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(`Resend 寄信失敗：${data?.message || data?.error || resp.status}`);
  }

  return data;
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
  if (typeof value === "string") return { stringValue: value };
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
    if (isIsoDateString(value)) return { timestampValue: value };
    return { mapValue: { fields: encodeMap(value) } };
  }
  return { stringValue: String(value) };
}

function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value);
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