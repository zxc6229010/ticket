import { verifyFirebaseIdToken } from "./_lib/firebase-auth.js";
import { getDoc, setDoc } from "./_lib/firestore.js";
import {
  badRequest,
  forbidden,
  json,
  notFound,
  norm,
  lower,
  serverError
} from "./_lib/utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await verifyFirebaseIdToken(request, env);
    const body = await request.json().catch(() => ({}));
    const token = norm(body.token);

    if (!token) {
      return badRequest("缺少 token");
    }

    const reqDoc = await getDoc(env, `campusVerificationRequests/${token}`);
    if (!reqDoc) {
      return notFound("驗證資料不存在");
    }

    const reqData = reqDoc.data || {};
    if (norm(reqData.status) !== "pending") {
      return badRequest("此驗證連結已失效或已使用");
    }

    if (norm(reqData.uid) !== user.uid) {
      return forbidden("目前登入帳號與驗證申請帳號不一致");
    }

    const expiresAt = reqData.expiresAt ? new Date(reqData.expiresAt) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return badRequest("驗證連結已過期");
    }

    const schoolId = norm(reqData.schoolId);
    const schoolName = norm(reqData.schoolName);
    const schoolEmail = lower(reqData.schoolEmail);
    const studentCode = norm(reqData.studentCode);

    await setDoc(env, `users/${user.uid}`, {
      uid: user.uid,
      email: lower(user.email),
      verifiedSchoolId: schoolId,
      verifiedSchoolName: schoolName,
      verifyMethod: "email",
      schoolEmail,
      studentCode,
      verifiedAt: new Date()
    }, true);

    await setDoc(env, `campusVerificationRequests/${token}`, {
      status: "completed",
      completedAt: new Date()
    }, true);

    return json({
      ok: true,
      verifiedSchoolId: schoolId,
      verifiedSchoolName: schoolName,
      schoolEmail
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("confirmCampusVerification error:", err);
    return serverError(err.message || "校園驗證失敗");
  }
}