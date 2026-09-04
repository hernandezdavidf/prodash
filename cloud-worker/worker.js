// ProDash authentication + per-user sync — a Cloudflare Worker.
//
// This file is NOT deployed by GitHub Pages. GitHub Pages only serves static
// files; a Worker is a separate Cloudflare product with its own deployment
// step. Paste this file's contents into the Cloudflare dashboard's Quick Edit
// editor and click Deploy — see ../workflows/auth-setup.md for the full
// walkthrough. No secret lives in this file (every credential is a Cloudflare
// environment variable, never written here), so committing it to the repo is
// safe even though the repo is public.
//
// ---------------------------------------------------------------------------
// WHY THE WORKER EXISTS AT ALL (read this before "simplifying" it away)
// ---------------------------------------------------------------------------
// The account registry lives in a Google Sheet. The browser must NEVER touch
// that sheet directly: index.html is a public static file, so any API key,
// OAuth client secret or service-account key placed in it is readable by
// anyone who views source — which would hand out every user's password hash
// and secret-question answer at once.
//
// So the Worker is the only thing that holds Google credentials, and it is
// also the only thing that decides which board a request may read or write.
// The board id is derived from a signed session token server-side and is
// never accepted from the client. Changing a URL, a localStorage value, or a
// request body cannot reach another user's data, because none of those are
// consulted. That is requirement 6, enforced in the one place a user cannot
// edit.
//
// ---------------------------------------------------------------------------
// ENVIRONMENT (Settings -> Variables and Secrets; mark all of these Encrypt)
// ---------------------------------------------------------------------------
//   AUTH_SECRET         long random string — signs session tokens + reset tickets
//   PASSWORD_PEPPER     long random string — mixed into every password hash
//   SHEET_ID            the spreadsheet id from its URL
//   GOOGLE_SA_EMAIL     service-account address (…@….iam.gserviceaccount.com)
//   GOOGLE_SA_KEY       the service account's PEM private key
//   PBKDF2_ITERATIONS   optional, default 100000 (see the CPU note on hashPassword)
//   ADMIN_BOOTSTRAP_TOKEN  optional one-time token for POST /admin/bootstrap
//   LEGACY_CLAIM        optional "1" — lets the first account adopt the old
//                       single-user blob stored under the KV key "state"
//
// Bindings: KV namespace bound as PRODASH_KV.
//
// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------
//   POST /auth/signup          create an account
//   POST /auth/login           username + password -> session token
//   POST /auth/logout          revoke the calling session
//   GET  /auth/me              who am I (validates the token)
//   POST /auth/forgot/start    username + email -> the secret question
//   POST /auth/forgot/verify   + answer          -> a short-lived reset ticket
//   POST /auth/forgot/reset    ticket + new password
//   GET  /data                 this session's board
//   PUT  /data                 replace this session's board
//   POST /admin/bootstrap      one-time creation of the temporary admin
//   ANY  /admin/*              reserved; 501 until the admin system is built
//
// CORS is wide open ("*"). That is deliberate, not an oversight: this app is
// opened from file://, from GitHub Pages, and potentially a custom domain
// later, so there is no one fixed origin to allow-list. Session tokens travel
// in the Authorization header and are stored in localStorage, never in
// cookies, so a permissive origin policy grants an attacker's page nothing it
// could not already do with curl — it cannot read another origin's storage.

// ===========================================================================
// The Users sheet
// ===========================================================================
// Columns A..S, row 1 headers, data from row 2. Keep this list and
// SHEET_HEADERS in lockstep with the sheet itself; the Worker addresses
// columns positionally, so inserting a column in the middle of the sheet
// without updating here would silently shift every field.
const F = {
  userId: 0,            // A  stable primary key, "usr_…"
  firstName: 1,         // B
  lastName: 2,          // C
  username: 3,          // D  as the user typed it, for display
  usernameKey: 4,       // E  normalised — THIS is the uniqueness key
  email: 5,             // F  as typed
  emailKey: 6,          // G  normalised lowercase
  passwordHash: 7,      // H  algorithm-tagged, never reversible
  secretQuestion: 8,    // I
  secretAnswerHash: 9,  // J  hashed exactly like a password
  role: 10,             // K  "user" | "admin"
  status: 11,           // L  "active" | "disabled"
  failedAttempts: 12,   // M
  lockedUntil: 13,      // N  ms epoch, or "" when not locked
  boardId: 14,          // O  which board this user owns
  createdAt: 15,        // P  ISO
  lastLoginAt: 16,      // Q  ISO
  passwordUpdatedAt: 17,// R  ISO
  sessionEpoch: 18,     // S  bump to invalidate every existing session
};
const COL_COUNT = 19;
const SHEET_TAB = "Users";
const DATA_RANGE = `${SHEET_TAB}!A2:S`;
const SHEET_HEADERS = [
  "user_id", "first_name", "last_name", "username", "username_key",
  "email", "email_key", "password_hash", "secret_question", "secret_answer_hash",
  "role", "status", "failed_attempts", "locked_until", "board_id",
  "created_at", "last_login_at", "password_updated_at", "session_epoch",
];

