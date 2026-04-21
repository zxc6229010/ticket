function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importPrivateKey(pem) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeString(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGoogleAccessToken(env) {
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google service account env");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const unsigned =
    `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(payload))}`;

  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const jwt = `${unsigned}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Google OAuth failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

function encodeDocPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };

  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }

  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }

  if (typeof value === "boolean") return { booleanValue: value };

  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }

  if (typeof value === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }

  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    const arr = value.arrayValue.values || [];
    return arr.map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    const out = {};
    const fields = value.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function fromFirestoreDoc(doc) {
  if (!doc) return null;
  const fields = doc.fields || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

export async function getDoc(env, path) {
  const token = await getGoogleAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodeDocPath(path)}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Firestore GET failed: ${text || resp.status}`);
  }

  const data = await resp.json();
  return {
    name: data.name,
    id: data.name?.split("/").pop() || "",
    data: fromFirestoreDoc(data)
  };
}

export async function setDoc(env, path, data, merge = true) {
  const token = await getGoogleAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;

  const updateMask = merge
    ? Object.keys(data)
        .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
        .join("&")
    : "";

  const qs = updateMask ? `?${updateMask}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodeDocPath(path)}${qs}`;

  const body = {
    fields: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, toFirestoreValue(v)])
    )
  };

  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Firestore PATCH failed: ${text || resp.status}`);
  }

  return await resp.json();
}