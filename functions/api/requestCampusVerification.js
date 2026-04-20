export async function onRequestPost(context) {
  try {
    const { schoolId, studentCode, schoolEmail } = await context.request.json();

    if (!schoolId || !studentCode || !schoolEmail) {
      return json({ error: "缺少必要欄位" }, 400);
    }

    const token = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 1000 * 60 * 30;

    // 🔥 存到 Firestore（用 REST API）
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${context.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/campusVerificationTokens/${token}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${context.env.FIREBASE_SERVICE_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: {
            token: { stringValue: token },
            schoolId: { stringValue: schoolId },
            studentCode: { stringValue: studentCode },
            schoolEmail: { stringValue: schoolEmail },
            status: { stringValue: "pending" },
            createdAt: { integerValue: now },
            expiresAt: { integerValue: expiresAt }
          }
        })
      }
    );

    const verifyUrl = `https://ticket.kmshteam.org/campus-verify-success.html?token=${token}`;

    // ✨ Apple風格信件
    const html = `
    <div style="background:#f5f5f7;padding:40px;font-family:-apple-system;">
      <div style="max-width:520px;margin:auto;background:#fff;border-radius:24px;padding:32px;text-align:center;">
        
        <div style="font-size:28px;font-weight:800;">校園驗證</div>

        <div style="margin-top:16px;color:#666;font-size:15px;">
          點擊下方按鈕完成驗證
        </div>

        <a href="${verifyUrl}"
          style="
            display:inline-block;
            margin-top:24px;
            padding:14px 28px;
            border-radius:999px;
            background:#111;
            color:#fff;
            text-decoration:none;
            font-weight:700;
          ">
          完成驗證
        </a>

        <div style="margin-top:24px;font-size:12px;color:#999;">
          此連結 30 分鐘內有效
        </div>

      </div>
    </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Tickets <campus@ticket.kmshteam.org>",
        to: schoolEmail,
        subject: "校園驗證",
        html
      })
    });

    if (!res.ok) {
      return json({ error: "寄信失敗" }, 500);
    }

    return json({ ok: true });

  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}