const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_MS = 15 * 60 * 1000;      // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const RESET_TICKET_TTL_MS = 10 * 60 * 1000;       // 10 minutes

// ===========================================================================
// Router
// ===========================================================================
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      requireConfig(env);

      // EVERY await below is load-bearing. `return handler(request, env)` inside
      // a try block returns the promise without awaiting it, so the promise's
      // rejection escapes this try/catch completely and Cloudflare answers with
      // a bare 1101 "Worker threw exception" instead of the JSON error the
      // client knows how to read. Only the synchronous requireConfig() throw
      // above was being caught. Do not drop these awaits to "simplify".
      if (path === "/health") return json({ ok: true });

      if (path === "/auth/signup" && request.method === "POST") return await signup(request, env);
      if (path === "/auth/login" && request.method === "POST") return await login(request, env);
      if (path === "/auth/logout" && request.method === "POST") return await logout(request, env);
      if (path === "/auth/me" && request.method === "GET") return await me(request, env);
      if (path === "/auth/forgot/start" && request.method === "POST") return await forgotStart(request, env);
      if (path === "/auth/forgot/verify" && request.method === "POST") return await forgotVerify(request, env);
      if (path === "/auth/forgot/reset" && request.method === "POST") return await forgotReset(request, env);

      if (path === "/data") return await boardData(request, env);

      if (path === "/admin/bootstrap" && request.method === "POST") return await adminBootstrap(request, env);
      if (path.startsWith("/admin/")) return await adminPlaceholder(request, env);

      return json({ error: "not found" }, 404);
    } catch (err) {
      // Never leak a stack trace or an upstream Google error to the browser.
      // The real detail goes to the Worker log, where only the operator sees it.
      console.error("unhandled", err && err.stack ? err.stack : String(err));
      if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };

function requireConfig(env) {
  for (const k of ["AUTH_SECRET", "PASSWORD_PEPPER", "SHEET_ID", "GOOGLE_SA_EMAIL", "GOOGLE_SA_KEY"]) {
    if (!env[k]) fail(500, `Server is not configured yet (missing ${k}).`);
  }
  if (!env.PRODASH_KV) fail(500, "Server is not configured yet (missing PRODASH_KV binding).");
}

