export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const { schoolId, studentCode, schoolEmail } = body;

    if (!schoolEmail) {
      return new Response(JSON.stringify({ error: "缺少 email" }), { status: 400 });
    }

    // 👉 產生驗證 token（簡單版）
    const token = crypto.randomUUID();

    const verifyUrl = `https://ticket.kmshteam.org/campus-verify.html?token=${token}`;

    // 👉 呼叫 Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "校園驗證 <campus-verify-noreply@ticket.kmshteam.org>",
        to: schoolEmail,
        subject: "校園驗證信",
        html: `
          <h2>校園驗證</h2>
          <p>請點擊以下連結完成驗證：</p>
          <a href="${verifyUrl}">${verifyUrl}</a>
        `
      })
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }));

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}