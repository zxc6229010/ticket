exports.requestCampusVerification = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
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

    const uid = decodedToken.uid;
    const body = req.body || {};

    const studentCode = String(body.studentCode || "").trim();
    const schoolEmail = String(body.schoolEmail || "").trim().toLowerCase();
    const schoolId = String(body.schoolId || "").trim();

    if (!studentCode || !schoolEmail || !schoolId) {
      return res.status(400).json({ error: "缺少欄位" });
    }

    const schoolRef = admin.firestore().collection("partnerSchools").doc(schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      return res.status(400).json({ error: "找不到校園設定" });
    }

    const schoolData = schoolSnap.data() || {};
    const verificationEnabled = schoolData.verificationEnabled === true;
    const allowedEmailDomains = Array.isArray(schoolData.allowedEmailDomains)
      ? schoolData.allowedEmailDomains.map(v => String(v || "").trim().toLowerCase()).filter(Boolean)
      : [];

    if (!verificationEnabled) {
      return res.status(400).json({ error: "此校園目前未開放驗證" });
    }

    if (!allowedEmailDomains.length) {
      return res.status(400).json({ error: "此校園尚未設定允許的信箱後綴" });
    }

    const domainMatched = allowedEmailDomains.some(domain => {
      return schoolEmail.endsWith("@" + domain);
    });

    if (!domainMatched) {
      return res.status(400).json({ error: "學校信箱後綴不符合校園規則" });
    }

    // 同一學號不可被其他 uid 綁定
    const existingBindings = await admin.firestore()
      .collection("campusBindings")
      .where("studentCode", "==", studentCode)
      .where("schoolId", "==", schoolId)
      .limit(1)
      .get();

    if (!existingBindings.empty) {
      const bindDoc = existingBindings.docs[0];
      if (bindDoc.id !== uid) {
        return res.status(400).json({ error: "此學號已被其他帳號綁定" });
      }
    }

    const token = admin.firestore().collection("_tmp").doc().id;
    const verifyUrl = `https://ticket.kmshteam.org/verify-campus.html?token=${encodeURIComponent(token)}`;

    await admin.firestore().collection("campusVerificationRequests").doc(token).set({
      uid,
      studentCode,
      schoolEmail,
      schoolId,
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + 1000 * 60 * 60 * 24)
      )
    });

    await admin.firestore().collection("mail").add({
      to: schoolEmail,
      message: {
        subject: "校園身分驗證通知",
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans TC',sans-serif;line-height:1.8;color:#111;">
            <h2 style="margin:0 0 12px;">校園身分驗證</h2>
            <p>你正在進行校園身份綁定。</p>
            <p>請點擊以下按鈕完成驗證：</p>
            <p>
              <a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#111;color:#fff;text-decoration:none;font-weight:700;">
                完成校園驗證
              </a>
            </p>
            <p>若按鈕無法點擊，請複製以下連結開啟：</p>
            <p style="word-break:break-all;">${verifyUrl}</p>
            <p>此連結 24 小時內有效，且僅可使用一次。</p>
          </div>
        `
      }
    });

    return res.status(200).json({
      success: true,
      message: "驗證信已寄出"
    });
  } catch (error) {
    console.error("requestCampusVerification error:", error);
    return res.status(500).json({
      error: error.message || "寄送驗證信失敗"
    });
  }
});

exports.confirmCampusVerification = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
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
    const body = req.body || {};
    const token = String(body.token || "").trim();

    if (!token) {
      return res.status(400).json({ error: "缺少 token" });
    }

    const reqRef = admin.firestore().collection("campusVerificationRequests").doc(token);
    const snap = await reqRef.get();

    if (!snap.exists) {
      return res.status(400).json({ error: "無效的驗證連結" });
    }

    const data = snap.data() || {};

    if (data.used === true) {
      return res.status(400).json({ error: "此驗證連結已使用" });
    }

    const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : null;
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: "此驗證連結已過期" });
    }

    const uid = String(data.uid || "").trim();
    const studentCode = String(data.studentCode || "").trim();
    const schoolEmail = String(data.schoolEmail || "").trim().toLowerCase();
    const schoolId = String(data.schoolId || "").trim();

    if (!uid || !studentCode || !schoolEmail || !schoolId) {
      return res.status(400).json({ error: "驗證資料不完整" });
    }

    // 同學號不可被別人綁
    const existingBindings = await admin.firestore()
      .collection("campusBindings")
      .where("studentCode", "==", studentCode)
      .where("schoolId", "==", schoolId)
      .limit(1)
      .get();

    if (!existingBindings.empty) {
      const bindDoc = existingBindings.docs[0];
      if (bindDoc.id !== uid) {
        return res.status(400).json({ error: "此學號已被其他帳號綁定" });
      }
    }

    await admin.firestore().collection("campusBindings").doc(uid).set({
      uid,
      studentCode,
      schoolEmail,
      schoolId,
      verified: true,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await reqRef.update({
      used: true,
      usedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      success: true
    });
  } catch (error) {
    console.error("confirmCampusVerification error:", error);
    return res.status(500).json({
      error: error.message || "驗證失敗"
    });
  }
});