// ===========================================================================
// Endpoints — registration
// ===========================================================================
async function signup(request, env) {
  const body = await readJson(request);
  await throttle(env, request, "signup", 10, 3600);

  const firstName = requireText(body.firstName, "First name", 1, 60);
  const lastName = requireText(body.lastName, "Last name", 1, 60);
  const username = requireUsername(body.username);
  const email = requireEmail(body.email);
  const password = requirePassword(body.password);
  const secretQuestion = requireText(body.secretQuestion, "Secret question", 5, 200);
  const secretAnswer = requireText(body.secretAnswer, "Secret answer", 2, 200);

  const usernameKey = normUsername(username);
  const emailKey = email.toLowerCase();

  // Reserve the username in KV *before* reading the sheet. Two signups racing
  // for the same name would both pass a read-then-append check against Sheets,
  // because append is not atomic against a prior read. KV's put-then-verify is
  // not a true compare-and-swap either, but it closes the window from seconds
  // (a Sheets round trip) to milliseconds, and the sheet check below still
  // catches anything that slips past. If this ever moves to a real database,
  // a UNIQUE index on username_key replaces this whole dance.
  const reservationKey = `uname:${usernameKey}`;
  const held = await env.PRODASH_KV.get(reservationKey);
  if (held) fail(409, "Username already exists. Please choose a different username.", "username_taken");

  const rows = await readUsers(env);
  if (rows.some((r) => r[F.usernameKey] === usernameKey)) {
    fail(409, "Username already exists. Please choose a different username.", "username_taken");
  }
  if (rows.some((r) => r[F.emailKey] === emailKey)) {
    fail(409, "An account already exists for that email address.", "email_taken");
  }
  // Duplicate-person check: same first + last name AND same email domain is a
  // strong hint the person already registered under another username. This is
  // advisory rather than fatal — real families share a surname and a domain —
  // so it is only refused when the full name matches exactly, which the client
  // surfaces as a "did you mean to log in?" message.
  const nameKey = `${firstName.toLowerCase()} ${lastName.toLowerCase()}`;
  if (rows.some((r) => `${(r[F.firstName] || "").toLowerCase()} ${(r[F.lastName] || "").toLowerCase()}` === nameKey)) {
    fail(409, "An account already exists for that name. Try logging in, or use Forgot password.", "duplicate_person");
  }

  await env.PRODASH_KV.put(reservationKey, "pending", { expirationTtl: 120 });

  const now = new Date();
  const userId = randomId("usr");
  const boardId = randomId("brd");
  const row = new Array(COL_COUNT).fill("");
  row[F.userId] = userId;
  row[F.firstName] = firstName;
  row[F.lastName] = lastName;
  row[F.username] = username;
  row[F.usernameKey] = usernameKey;
  row[F.email] = email;
  row[F.emailKey] = emailKey;
  row[F.passwordHash] = await hashSecret(password, env);
  row[F.secretQuestion] = secretQuestion;
  row[F.secretAnswerHash] = await hashSecret(normAnswer(secretAnswer), env);
  row[F.role] = "user";
  row[F.status] = "active";
  row[F.failedAttempts] = "0";
  row[F.lockedUntil] = "";
  row[F.boardId] = boardId;
  row[F.createdAt] = now.toISOString();
  row[F.lastLoginAt] = "";
  row[F.passwordUpdatedAt] = now.toISOString();
  row[F.sessionEpoch] = "1";

  await appendUser(env, row);
  await env.PRODASH_KV.put(reservationKey, userId);

  await maybeClaimLegacyBoard(env, boardId);

  const token = await issueSession(env, { userId, boardId, role: "user", username, epoch: 1 });
  return json({ ok: true, token, user: publicUser(row) }, 201);
}

// The Worker used to hold exactly one board under the KV key "state". The
// first account created on an upgraded Worker inherits it, so David's own
// data survives the switch to multi-user instead of appearing to vanish.
// Guarded by a KV flag so only ever one account can claim it, and by an env
// flag so a fresh deployment never does this at all.
async function maybeClaimLegacyBoard(env, boardId) {
  if (env.LEGACY_CLAIM !== "1") return;
  if (await env.PRODASH_KV.get("legacy:claimed")) return;
  const legacy = await env.PRODASH_KV.get("state");
  if (!legacy) return;
  await env.PRODASH_KV.put(boardKey(boardId), legacy);
  await env.PRODASH_KV.put("legacy:claimed", boardId);
}

