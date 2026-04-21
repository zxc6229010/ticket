import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

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

async function getBearerUid(request, auth) {
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return "";

  const idToken = authHeader.slice(7).trim();
  if (!idToken) return "";

  const decoded = await auth.verifyIdToken(idToken);
  return decoded?.uid || "";
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

    const { auth, db } = getFirebaseAdmin();

    const uid = await getBearerUid(context.request, auth);
    if (!uid) {
      return json({ error: "未登入或驗證失敗" }, 401);
    }

    const body = await context.request.json();
    const schoolId = String(body.schoolId || "").trim();
    const studentCode = String(body.studentCode || "").trim();
    const schoolEmail = String(body.schoolEmail || "").trim().toLowerCase();

    if (!schoolId || !studentCode || !schoolEmail) {
      return json({ error: "缺少必要欄位" }, 400);
    }

    const schoolRef = db.collection("partnerSchools").doc(schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      return json({ error: "找不到學校資料" }, 404);
    }

    const schoolData = schoolSnap.data() || {};
    const verificationEnabled =
      schoolData.verificationEnabled === true ||
      schoolData.verifyEnabled === true ||
      schoolData.campusVerifyEnabled === true;

    if (!verificationEnabled) {
      return json({ error: "此校目前未開放驗證" }, 400);
    }

    const schoolName =
      schoolData.name ||
      schoolData.schoolName ||
      schoolData.title ||
      schoolId;

    const token = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = new Date(now + 1000 * 60 * 30); // 30分鐘有效

    await db.collection("campusVerificationTokens").doc(token).set({
      uid,
      schoolId,
      schoolName,
      studentCode,
      schoolEmail,
      verifyMethod: "email",
      status: "pending",
      used: false,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
      verifiedAt: null
    });

    const verifyUrl = `https://ticket.kmshteam.org/campus-verify-success.html?token=${encodeURIComponent(token)}`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Passium 校園驗證 <campus-verify@ticket.kmshteam.org>",
        to: schoolEmail,
        subject: "【Passium】校園驗證信",
        html: `
          <div style="margin:0;padding:0;background:#f5f5f7;">
            <div style="max-width:680px;margin:0 auto;padding:40px 20px;">
              <div style="
                background:#ffffff;
                border-radius:28px;
                overflow:hidden;
                box-shadow:0 16px 40px rgba(0,0,0,.08);
                border:1px solid rgba(0,0,0,.06);
              ">
                <div style="
                  padding:40px 32px 24px;
                  background:
                    radial-gradient(circle at top left, rgba(255,255,255,.96), rgba(255,255,255,.90) 42%, rgba(255,255,255,.84) 100%),
                    linear-gradient(180deg,#ffffff 0%, #f7f7f8 100%);
                  border-bottom:1px solid rgba(0,0,0,.06);
                ">
                  <div style="
                    display:inline-flex;
                    align-items:center;
                    justify-content:center;
                    width:40px;
                    height:40px;
                    border-radius:12px;
                    background:#111111;
                    color:#ffffff;
                    font-size:18px;
                    font-weight:900;
                    margin-bottom:18px;
                  ">P</div>

                  <h1 style="
                    margin:0;
                    font-size:32px;
                    line-height:1.1;
                    letter-spacing:-0.04em;
                    color:#1d1d1f;
                    font-weight:800;
                  ">校園驗證</h1>

                  <p style="
                    margin:14px 0 0;
                    color:#6e6e73;
                    font-size:16px;
                    line-height:1.9;
                  ">
                    你正在進行 Passium 校園身分綁定。<br>
                    請點擊下方按鈕完成驗證。
                  </p>
                </div>

                <div style="padding:28px 32px 34px;">
                  <div style="
                    border-radius:20px;
                    background:#f9fafb;
                    border:1px solid rgba(0,0,0,.06);
                    padding:18px 18px;
                    margin-bottom:22px;
                  ">
                    <div style="font-size:13px;color:#6e6e73;line-height:1.8;">系統寄送到的學校信箱</div>
                    <div style="
                      margin-top:6px;
                      font-size:15px;
                      line-height:1.8;
                      color:#111111;
                      font-weight:800;
                      word-break:break-word;
                    ">${schoolEmail}</div>
                  </div>

                  <div style="text-align:center;margin:28px 0 24px;">
                    <a href="${verifyUrl}" style="
                      display:inline-block;
                      background:#111111;
                      color:#ffffff;
                      text-decoration:none;
                      font-size:15px;
                      font-weight:800;
                      line-height:1;
                      padding:16px 28px;
                      border-radius:999px;
                    ">
                      完成校園驗證
                    </a>
                  </div>

                  <div style="
                    border-radius:18px;
                    background:#dbeafe;
                    color:#1d4ed8;
                    border:1px solid rgba(29,78,216,.12);
                    padding:14px 16px;
                    font-size:13px;
                    line-height:1.9;
                  ">
                    若按鈕無法點擊，請改用下方連結開啟：
                  </div>

                  <div style="
                    margin-top:12px;
                    padding:14px 16px;
                    border-radius:18px;
                    background:#ffffff;
                    border:1px solid rgba(0,0,0,.08);
                    font-size:13px;
                    line-height:1.9;
                    word-break:break-all;
                  ">
                    <a href="${verifyUrl}" style="color:#1d4ed8;text-decoration:none;">${verifyUrl}</a>
                  </div>

                  <p style="
                    margin:22px 0 0;
                    color:#6e6e73;
                    font-size:13px;
                    line-height:1.9;
                  ">
                    如果這不是你本人操作，請直接忽略這封信件。<br>
                    此信件僅用於校園驗證，不代表已完成活動報名資格審核。
                  </p>
                </div>
              </div>

              <div style="
                text-align:center;
                color:#8e8e93;
                font-size:12px;
                line-height:1.8;
                margin-top:18px;
              ">
                © 2026 Passium. All rights reserved.
              </div>
            </div>
          </div>
        `
      })
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      return json({ error: resendData }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message || "伺服器錯誤" }, 500);
  }
}