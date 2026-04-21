import { unauthorized } from "./utils.js";

export async function verifyFirebaseIdToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    throw unauthorized("缺少登入資訊");
  }

  const idToken = auth.slice(7).trim();
  if (!idToken) {
    throw unauthorized("缺少登入 token");
  }

  const apiKey = env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIREBASE_WEB_API_KEY");
  }

  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || !data.users || !data.users.length) {
    throw unauthorized("登入狀態無效，請重新登入");
  }

  const user = data.users[0] || {};
  return {
    uid: user.localId || "",
    email: user.email || "",
    emailVerified: !!user.emailVerified
  };
}