// ===========================================================================
// Endpoints — login
// ===========================================================================
async function login(request, env) {
  const body = await readJson(request);
  await throttle(env, request, "login", 30, 900);

  const usernameKey = normUsername(String(body.username || ""));
  const password = String(body.password || "");
  if (!usernameKey || !password) fail(400, "Enter your username and password.");

  const found = await findUser(env, (r) => r[F.usernameKey] === usernameKey);

  // No such user: burn roughly the same amount of time a real verification
  // costs, so response timing does not disclose whether the account exists.
  if (!found) {
    await hashSecret(password, env);
    fail(401, "Incorrect username or password.", "bad_credentials");
  }

  const { row, rowNumber } = found;

  if (row[F.status] !== "active") {
    fail(403, "This account is not active. Please contact the administrator.", "disabled");
  }

  const lockedUntil = Number(row[F.lockedUntil] || 0);
  if (lockedUntil && Date.now() < lockedUntil) {
    fail(423, lockoutMessage(lockedUntil), "locked");
  }

  const ok = await verifySecret(password, row[F.passwordHash], env);
  if (!ok) {
    // A lock that has already expired resets the counter, so the three
    // attempts are three *consecutive* failures, not three since the account
    // was created.
    const priorFailures = lockedUntil && Date.now() >= lockedUntil ? 0 : Number(row[F.failedAttempts] || 0);
    const attempts = priorFailures + 1;
    const patch = { [F.failedAttempts]: String(attempts) };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_MS;
      patch[F.lockedUntil] = String(until);
      await updateUserRow(env, rowNumber, row, patch);
      // The spec requires telling the user they are locked and when they can
      // retry, which does confirm the account exists. That is an accepted
      // trade — a silent lockout is worse for a real user than the enumeration
      // it prevents, and the generic message above still covers the far more
      // common wrong-username case.
      fail(423, lockoutMessage(until), "locked");
    }
    patch[F.lockedUntil] = "";
    await updateUserRow(env, rowNumber, row, patch);
    const left = MAX_FAILED_ATTEMPTS - attempts;
    fail(401, `Incorrect username or password. ${left} attempt${left === 1 ? "" : "s"} left before a temporary lock.`, "bad_credentials");
  }

  const epoch = Number(row[F.sessionEpoch] || 1);
  const patch = {
    [F.failedAttempts]: "0",
    [F.lockedUntil]: "",
    [F.lastLoginAt]: new Date().toISOString(),
  };

  // Transparent upgrade: if this hash was made with weaker parameters than the
  // Worker now uses, re-hash it here — the only moment the plaintext password
  // is legitimately in hand. This is what makes changing PBKDF2_ITERATIONS, or
  // later swapping the algorithm outright, a config change instead of a
  // password reset for every user.
  if (needsRehash(row[F.passwordHash], env)) {
    patch[F.passwordHash] = await hashSecret(password, env);
    patch[F.passwordUpdatedAt] = new Date().toISOString();
  }
  await updateUserRow(env, rowNumber, row, patch);
  await env.PRODASH_KV.put(epochKey(row[F.userId]), String(epoch));

  const token = await issueSession(env, {
    userId: row[F.userId],
    boardId: row[F.boardId],
    role: row[F.role] || "user",
    username: row[F.username],
    epoch,
  });
  return json({ ok: true, token, user: publicUser(row) });
}

function lockoutMessage(until) {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  const at = new Date(until).toISOString();
  return `Too many failed attempts. This account is locked for about ${mins} more minute${mins === 1 ? "" : "s"}. Try again after ${at}.`;
}

async function logout(request, env) {
  const session = await requireSession(request, env).catch(() => null);
  if (session) {
    // Revoke this one device without touching the user's other sessions. The
    // entry expires on its own once the token it revokes would have expired
    // anyway, so the list cannot grow without bound.
    const ttl = Math.max(60, Math.ceil((session.exp - Date.now()) / 1000));
    await env.PRODASH_KV.put(revokeKey(session.sid), "1", { expirationTtl: ttl });
  }
  return json({ ok: true });
}

async function me(request, env) {
  const session = await requireSession(request, env);
  return json({
    ok: true,
    user: {
      userId: session.uid,
      username: session.un,
      role: session.role,
      boardId: session.bid,
    },
  });
}

// ===========================================================================
// Endpoints — forgot password
// ===========================================================================
// Requiring the email alongside the username before revealing the secret
// question is what keeps this from being a free directory of "which usernames
// exist, and what question guards them". Both must match, and a mismatch of
// either returns the same generic error.
async function forgotStart(request, env) {
  const body = await readJson(request);
  await throttle(env, request, "forgot", 20, 900);

  const usernameKey = normUsername(String(body.username || ""));
  const emailKey = String(body.email || "").trim().toLowerCase();
  if (!usernameKey || !emailKey) fail(400, "Enter your username and the email address on the account.");

  const found = await findUser(env, (r) => r[F.usernameKey] === usernameKey && r[F.emailKey] === emailKey);
  if (!found) fail(404, "No account matches that username and email address.", "no_match");

  const lockedUntil = Number(found.row[F.lockedUntil] || 0);
  if (lockedUntil && Date.now() < lockedUntil) fail(423, lockoutMessage(lockedUntil), "locked");

  return json({ ok: true, question: found.row[F.secretQuestion] });
}

