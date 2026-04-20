export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const { schoolId, studentCode, schoolEmail } = body;

    if (!schoolEmail) {
      return new Response(JSON.stringify({ error: "缺少 email" }), { status: 400 });
    }

    const token = crypto.randomUUID();

    const verifyUrl = `https://ticket.kmshteam.org/campus-verify-success.html?token=${token}`;

    const html = `
    <div style="
      background:#f5f5f7;
      padding:40px 16px;
      font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Segoe UI',Roboto,'Noto Sans TC',sans-serif;
    ">

      <div style="
        max-width:520px;
        margin:0 auto;
        background:#ffffff;
        border-radius:28px;
        box-shadow:0 20px 50px rgba(0,0,0,0.08);
        padding:32px 28px;
        border:1px solid rgba(0,0,0,0.06);
      ">

        <!-- LOGO -->
        <div style="text-align:center; margin-bottom:20px;">
          <div style="
            display:inline-block;
            width:42px;
            height:42px;
            border-radius:12px;
            background:#111;
            color:#fff;
            font-weight:800;
            line-height:42px;
            font-size:18px;
          ">T</div>
        </div>

        <!-- TITLE -->
        <h2 style="
          text-align:center;
          font-size:24px;
          margin:0;
          font-weight:800;
          letter-spacing:-0.02em;
          color:#1d1d1f;
        ">
          校園驗證
        </h2>

        <!-- DESC -->
        <p style="
          text-align:center;
          color:#6e6e73;
          font-size:14px;
          line-height:1.8;
          margin:14px 0 26px;
        ">
          請點擊下方按鈕完成校園身分驗證。<br>
          完成後，你的帳號將綁定該校園身分。
        </p>

        <!-- BUTTON -->
        <div style="text-align:center; margin-bottom:24px;">
          <a href="${verifyUrl}" style="
            display:inline-block;
            background:#111;
            color:#fff;
            text-decoration:none;
            padding:14px 26px;
            border-radius:999px;
            font-weight:700;
            font-size:14px;
            box-shadow:0 10px 20px rgba(0,0,0,0.15);
          ">
            完成校園驗證
          </a>
        </div>

        <!-- FALLBACK -->
        <div style="
          font-size:12px;
          color:#6e6e73;
          line-height:1.7;
          word-break:break-all;
        ">
          若按鈕無法點擊，請複製以下連結至瀏覽器開啟：<br><br>
          <span style="color:#1d1d1f;">${verifyUrl}</span>
        </div>

        <!-- DIVIDER -->
        <div style="
          height:1px;
          background:rgba(0,0,0,0.06);
          margin:24px 0;
        "></div>

        <!-- FOOTER -->
        <div style="
          font-size:12px;
          color:#6e6e73;
          line-height:1.7;
          text-align:center;
        ">
          此信件由系統自動寄出，請勿回覆。<br>
          若你未進行此操作，請忽略本信件。
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
        from: "Tickets 校園驗證 <campus-verify@ticket.kmshteam.org>",
        to: schoolEmail,
        subject: "完成你的校園驗證",
        html
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