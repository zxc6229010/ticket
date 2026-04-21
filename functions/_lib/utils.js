export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export function badRequest(message = "Bad Request") {
  return json({ error: message }, 400);
}

export function unauthorized(message = "Unauthorized") {
  return json({ error: message }, 401);
}

export function forbidden(message = "Forbidden") {
  return json({ error: message }, 403);
}

export function notFound(message = "Not Found") {
  return json({ error: message }, 404);
}

export function serverError(message = "Internal Server Error") {
  return json({ error: message }, 500);
}

export function norm(value) {
  return String(value ?? "").trim();
}

export function lower(value) {
  return norm(value).toLowerCase();
}

export function getBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7).trim();
}

export function randomToken() {
  return crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function isFuture(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}