async function forgotVerify(request, env) {
  const body = await readJson(request);
  await throttle(env, request, "forgot", 20, 900);

  const usernameKey = normUsername(String(body.username || ""));
  const emailKey = String(body.email || "").trim().toLowerCase();
  const answer = String(body.answer || "");
  if (!usernameKey || !emailKey || !answer) fail(400, "Answer the secret question to continue.");

  const found = await findUser(env, (r) => r[F.usernameKey] === usernameKey && r[F.emailKey] === emailKey);
  if (!found) fail(404, "No account matches that username and email address.", "no_match");

  const { row, rowNumber } = found;
  const lockedUntil = Number(row[F.lockedUntil] || 0);
  if (lockedUntil && Date.now() < lockedUntil) fail(423, lockoutMessage(lockedUntil), "locked");

  // Wrong answers feed the same counter as wrong passwords, so recovery is not
  // a lockout-free side door into guessing.
  const ok = await verifySecret(normAnswer(answer), row[F.secretAnswerHash], env);
  if (!ok) {
    const attempts = Number(row[F.failedAttempts] || 0) + 1;
    const patch = { [F.failedAttempts]: String(attempts) };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_MS;
      patch[F.lockedUntil] = String(until);
      await updateUserRow(env, rowNumber, row, patch);
      fail(423, lockoutMessage(until), "locked");
    }
    await updateUserRow(env, rowNumber, row, patch);
    fail(401, "That answer does not match our records.", "bad_answer");
  }

  const ticket = await signPayload(env, {
    p: "reset",
    uid: row[F.userId],
    epoch: Number(row[F.sessionEpoch] || 1),
    exp: Date.now() + RESET_TICKET_TTL_MS,
  });
  return json({ ok: true, ticket, expiresInSeconds: RESET_TICKET_TTL_MS / 1000 });
}

async function forgotReset(request, env) {
  const body = await readJson(request);
  const ticket = String(body.ticket || "");
  const password = requirePassword(body.password);

  const claims = await verifyPayload(env, ticket);
  if (!claims || claims.p !== "reset") fail(401, "That reset link has expired. Start again.", "bad_ticket");
  if (Date.now() > claims.exp) fail(401, "That reset link has expired. Start again.", "bad_ticket");

  const found = await findUser(env, (r) => r[F.userId] === claims.uid);
  if (!found) fail(404, "Account not found.");
  const { row, rowNumber } = found;

  // The ticket was issued against a specific session epoch. If the password
  // has already been changed since, that ticket is spent — this is what stops
  // one verified answer from being replayed into a second reset later.
  if (Number(row[F.sessionEpoch] || 1) !== claims.epoch) {
    fail(401, "That reset link has already been used. Start again.", "bad_ticket");
  }

  const epoch = Number(row[F.sessionEpoch] || 1) + 1;
  await updateUserRow(env, rowNumber, row, {
    [F.passwordHash]: await hashSecret(password, env),
    [F.passwordUpdatedAt]: new Date().toISOString(),
    [F.failedAttempts]: "0",
    [F.lockedUntil]: "",
    [F.sessionEpoch]: String(epoch),
  });
  // Bumping the epoch signs every existing session out everywhere, which is
  // the point of a password reset — if someone else knew the old password,
  // their open tab dies here.
  await env.PRODASH_KV.put(epochKey(row[F.userId]), String(epoch));

  return json({ ok: true });
}

