const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

admin.initializeApp();

setGlobalOptions({
  region: "us-central1"
});

exports.createUserWithEmail = onCall(
  {
    cors: true
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "未登入");
    }

    const callerUid = request.auth.uid;

    const callerDoc = await admin
      .firestore()
      .collection("users")
      .doc(callerUid)
      .get();

    const callerData = callerDoc.data();

    if (!callerData || !["platform_super", "platform_admin"].includes(callerData.role)) {
      throw new HttpsError("permission-denied", "沒有權限");
    }

    const data = request.data || {};

    const email = String(data.email || "").trim();
    const role = String(data.role || "org_staff").trim();
    const orgId = String(data.orgId || "").trim();
    const schoolId = String(data.schoolId || "").trim();
    const team = String(data.team || "").trim();
    const enabled = data.enabled === true;

    if (!email) {
      throw new HttpsError("invalid-argument", "缺少 email");
    }

    const allowedRoles = ["platform_admin", "org_super", "org_admin", "org_staff"];
    if (!allowedRoles.includes(role)) {
      throw new HttpsError("invalid-argument", "角色不合法");
    }

    try {
      const tempPassword = Math.random().toString(36).slice(-10) + "A1!";

      const userRecord = await admin.auth().createUser({
        email,
        password: tempPassword,
        emailVerified: false,
        disabled: false
      });

      const uid = userRecord.uid;

      await admin.firestore().collection("users").doc(uid).set({
        uid,
        email,
        role,
        orgId,
        schoolId,
        team,
        enabled,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: callerUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: callerUid
      });

      const resetLink = await admin.auth().generatePasswordResetLink(email);

      return {
        success: true,
        uid,
        email,
        resetLink
      };
    } catch (error) {
      console.error("createUserWithEmail error:", error);
      throw new HttpsError("internal", error.message || "建立帳號失敗");
    }
  }
);