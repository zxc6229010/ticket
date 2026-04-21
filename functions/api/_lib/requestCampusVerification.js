import { verifyFirebaseIdToken } from "./_lib/firebase-auth.js";
import { getDoc, setDoc } from "./_lib/firestore.js";
import { sendMail } from "./_lib/mail.js";
import {
  badRequest,
  forbidden,
  json,
  notFound,
  randomToken,
  addMinutes,
  norm,
  lower,
  serverError
} from "./_lib/utils.js";

function getSchoolName(school) {
  return norm(school?.name || school?.schoolName || school?.title || school?.id || "");
}

function getVerifyEnabled(school) {
  return (
    school?.verificationEnabled === true ||
    school?.verifyEnabled === true ||
    school?.campusVerifyEnabled === true
  );
}

function getAuthMethods(school) {
  if (Array.isArray(school?.authMethods) && school.authMethods.length) {
    return school.authMethods.map((v) => lower(v));
  }
  const oldMode = lower(school?.verifyMode || school?.campusVerifyMode || "");
  if (oldMode === "google") return ["google"];
  if (oldMode === "email") return ["student_id"];
  return [];
}

function getAllowedEmailDomains(school) {
  if (Array.isArray(school?.allowedEmailDomains)) {
    return school.allowedEmailDomains.map((v) => lower(v)).filter(Boolean);
  }
  return [
    lower(school?.schoolEmailDomain || ""),
    lower(school?.verifyEmailDomain || "")
  ].filter(Boolean);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await verifyFirebaseIdToken(request, env);
    const body = await request.json().catch(() => ({}));

    const schoolId = norm(body.schoolId);
    const studentCode = norm(body.studentCode);
    const schoolEmail = lower(body.schoolEmail);

    if (!schoolId || !studentCode || !schoolEmail) {
      return badRequest("缺少必要欄位");
    }

    const schoolDoc = await getDoc(env, `partnerSchools/${schoolId}`);
    if (!schoolDoc) {
      return notFound("找不到校園資料");
    }

    const school = schoolDoc.data || {};
    if (!getVerifyEnabled(school)) {
      return forbidden("此校目前未開放校園驗證");
    }

    const methods = getAuthMethods(school);
    if (!methods.includes("student_id")) {
      return forbidden("此校目前不是 Email 驗證模式");
    }

    const domains = getAllowedEmailDomains(school);
    if (!domains.length) {
      return serverError("此校未設定學校信箱後綴");
    }

    const expectedEmail = `${studentCode}@${domains[0]}`.toLowerCase();
    if (schoolEmail !== expectedEmail) {
      return badRequest("學校信箱格式不正確");
    }

    const token = randomToken();
    const now = new Date();
    const expiresAt = addMinutes(now, 30);

    await setDoc(env, `campusVerificationRequests/${token}`, {
      token,
      uid: user.uid,
      email: lower(user.email),
      schoolId,
      schoolName: getSchoolName(school),
      studentCode,
      schoolEmail,
      verifyMethod: "email",
      status: "pending",
      createdAt: now,
      expiresAt
    }, false);

    const verifyUrl = `${env.APP_ORIGIN}/campus-verify-complete.html?token=${encodeURIComponent(token)}`;

    await sendMail(env, {
      to: schoolEmail,
      subject: `【Passium】校園驗證信`,
      text:
`你好：

你正在為 Passium 帳號申請校園驗證。

請點擊以下連結完成驗證：
${verifyUrl}

如果這不是你本人操作，請忽略這封信。
此連結 30 分鐘後失效。`,
      html:
`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans TC',sans-serif;line-height:1.8;color:#111;">
  <h2>Passium 校園驗證</h2>
  <p>你正在為 Passium 帳號申請校園驗證。</p>
  <p>請點擊以下按鈕完成驗證：</p>
  <p>
    <a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:999px;">
      完成校園驗證
    </a>
  </p>
  <p>如果按鈕無法點擊，請直接複製這個連結：</p>
  <p>${verifyUrl}</p>
  <p>此連結 30 分鐘後失效。</p>
</div>`
    });

    return json({
      ok: true,
      message: "驗證信已寄出"
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("requestCampusVerification error:", err);
    return serverError(err.message || "寄送驗證信失敗");
  }
}