// ===========================================================================
// Endpoints — board data
// ===========================================================================
async function boardData(request, env) {
  const session = await requireSession(request, env);
  const key = boardKey(session.bid);   // from the token. Never from the client.

  if (request.method === "GET") {
    const stored = await env.PRODASH_KV.get(key);
    return json(stored ? JSON.parse(stored) : null);
  }
  if (request.method === "PUT") {
    let bodyText;
    try {
      bodyText = await request.text();
      JSON.parse(bodyText);   // reject anything that is not valid JSON before storing it
    } catch (e) {
      return json({ error: "invalid JSON body" }, 400);
    }
    if (bodyText.length > 4 * 1024 * 1024) return json({ error: "board too large" }, 413);
    await env.PRODASH_KV.put(key, bodyText);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
}

// ===========================================================================
// Endpoints — admin (deliberately a placeholder)
// ===========================================================================
// The seam is here and the role check works; the features are not built yet.
// A later admin system adds handlers behind this same requireRole gate without
// touching sessions, hashing, or the sheet layout.
async function adminBootstrap(request, env) {
  if (!env.ADMIN_BOOTSTRAP_TOKEN) fail(404, "not found");
  const provided = request.headers.get("X-Bootstrap-Token") || "";
  if (!timingSafeEqual(provided, env.ADMIN_BOOTSTRAP_TOKEN)) fail(401, "unauthorized");

  const body = await readJson(request);
  const username = requireUsername(body.username || "admin");
  const password = requirePassword(body.password);
  const email = requireEmail(body.email);
  const usernameKey = normUsername(username);

  const rows = await readUsers(env);
  if (rows.some((r) => r[F.role] === "admin")) fail(409, "An admin account already exists.");
  if (rows.some((r) => r[F.usernameKey] === usernameKey)) fail(409, "Username already exists. Please choose a different username.");

  const now = new Date().toISOString();
  const row = new Array(COL_COUNT).fill("");
  row[F.userId] = randomId("adm");
  row[F.firstName] = "Temporary";
  row[F.lastName] = "Admin";
  row[F.username] = username;
  row[F.usernameKey] = usernameKey;
  row[F.email] = email;
  row[F.emailKey] = email.toLowerCase();
  row[F.passwordHash] = await hashSecret(password, env);
  row[F.secretQuestion] = "Set by the administrator";
  row[F.secretAnswerHash] = await hashSecret(normAnswer(randomId("seed")), env);
  row[F.role] = "admin";
  row[F.status] = "active";
  row[F.failedAttempts] = "0";
  row[F.boardId] = randomId("brd");   // the admin gets an ordinary board of its own
  row[F.createdAt] = now;
  row[F.passwordUpdatedAt] = now;
  row[F.sessionEpoch] = "1";
  await appendUser(env, row);

  return json({ ok: true, note: "Temporary admin created. Delete ADMIN_BOOTSTRAP_TOKEN from the Worker's variables now." }, 201);
}

async function adminPlaceholder(request, env) {
  const session = await requireSession(request, env);
  requireRole(session, "admin");
  return json({ error: "The admin system is not built yet.", code: "not_implemented" }, 501);
}

function requireRole(session, role) {
  if (session.role !== role) fail(403, "You do not have access to that.", "forbidden");
}

// ===========================================================================
// Sessions — stateless signed tokens, with a KV escape hatch
// ===========================================================================
// The signature alone proves the token is ours and unmodified, so the common
// path costs no Sheets read at all. Two cheap KV reads then cover the two
// things a signature cannot express: this device signed out (revocation), and
// the password changed (epoch).
async function issueSession(env, { userId, boardId, role, username, epoch }) {
  await env.PRODASH_KV.put(epochKey(userId), String(epoch));
  return signPayload(env, {
    p: "session",
    sid: randomId("ses"),
    uid: userId,
    bid: boardId,
    role: role || "user",
    un: username,
    epoch,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  });
}

async function requireSession(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) fail(401, "Please sign in.", "no_session");

  const claims = await verifyPayload(env, token);
  if (!claims || claims.p !== "session") fail(401, "Please sign in again.", "bad_session");
  if (Date.now() > claims.exp) fail(401, "Your session has expired. Please sign in again.", "expired");

  if (await env.PRODASH_KV.get(revokeKey(claims.sid))) {
    fail(401, "You have been signed out. Please sign in again.", "revoked");
  }
  const currentEpoch = await env.PRODASH_KV.get(epochKey(claims.uid));
  if (currentEpoch !== null && Number(currentEpoch) !== Number(claims.epoch)) {
    fail(401, "Your password was changed. Please sign in again.", "stale_epoch");
  }
  return claims;
}

const boardKey = (bid) => `board:${bid}`;
const epochKey = (uid) => `epoch:${uid}`;
const revokeKey = (sid) => `rev:${sid}`;

