const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

admin.initializeApp();

setGlobalOptions({
  region: "us-central1"
});

exports.createUserWithEmailHttp = onRequest(async (req, res) => {  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
      method: req.method
    });
  }

  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "未登入" });
    }

    const idToken = authHeader.replace("Bearer ", "").trim();

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      return res.status(401).json({ error: "Token 驗證失敗" });
    }

    const callerUid = decodedToken.uid;
    const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
    const callerData = callerDoc.data();

    if (!callerData || !["platform_super", "platform_admin"].includes(callerData.role)) {
      return res.status(403).json({ error: "沒有權限" });
    }

    const body = req.body || {};
    const email = String(body.email || "").trim();
    const role = String(body.role || "org_staff").trim();
    const orgId = String(body.orgId || "").trim();
    const schoolId = String(body.schoolId || "").trim();
    const team = String(body.team || "").trim();
    const enabled = body.enabled === true;

    if (!email) {
      return res.status(400).json({ error: "缺少 email" });
    }

    const allowedRoles = ["platform_admin", "org_super", "org_admin", "org_staff"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "角色不合法" });
    }

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

    return res.status(200).json({
      success: true,
      uid,
      email,
      resetLink
    });
  } catch (error) {
    console.error("createUserWithEmail error:", error);
    return res.status(500).json({
      error: error.message || "建立帳號失敗"
    });
  }
});