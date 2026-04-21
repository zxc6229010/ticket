export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await verifyBearerUser(request, env);
    const body = await readJson(request);

    const schoolId = norm(body.schoolId);
    const studentCode = norm(body.studentCode);

    if (!schoolId) return badRequest("缺少 schoolId");
    if (!studentCode) return badRequest("缺少學號 / 身分代碼");

    // 取得學校資料
    const schoolDoc = await firestoreGetDoc(env, `partnerSchools/${schoolId}`);
    if (!schoolDoc) return badRequest("找不到對應學校");

    const verificationEnabled =
      schoolDoc.verificationEnabled === true ||
      schoolDoc.verifyEnabled === true ||
      schoolDoc.campusVerifyEnabled === true;

    if (!verificationEnabled) return badRequest("此校目前未開放校園驗證");

    const schoolName = norm(schoolDoc.name || schoolDoc.schoolName || schoolId);
    const emailSuffix = norm(schoolDoc.emailSuffix || schoolDoc.emailDomain || "gmail.com");
    const schoolEmail = `${studentCode}@${emailSuffix}`.toLowerCase();

    // 產生驗證 token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 分鐘後過期
    const now = new Date().toISOString();

    const baseUrl = norm(env.SITE_URL || "https://ticket.kmshteam.org");
    const verifyUrl = `${baseUrl}/campus-verify-success.html?token=${token}`;

    // 儲存 token 到 Firestore
    await firestoreSetDoc(env, `campusVerificationTokens/${token}`, {
      uid: user.uid,
      schoolId,
      schoolName,
      schoolEmail,
      studentCode,
      expiresAt,
      used: false,
      status: "pending",
      createdAt: now
    });

    // 用 Resend 寄信
    await sendVerificationEmail(env, {
      to: schoolEmail,
      schoolName,
      studentCode,
      verifyUrl
    });

    return json({ ok: true, message: "驗證信已寄出", schoolEmail });
  } catch (error) {
    console.error("requestCampusVerification error:", error);
    return handleError(error);
  }
}

/* ---------------- Resend 寄信 ---------------- */

async function sendVerificationEmail(env, { to, schoolName, studentCode, verifyUrl }) {
  const apiKey = norm(env.RESEND_API_KEY);
  if (!apiKey) throw new Error("500:缺少 RESEND_API_KEY");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "campus-verify@ticket.kmshteam.org",
      to: [to],
      subject: `【${schoolName}】校園身分驗證信`,
      html: `
        <div style="font-family:Arial,'Noto Sans TC',sans-serif;line-height:1.8;color:#111;">
          <h2 style="margin:0 0 16px;">${schoolName} 校園身分驗證</h2>

          <p>您好，這封信是用來完成 <b>${schoolName}</b> 的校園身分驗證。</p>

          <p>
            你的學號 / 身分代碼：<b>${studentCode}</b><br>
            驗證信箱：<b>${to}</b>
          </p>

          <p>請點擊下方按鈕完成驗證：</p>

          <p style="margin:24px 0;">
            <a
              href="${verifyUrl}"
              style="
                display:inline-block;
                background:#111;
                color:#fff;
                text-decoration:none;
                padding:12px 20px;
                border-radius:999px;
                font-weight:700;
              "
            >
              完成校園驗證
            </a>
          </p>

          <p style="color:#666;font-size:14px;">
            如果按鈕無法點擊，請改用以下連結：<br>
            <a href="${verifyUrl}">${verifyUrl}</a>
          </p>

          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

          <p style="color:#666;font-size:13px;">
            此信由 ticket.kmshteam.org 系統自動寄出，請勿直接回覆。
          </p>
        </div>
      `,
      text: `
${schoolName} 校園身分驗證

請開啟以下連結完成驗證：
${verifyUrl}

學號 / 身分代碼：${studentCode}
驗證信箱：${to}
      `.trim()
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`500:Resend 寄信失敗：${data?.message || data?.name || resp.status}`);
  }

  return data;
}

/* ---------------- token 產生 ---------------- */

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
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
    email: String(u.email ?? "").toLowerCase().trim(),
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
    body: JSON.stringify({ fields: encodeMap(data) })
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
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
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