// ===========================================================================
// Signing (sessions and reset tickets share one HMAC envelope)
// ===========================================================================
async function hmacKey(env) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}
async function signPayload(env, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(body));
  return `v1.${body}.${b64urlEncode(new Uint8Array(sig))}`;
}
async function verifyPayload(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const ok = await crypto.subtle.verify(
    "HMAC", await hmacKey(env),
    b64urlDecode(parts[2]), new TextEncoder().encode(parts[1]),
  );
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch (e) {
    return null;
  }
}

// ===========================================================================
// Password hashing
// ===========================================================================
// PBKDF2-HMAC-SHA256, because it is what WebCrypto gives a Worker natively —
// argon2/scrypt would need a WASM bundle, which the Quick Edit paste-in
// deployment this project relies on cannot carry.
//
// The stored string is self-describing:
//     pbkdf2-sha256$<iterations>$<salt-b64url>$<hash-b64url>
// Verification reads the parameters out of the stored value rather than
// assuming today's settings, so old hashes keep working after the settings
// change, and login re-hashes anything below the current target (see
// needsRehash). Adding a new algorithm later means adding a new prefix and
// letting the same upgrade path drain the old one — no mass reset.
//
// CPU note: Cloudflare's free plan allows ~10ms CPU per request, and PBKDF2 is
// deliberately CPU-hungry. 100k iterations is the compromise that fits; if you
// see "Exceeded CPU limit" on login, lower PBKDF2_ITERATIONS, and if you move
// to a paid plan, raise it — either way existing users upgrade on next login.
const DEFAULT_ITERATIONS = 100000;
const iterationsOf = (env) => Math.max(10000, Number(env.PBKDF2_ITERATIONS || DEFAULT_ITERATIONS));

async function hashSecret(plain, env, saltBytes, iterations) {
  const iters = iterations || iterationsOf(env);
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  // The pepper is a Worker secret, not stored beside the hash. Someone who
  // walks off with a copy of the Google Sheet still cannot mount an offline
  // guessing attack without also breaching Cloudflare.
  const material = new TextEncoder().encode(`${plain}${env.PASSWORD_PEPPER}`);
  const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, key, 256,
  );
  return `pbkdf2-sha256$${iters}$${b64urlEncode(salt)}$${b64urlEncode(new Uint8Array(bits))}`;
}

async function verifySecret(plain, stored, env) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iters = Number(parts[1]);
  const salt = new Uint8Array(b64urlDecode(parts[2]));
  if (!iters || !salt.length) return false;
  const computed = await hashSecret(plain, env, salt, iters);
  return timingSafeEqual(computed, stored);
}

function needsRehash(stored, env) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return true;
  return Number(parts[1]) < iterationsOf(env);
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  // Compare a fixed number of bytes so the loop count does not depend on where
  // the first difference falls. Length still differs, which is fine — it is
  // the content that must not leak byte by byte.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// ===========================================================================
// Google Sheets access
// ===========================================================================
// A service account signs its own assertion and swaps it for an access token.
// Tokens are cached in the isolate for their lifetime, so a burst of requests
// costs one token exchange, not one per request.
let tokenCache = { token: null, expiresAt: 0 };

async function googleAccessToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 30000) return tokenCache.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64urlEncode(new TextEncoder().encode(JSON.stringify({
    iss: env.GOOGLE_SA_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claim}`;
  const key = await importPrivateKey(env.GOOGLE_SA_KEY);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64urlEncode(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    console.error("google token exchange failed", res.status, await res.text());
    fail(502, "Could not reach the account database. Please try again.");
  }
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

async function importPrivateKey(pem) {
  // Cloudflare's variable editor stores the key with real newlines, but pasting
  // it out of the downloaded JSON leaves literal "\n" sequences. Accept both.
  const normalised = String(pem).replace(/\\n/g, "\n");
  const b64 = normalised
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bytes = b64ToBytes(b64);
  return crypto.subtle.importKey(
    "pkcs8", bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

async function sheetsFetch(env, path, init = {}) {
  const token = await googleAccessToken(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    console.error("sheets call failed", path, res.status, await res.text());
    fail(502, "Could not reach the account database. Please try again.");
  }
  return res.json();
}

async function readUsers(env) {
  const data = await sheetsFetch(env, `/values/${encodeURIComponent(DATA_RANGE)}`);
  const rows = data.values || [];
  // Sheets truncates trailing empty cells, so pad every row to full width —
  // otherwise row[F.sessionEpoch] is undefined for any user whose last columns
  // happen to be blank.
  return rows.map((r) => {
    const padded = r.slice(0, COL_COUNT);
    while (padded.length < COL_COUNT) padded.push("");
    return padded;
  });
}

async function findUser(env, predicate) {
  const rows = await readUsers(env);
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) return { row: rows[i], rowNumber: i + 2 };  // +2: header row, 1-based
  }
  return null;
}

async function appendUser(env, row) {
  await sheetsFetch(
    env,
    `/values/${encodeURIComponent(`${SHEET_TAB}!A:S`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row.map(cellSafe)] }) },
  );
}

