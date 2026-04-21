subject: `【${schoolName}】校園身分驗證信`,
html: `
  <div style="font-family:Arial,'Noto Sans TC',sans-serif;line-height:1.8;color:#111;">
    <h2 style="margin:0 0 16px;">${schoolName} 校園身分驗證</h2>

    <p>您好，這封信是用來完成 <b>${schoolName}</b> 的校園身分驗證。</p>

    <p>
      你的學號 / 身分代碼：<b>${studentCode}</b><br>
      驗證信箱：<b>${schoolEmail}</b>
    </p>

    <p>請點擊下方按鈕完成驗證：</p>

    <p style="margin:24px 0;">
      <a
        href="${verifyUrl}"
        style="
          display:inline-block;
          background:#111;
          color:#fff;
          text-decoration:none;
          padding:12px 20px;
          border-radius:999px;
          font-weight:700;
        "
      >
        完成校園驗證
      </a>
    </p>

    <p style="color:#666;font-size:14px;">
      如果按鈕無法點擊，請改用以下連結：<br>
      <a href="${verifyUrl}">${verifyUrl}</a>
    </p>

    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

    <p style="color:#666;font-size:13px;">
      此信由 ticket.kmshteam.org 系統自動寄出，請勿直接回覆。
    </p>
  </div>
`,
text: `
${schoolName} 校園身分驗證

請開啟以下連結完成驗證：
${verifyUrl}

學號 / 身分代碼：${studentCode}
驗證信箱：${schoolEmail}
`