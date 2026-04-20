export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const RESEND_API_KEY = context.env.RESEND_API_KEY;
    const APP_BASE_URL = "https://ticket.kmshteam.org";

    if (!db) {
      return json({ error: "缺少 DB 綁定" }, 500);
    }

    if (!RESEND_API_KEY) {
      return json({ error: "缺少 RESEND_API_KEY" }, 500);
    }

    const authResult = await verifyFirebaseAuthFromRequest(context.request, context.env);
    if (!authResult.ok) {
      return json({ error: authResult.error || "未授權" }, 401);
    }

    const uid = authResult.uid;
    const userEmail = authResult.email || "";

    const body = await context.request.json();
    const schoolId = norm(body.schoolId);
    const studentCode = norm(body.studentCode);
    const schoolEmail = lower(body.schoolEmail);

    if (!schoolId) return json({ error: "缺少 schoolId" }, 400);
    if (!studentCode) return json({ error: "缺少 studentCode" }, 400);
    if (!schoolEmail) return json({ error: "缺少 schoolEmail" }, 400);

    const schoolDoc = await getDoc(db, "partnerSchools", schoolId);
    if (!schoolDoc) {
      return json({ error: "找不到校園資料" }, 404);
    }

    if (schoolDoc.enabled !== true) {
      return json({ error: "此校園目前未啟用" }, 400);
    }

    if (schoolDoc.verificationEnabled !== true) {
      return json({ error: "此校園目前未開放驗證" }, 400);
    }

    const authMethods = Array.isArray(schoolDoc.authMethods)
      ? schoolDoc.authMethods.map(v => lower(v))
      : [];

    if (!authMethods.includes("student_id")) {
      return json({ error: "此校未開放學號驗證" }, 400);
    }

    const allowedDomains = Array.isArray(schoolDoc.allowedEmailDomains)
      ? schoolDoc.allowedEmailDomains.map(v => lower(v)).filter(Boolean)
      : [];

    if (!allowedDomains.length) {
      return json({ error: "此校尚未設定信箱後綴" }, 400);
    }

    const emailDomain = schoolEmail.split("@")[1] || "";
    if (!allowedDomains.includes(emailDomain)) {
      return json({ error: "學校信箱網域不符合規定" }, 400);
    }

    const userDoc = await getDoc(db, "users", uid);
    const verifiedSchoolId = norm(userDoc?.verifiedSchoolId);

    if (verifiedSchoolId && verifiedSchoolId !== schoolId) {
      return json({ error: "你的帳號目前已綁定其他學校" }, 400);
    }

    const token = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 1000 * 60 * 30;

    const verifyRecord = {
      token,
      uid,
      userEmail,
      schoolId,
      schoolName: norm(schoolDoc.name),
      studentCode,
      schoolEmail,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt,
      usedAt: null
    };

    await putDoc(db, "campusVerificationTokens", token, verifyRecord);

    const verifyUrl = `${APP_BASE_URL}/campus-verify-success.html?token=${encodeURIComponent(token)}`;

    const emailHtml = buildAppleStyleEmail({
      schoolName: norm(schoolDoc.name || "校園"),
      schoolEmail,
      verifyUrl
    });

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Tickets 校園驗證 <campus-verify@ticket.kmshteam.org>",
        to: schoolEmail,
        subject: `完成 ${norm(schoolDoc.name || "校園")} 驗證`,
        html: emailHtml
      })
    });

    const resendData = await resendRes.json().catch(() => ({}));

    if (!resendRes.ok) {
      return json({
        error: resendData?.message || resendData?.error || "驗證信寄送失敗"
      }, 500);
    }

    return json({
      ok: true,
      message: "驗證信已寄出"
    });
  } catch (err) {
    return json({ error: err?.message || "伺服器錯誤" }, 500);
  }
}

function buildAppleStyleEmail({ schoolName, schoolEmail, verifyUrl }) {
  return `
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>校園驗證</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans TC',sans-serif;color:#1d1d1f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:28px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.08);">
          <tr>
            <td style="padding:32px 32px 20px;background:linear-gradient(180deg,#ffffff 0%,#f8f8fa 100%);border-bottom:1px solid rgba(0,0,0,.06);text-align:center;">
              <div style="width:48px;height:48px;line-height:48px;border-radius:14px;background:#111111;color:#ffffff;font-size:22px;font-weight:800;margin:0 auto 16px;">T</div>
              <div style="font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-0.04em;">校園驗證</div>
              <div style="margin-top:10px;font-size:15px;line-height:1.8;color:#6e6e73;">
                請完成你的校園身分綁定
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px;">
              <div style="font-size:16px;line-height:1.9;color:#1d1d1f;">
                你正在申請綁定 <strong>${escapeHtml(schoolName)}</strong> 的校園身分。
              </div>

              <div style="margin-top:16px;padding:16px 18px;border-radius:18px;background:#f9fafb;border:1px solid rgba(0,0,0,.06);">
                <div style="font-size:13px;color:#6e6e73;line-height:1.9;">驗證信箱</div>
                <div style="font-size:15px;font-weight:700;color:#111827;line-height:1.9;">${escapeHtml(schoolEmail)}</div>
              </div>

              <div style="margin-top:22px;font-size:14px;line-height:1.9;color:#6e6e73;">
                請點擊下方按鈕完成驗證。此連結將於 <strong>30 分鐘</strong> 後失效。
              </div>

              <div style="margin-top:26px;text-align:center;">
                <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">
                  完成校園驗證
                </a>
              </div>

              <div style="margin-top:26px;font-size:13px;line-height:1.9;color:#6e6e73;">
                如果按鈕無法點擊，請使用下方連結：
              </div>

              <div style="margin-top:8px;word-break:break-all;font-size:13px;line-height:1.9;color:#1d4ed8;">
                <a href="${escapeHtml(verifyUrl)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(verifyUrl)}</a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid rgba(0,0,0,.06);font-size:12px;line-height:1.8;color:#8a8a8e;text-align:center;">
              這封信由 Tickets 系統自動寄出，若你沒有進行此操作，可以直接忽略。
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

async function verifyFirebaseAuthFromRequest(request, env) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return { ok: false, error: "缺少 Authorization Bearer Token" };
    }

    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
      return { ok: false, error: "Token 為空" };
    }

    const payload = parseJwtPayload(idToken);
    if (!payload || !payload.user_id) {
      return { ok: false, error: "無效 token" };
    }

    return {
      ok: true,
      uid: payload.user_id,
      email: payload.email || ""
    };
  } catch (e) {
    return { ok: false, error: "Token 驗證失敗" };
  }
}

function parseJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function norm(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return norm(v).toLowerCase();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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