async function updateUserRow(env, rowNumber, currentRow, patch) {
  const next = currentRow.slice();
  for (const [idx, value] of Object.entries(patch)) next[Number(idx)] = value;
  await sheetsFetch(
    env,
    `/values/${encodeURIComponent(`${SHEET_TAB}!A${rowNumber}:S${rowNumber}`)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [next.map(cellSafe)] }) },
  );
  return next;
}

// Formula injection: a value beginning with = + - @ or a control character is
// interpreted as a formula by Sheets (and by Excel, if the sheet is ever
// downloaded). A registration with the "first name" =IMPORTXML(...) would
// otherwise run against whoever opens the sheet — the account registry is read
// by the operator, so this is a real path to their session, not a theoretical
// one. RAW input mode does not protect against this on its own; prefixing an
// apostrophe forces text.
function cellSafe(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// ===========================================================================
// Validation
// ===========================================================================
// Every field is checked here rather than trusted from the client, because the
// client's checks are a convenience the user can skip with one curl command.
function requireText(value, label, min, max) {
  const s = String(value === undefined || value === null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, "")   // strip control characters
    .trim();
  if (s.length < min) fail(400, `${label} is required.`);
  if (s.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return s;
}

function requireUsername(value) {
  const s = requireText(value, "Username", 3, 32);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(s)) {
    fail(400, "Usernames may use letters, numbers, dots, underscores and hyphens, and must start with a letter or number.");
  }
  return s;
}

function requireEmail(value) {
  const s = requireText(value, "Email address", 5, 254);
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(s)) fail(400, "Enter a valid email address.");
  return s;
}

function requirePassword(value) {
  const s = String(value === undefined || value === null ? "" : value);
  if (s.length < 10) fail(400, "Password must be at least 10 characters.");
  if (s.length > 200) fail(400, "Password must be 200 characters or fewer.");
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s)) {
    fail(400, "Password must include an uppercase letter, a lowercase letter and a number.");
  }
  return s;
}

// Case and stray spacing must never create a second "David" — this is the one
// function that decides whether two usernames are the same, and both signup
// and login route through it so they cannot drift apart.
function normUsername(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}
// Secret answers are compared the same forgiving way: nobody remembers whether
// they typed "Manila" or " manila " two years ago.
function normAnswer(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function publicUser(row) {
  // Deliberately narrow. Hashes, the secret question, the lockout counters and
  // the email never travel to the browser.
  return {
    userId: row[F.userId],
    username: row[F.username],
    firstName: row[F.firstName],
    lastName: row[F.lastName],
    role: row[F.role] || "user",
  };
}

// ===========================================================================
// Abuse throttling
// ===========================================================================
// Per-account lockout stops someone grinding one password list against one
// user. This stops the same client spraying one password across many users,
// which the lockout counter would never notice.
async function throttle(env, request, bucket, limit, windowSeconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const count = Number((await env.PRODASH_KV.get(key)) || 0) + 1;
  await env.PRODASH_KV.put(key, String(count), { expirationTtl: windowSeconds + 60 });
  if (count > limit) fail(429, "Too many attempts from this device. Please wait a few minutes.", "rate_limited");
}

// ===========================================================================
// Small helpers
// ===========================================================================
async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new Error("not an object");
    return body;
  } catch (e) {
    fail(400, "Malformed request.");
  }
}

function randomId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  return b64ToBytes(s + "=".repeat((4 - (s.length % 4)) % 4));
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Bootstrap-Token",
    "Access-Control-Max-Age": "86400",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    },
  });
}

// Exported only so the setup workflow can quote the exact header row.
export { SHEET_HEADERS };
