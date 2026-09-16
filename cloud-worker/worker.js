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
//   GOOGLE_OAUTH_CLIENT_ID  optional — the Web client id from Google Cloud
//                       Console. Public by design (it appears in the page
//                       source of every site using Google sign-in) and served
//                       to the app from /health, so index.html holds no copy.
//                       Without it, Sign in with Google answers 503 and the
//                       app hides the button; everything else works untouched.
//                       Deliberately NOT in requireConfig for that reason.
//
//   Email is off until BOTH of the next two are set. Until then verification
//   and reset-links answer 503 `mail_not_configured` and the secret question
//   remains the only recovery path — which is the shipped, working behaviour.
//   MAIL_API_KEY        optional — bearer key for the mail provider
//   MAIL_FROM           optional — the From address, e.g. "ProDash <no-reply@…>"
//   MAIL_PROVIDER_URL   optional — defaults to Resend's endpoint
//   APP_URL             optional — where emailed links point, e.g.
//                       "https://hernandezdavidf.github.io/prodash". Configured
//                       rather than taken from the Origin header, or anyone
//                       could have the Worker mail someone a link to their site.
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
//   POST /admin/bootstrap      one-time creation of the first Super Admin
//   GET  /admin/users          every account, for the admin screen
//   POST /admin/user           change one account's role / status / permissions
//   POST /admin/reset-password issue a one-time temporary password for an account
//
// ---------------------------------------------------------------------------
// ROLES
// ---------------------------------------------------------------------------
//   superadmin  everything, including managing other accounts
//   user        board, calendar, expenses, and the app version history only
//   guest       board, calendar, expenses - and only for 48 hours
//
// A guest's TOKEN is capped at their expiry, so the clock enforces itself
// through the ordinary session check with no per-request sheet read and nothing
// to bypass in localStorage. Their row is flipped to "deactivated" on the next
// login attempt, which is what makes the expiry visible in the admin list.
//
// CORS is wide open ("*"). That is deliberate, not an oversight: this app is
// opened from file://, from GitHub Pages, and potentially a custom domain
// later, so there is no one fixed origin to allow-list. Session tokens travel
// in the Authorization header and are stored in localStorage, never in
// cookies, so a permissive origin policy grants an attacker's page nothing it
// could not already do with curl — it cannot read another origin's storage.

// ===========================================================================
// Deployed version
// ===========================================================================
// Bump this whenever a change here adds or alters something index.html depends
// on. The app compares it against its own WORKER_MIN and says so on the User &
// Role Management screen when this Worker is behind.
//
// WHY THIS EXISTS: the Worker and the app deploy through completely separate
// pipelines - the app rides a git push to Pages, this file is pasted into the
// Cloudflare editor by hand and then has to be PROMOTED TO ACTIVE, which is
// easy to forget. When they drift, the symptom appears far from the cause: a
// nickname save returned "Nothing to change." for weeks because the deployed
// Worker predated the nickname field and quietly ignored it. There was no way
// to ask what version was running. Now there is.
const WORKER_VERSION = "4.10";

// ===========================================================================
// The Users sheet
// ===========================================================================
// Columns A..AA, row 1 headers, data from row 2. Keep this list and
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
  role: 10,             // K  "superadmin" | "user" | "guest"  (legacy "admin" = superadmin)
  status: 11,           // L  "active" | "inactive" | "deactivated"
  failedAttempts: 12,   // M
  lockedUntil: 13,      // N  ms epoch, or "" when not locked
  boardId: 14,          // O  which board this user owns
  createdAt: 15,        // P  ISO
  lastLoginAt: 16,      // Q  ISO
  passwordUpdatedAt: 17,// R  ISO
  sessionEpoch: 18,     // S  bump to invalidate every existing session
  perms: 19,            // T  JSON overrides on top of the role defaults, or ""
  activatedAt: 20,      // U  ISO. For a guest this starts the 48-hour clock.
  nickname: 21,         // V  what the app calls them. Display only; "" is fine.
  /* W..Y — Sign in with Google. googleSub is Google's permanent subject id and
     is the ONLY thing a sign-in is matched on. Never the email: Google
     addresses can be changed by their owner and, on Workspace domains, reissued
     to a different person entirely, so an email match proves nothing about
     identity. googleEmail is stored purely so the profile screen can say WHICH
     account is connected; it is never used to find a row. */
  googleSub: 22,        // W  Google "sub" claim, or "" when not linked
  googleEmail: 23,      // X  the Google address, for display only
  googleLinkedAt: 24,   // Y  ISO
  googlePicture: 25,    // Z  avatar URL Google supplied, or ""
  /* AA — "1" once the address in column F has been proven. Google-created and
     Google-linked accounts are born verified, because Google only hands us an
     address it has verified itself (email_verified is checked, not trusted).
     A password signup starts unverified and stays that way until the mail
     subsystem is switched on - see sendMail(). Nothing is gated on this yet;
     it is recorded from the start so that turning verification on later does
     not have to guess about accounts created before it existed. */
  emailVerified: 26,    // AA "1" or ""
};
const COL_COUNT = 27;
const SHEET_TAB = "Users";
/* Every range is DERIVED from COL_COUNT rather than written out. The three used
   to be independent literals, and when the schema widened from 19 columns to 21
   only two of them were updated - so updateUserRow kept asking Sheets to write
   21 values into an A:S range and got a 400 on every attempt. Reads and appends
   still worked (append negotiates its own width), which made it look like an
   intermittent "could not reach the account database" rather than what it was:
   every row update failing, every time. Deriving them makes that drift
   impossible. */
function colLetter(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const LAST_COL = colLetter(COL_COUNT);
const DATA_RANGE = `${SHEET_TAB}!A2:${LAST_COL}`;
const SHEET_HEADERS = [
  "user_id", "first_name", "last_name", "username", "username_key",
  "email", "email_key", "password_hash", "secret_question", "secret_answer_hash",
  "role", "status", "failed_attempts", "locked_until", "board_id",
  "created_at", "last_login_at", "password_updated_at", "session_epoch",
  "perms", "activated_at", "nickname",
  "google_sub", "google_email", "google_linked_at", "google_picture", "email_verified",
];

/* ---------------------------------------------------------------------------
   ROLES AND CAPABILITIES
   ---------------------------------------------------------------------------
   A capability is a plain string. Roles are just named default SETS of them,
   and a user row may carry per-capability overrides in its `perms` cell. That
   is the whole model - adding a tab later means adding one string here and one
   check in the client, with no schema change and no migration.

   Be clear about what this does and does not protect. Every tab except "admin"
   renders the signed-in user's OWN board, so hiding one is policy, not
   security: the data was already theirs. What genuinely needs enforcing, and
   is enforced here rather than in the browser, is the "admin" capability (the
   only place another person's data is reachable) and the guest clock. */
const CAPS = {
  superadmin: ["board","cal","exp","reports","history","history.appver","admin"],
  user:       ["board","cal","exp","history.appver"],
  guest:      ["board","cal","exp"],
};
const GUEST_TTL_MS = 48 * 60 * 60 * 1000;

// "admin" is the legacy value the bootstrap endpoint wrote before roles were
// split three ways. Treat it as superadmin rather than orphaning that account.
function normRole(r) {
  r = String(r || "user").toLowerCase();
  if (r === "admin") return "superadmin";
  return CAPS[r] ? r : "user";
}
/* Effective capabilities = the role's defaults, then the row's own overrides.
   An override can grant something the role lacks OR take away something it
   normally has, which is what "grant or restrict specific access" needs. */
function capsFor(row) {
  const role = normRole(row[F.role]);
  const set = {};
  CAPS[role].forEach((c) => { set[c] = true; });
  let over = null;
  try { over = row[F.perms] ? JSON.parse(row[F.perms]) : null; } catch (e) { over = null; }
  if (over && typeof over === "object") {
    Object.keys(over).forEach((k) => {
      if (over[k]) set[k] = true; else delete set[k];
    });
  }
  return Object.keys(set);
}
// When a guest's access lapses. Null for anyone who is not a guest.
function guestExpiry(row) {
  if (normRole(row[F.role]) !== "guest") return null;
  const t = Date.parse(row[F.activatedAt] || row[F.createdAt] || "");
  return isFinite(t) ? t + GUEST_TTL_MS : 0;   // unparseable = already expired
}

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
      // Version, not just ok. The Worker deploys separately from the app (paste
      // + promote to Active in the Cloudflare dashboard), so the two drift
      // silently and a stale Worker shows up as a nonsense error somewhere far
      // from the cause -- a nickname save answering "Nothing to change." was
      // exactly that. This is the endpoint that makes the drift answerable, and
      // it is deliberately unauthenticated: a version string tells an attacker
      // nothing they could not learn by reading the public repo.
      /* The app reads googleClientId from here rather than carrying its own
         copy. One place to configure it (the Cloudflare variable), no second
         value in index.html to drift out of step, and the app can tell the
         difference between "Google is off" and "this Worker is too old to know
         what Google is". The client id is public by design - it appears in the
         page source of every site that uses Google sign-in. */
      if (path === "/health") {
        return json({
          ok: true,
          version: WORKER_VERSION,
          google: !!env.GOOGLE_OAUTH_CLIENT_ID,
          googleClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
          mail: mailEnabled(env),
        });
      }

      if (path === "/auth/signup" && request.method === "POST") return await signup(request, env);
      if (path === "/auth/login" && request.method === "POST") return await login(request, env);
      if (path === "/auth/logout" && request.method === "POST") return await logout(request, env);
      if (path === "/auth/me" && request.method === "GET") return await me(request, env);
      if (path === "/auth/forgot/start" && request.method === "POST") return await forgotStart(request, env);
      if (path === "/auth/forgot/verify" && request.method === "POST") return await forgotVerify(request, env);
      if (path === "/auth/forgot/reset" && request.method === "POST") return await forgotReset(request, env);

      /* Sign in with Google, and managing your own account. Matching is exact
         equality, so /auth/google cannot shadow /auth/google/complete and the
         order of these lines carries no meaning. Every one of them is `return
         await` for the reason given above - do not tidy the await away. */
      if (path === "/auth/google" && request.method === "POST") return await googleAuth(request, env);
      if (path === "/auth/google/complete" && request.method === "POST") return await googleComplete(request, env);
      if (path === "/auth/google/link" && request.method === "POST") return await googleLink(request, env);
      if (path === "/auth/google/unlink" && request.method === "POST") return await googleUnlink(request, env);
      if (path === "/auth/nickname" && request.method === "POST") return await changeNickname(request, env);
      if (path === "/auth/password" && request.method === "POST") return await changePassword(request, env);
      if (path === "/auth/sessions/revoke" && request.method === "POST") return await signOutOthers(request, env);
      if (path === "/auth/account/delete" && request.method === "POST") return await deleteAccount(request, env);
      if (path === "/auth/verify/send" && request.method === "POST") return await verifySend(request, env);
      if (path === "/auth/verify/confirm" && request.method === "POST") return await verifyConfirm(request, env);
      if (path === "/auth/forgot/email" && request.method === "POST") return await forgotEmail(request, env);

      if (path === "/data") return await boardData(request, env);

      if (path === "/admin/bootstrap" && request.method === "POST") return await adminBootstrap(request, env);
      if (path === "/admin/users" && request.method === "GET") return await adminUsers(request, env);
      if (path === "/admin/user" && request.method === "POST") return await adminUpdateUser(request, env);
      if (path === "/admin/reset-password" && request.method === "POST") return await adminResetPassword(request, env);
      // Anything else under /admin still has to prove the capability before it
      // is told it does not exist - a 404 that only admins can see is a worse
      // leak than a 403 everyone can.
      if (path.startsWith("/admin/")) {
        const s = await requireSession(request, env);
        requireCap(s, "admin");
        return json({ error: "not found" }, 404);
      }

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
/* Everything it takes to bring an account into existence, in one place.

   Extracted when Sign in with Google arrived, because that path creates an
   account too and the alternative was a second copy of the uniqueness checks,
   the KV reservation, the row provisioning and the first-session issue. Two
   copies of security logic that must never disagree is the exact failure this
   file keeps a museum of - see the column-drift note above normUsername's
   "both routes go through here so they cannot drift" comment. One copy.

   `google` is optional: {sub, email} when Google vouched for this person,
   omitted for an ordinary signup. Everything else is identical either way -
   same role, same password requirement, same secret question. A Google account
   is not a different KIND of account here, only a faster way to reach one.

   `preflight` runs after every check has passed and before the first write. It
   is where the caller burns a single-use ticket: do it earlier and a taken
   username costs the user their whole Google handshake instead of one retry. */
async function createAccount(env, fields, preflight) {
  const firstName = requireText(fields.firstName, "First name", 1, 60);
  const lastName = requireText(fields.lastName, "Last name", 1, 60);
  const username = requireUsername(fields.username);
  const email = requireEmail(fields.email);
  const password = requirePassword(fields.password);
  const secretQuestion = requireText(fields.secretQuestion, "Secret question", 5, 200);
  const secretAnswer = requireText(fields.secretAnswer, "Secret answer", 2, 200);

  const usernameKey = normUsername(username);
  const emailKey = email.toLowerCase();
  const google = fields.google || null;

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
  /* The last line of defence against one Google identity owning two accounts.
     The ticket is single-use, but KV is eventually consistent, so two completes
     racing with DIFFERENT usernames could both clear the reservation above.
     This is what stops them. */
  if (google && rows.some((r) => r[F.googleSub] === google.sub)) {
    fail(409, "That Google account is already connected to a ProDash account.", "google_sub_taken");
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

  if (preflight) await preflight();

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
  row[F.perms] = "";                       // no overrides; the role defaults apply
  row[F.activatedAt] = now.toISOString();  // starts the clock if this becomes a guest
  row[F.nickname] = cleanNickname(fields.nickname);
  row[F.emailVerified] = fields.emailVerified ? "1" : "";
  if (google) {
    row[F.googleSub] = google.sub;
    row[F.googleEmail] = google.email;
    row[F.googleLinkedAt] = now.toISOString();
    row[F.googlePicture] = google.picture || "";
  }

  await appendUser(env, row);
  await env.PRODASH_KV.put(reservationKey, userId);

  await maybeClaimLegacyBoard(env, boardId);

  /* capsFor(row) rather than nothing: signup used to issue a token with an
     empty capability list, so a brand-new account's FIRST session carried no
     permissions at all and only got them on its next login. The client's
     fallback treats an empty list as full access (deliberately - see myCaps),
     so it never locked anyone out, which is exactly why it would have gone
     unnoticed. Caught by reading a signup token during an unrelated probe. */
  const token = await issueSession(env, {
    userId, boardId, role: "user", username, epoch: 1,
    caps: capsFor(row), gexp: guestExpiry(row), nick: row[F.nickname] || "",
  });
  return { token, row };
}

async function signup(request, env) {
  const body = await readJson(request);
  await throttle(env, request, "signup", 10, 3600);
  const { token, row } = await createAccount(env, body);
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
/* Who is trying to sign in, given whatever they typed in the one box.

   ProDash asked for a username for its whole life, and a lot of people type
   their email address into a box labelled "username" regardless. Accepting
   both costs one branch and removes an entire category of "it says my password
   is wrong" support. An address is anything containing "@" - that is not a
   validity test, just a routing decision, and a malformed address simply finds
   no row like a malformed username does.

   Email is matched on emailKey, which signup has always enforced as unique
   (see createAccount), so this can never be ambiguous. */
async function findLoginRow(env, identifier) {
  const raw = String(identifier || "").trim();
  if (!raw) return null;
  if (raw.includes("@")) {
    const key = raw.toLowerCase();
    return findUser(env, (r) => r[F.emailKey] === key);
  }
  const key = normUsername(raw);
  return key ? findUser(env, (r) => r[F.usernameKey] === key) : null;
}

/* Everything that decides whether an account may open a session AT ALL, before
   any credential is considered. Extracted so the password path and the Google
   path cannot drift: a door that is shut must be shut to both, or Google
   becomes a way around a lockout.

   Deliberately runs before the password check. An expired guest gets an honest
   answer instead of being told their password is wrong, and by this point the
   account has already been matched, so it discloses nothing the lockout
   message below does not. */
async function assertLoginable(env, row, rowNumber) {
  if (row[F.status] !== "active") {
    fail(403, "This account is not active. Please contact the administrator.", "disabled");
  }

  /* Flipping the row to "deactivated" as a side effect is what makes the expiry
     VISIBLE to the Super Admin in the user list, rather than being silently
     recomputed on every read and never recorded anywhere. */
  const gexp = guestExpiry(row);
  if (gexp !== null && Date.now() > gexp) {
    if (row[F.status] !== "deactivated") {
      const nextEpoch = Number(row[F.sessionEpoch] || 1) + 1;
      await updateUserRow(env, rowNumber, row, {
        [F.status]: "deactivated",
        [F.sessionEpoch]: String(nextEpoch),
      });
      // Bumping the epoch kills any session the guest still has open elsewhere.
      await env.PRODASH_KV.put(epochKey(row[F.userId]), String(nextEpoch));
    }
    fail(403, "This guest access has expired. Ask the administrator to reactivate it.", "guest_expired");
  }

  const lockedUntil = Number(row[F.lockedUntil] || 0);
  if (lockedUntil && Date.now() < lockedUntil) {
    fail(423, lockoutMessage(lockedUntil), "locked");
  }
  return lockedUntil;
}

/* The successful-sign-in bookkeeping, shared by password and Google. */
async function completeLogin(env, row, rowNumber, extraPatch) {
  const epoch = Number(row[F.sessionEpoch] || 1);
  const patch = Object.assign({
    [F.failedAttempts]: "0",
    [F.lockedUntil]: "",
    [F.lastLoginAt]: new Date().toISOString(),
  }, extraPatch || {});
  const next = await updateUserRow(env, rowNumber, row, patch);
  await env.PRODASH_KV.put(epochKey(row[F.userId]), String(epoch));

  const token = await issueSession(env, {
    userId: next[F.userId],
    boardId: next[F.boardId],
    role: normRole(next[F.role]),
    username: next[F.username],
    epoch,
    caps: capsFor(next),
    gexp: guestExpiry(next),
    nick: next[F.nickname] || "",
  });
  return { token, row: next };
}

async function login(request, env) {
  const body = await readJson(request);
  await throttle(env, request, "login", 30, 900);

  // `username` is still the field name on the wire: the live app sends it, and
  // renaming it would break every client that has not reloaded yet. It now
  // carries a username OR an email address.
  const identifier = String(body.username || body.email || "");
  const password = String(body.password || "");
  if (!identifier.trim() || !password) fail(400, "Enter your username or email, and your password.");

  const found = await findLoginRow(env, identifier);

  // No such user: burn roughly the same amount of time a real verification
  // costs, so response timing does not disclose whether the account exists.
  if (!found) {
    await hashSecret(password, env);
    fail(401, "Incorrect username or password.", "bad_credentials");
  }

  const { row, rowNumber } = found;
  const lockedUntil = await assertLoginable(env, row, rowNumber);

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

  // Transparent upgrade: if this hash was made with weaker parameters than the
  // Worker now uses, re-hash it here — the only moment the plaintext password
  // is legitimately in hand. This is what makes changing PBKDF2_ITERATIONS, or
  // later swapping the algorithm outright, a config change instead of a
  // password reset for every user.
  const extra = {};
  if (needsRehash(row[F.passwordHash], env)) {
    extra[F.passwordHash] = await hashSecret(password, env);
    extra[F.passwordUpdatedAt] = new Date().toISOString();
  }
  const { token, row: next } = await completeLogin(env, row, rowNumber, extra);
  return json({ ok: true, token, user: publicUser(next) });
}

function lockoutMessage(until) {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  const at = new Date(until).toISOString();
  return `Too many failed attempts. This account is locked for about ${mins} more minute${mins === 1 ? "" : "s"}. Try again after ${at}.`;
}

// ===========================================================================
// Endpoints — Sign in with Google
// ===========================================================================
/* GOOGLE_OAUTH_CLIENT_ID is deliberately NOT in requireConfig. That list is
   what the Worker cannot serve anything without; a missing Google client id
   must not take password login down with it. Instead every Google route asks
   here and answers 503 with a code the app uses to hide the button. */
function requireGoogleConfig(env) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    fail(503, "Sign in with Google is not set up on this server yet.", "google_not_configured");
  }
}

const GOOGLE_SIGNUP_TICKET_TTL_MS = 15 * 60 * 1000;  // 15 minutes

/* A username to put in the box, not a decision. The authoritative answer comes
   from createAccount, which is the only place that can be right about it.

   Deliberately does NOT reserve the name in KV: the reservation has a 120s TTL
   and exists to bracket a single append. Holding a name for the life of a
   15-minute ticket would burn names on every abandoned signup and still not be
   a guarantee. */
function suggestUsername(email, rows) {
  let base = normUsername(String(email || "").split("@")[0] || "");
  base = base.replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+/, "");
  if (base.length > 32) base = base.slice(0, 32);
  if (base.length < 3) base = (`pd${base}`).padEnd(3, "0");
  const taken = (u) => rows.some((r) => r[F.usernameKey] === u);
  if (!taken(base)) return base;
  for (let n = 2; n <= 9; n++) {
    const cand = `${base.slice(0, 31)}${n}`;
    if (!taken(cand)) return cand;
  }
  return `${base.slice(0, 26)}${randomId("").slice(-4)}`;
}

function googleFacts(row) {
  return {
    linked: !!row[F.googleSub],
    email: row[F.googleEmail] || "",
    picture: row[F.googlePicture] || "",
    linkedAt: row[F.googleLinkedAt] || "",
  };
}

/* Sign in with Google, or find out that signing up is what is needed.

   Three outcomes, one of which is a refusal by design. See the linking rule:
   an email match is NOT proof of ownership here, because ProDash has never
   verified the email addresses people type into its signup form. If it were
   treated as proof, anyone who registered using your address would receive
   your board the first time you tried Google. So a match refuses and sends the
   person through the front door, where their password proves the account is
   theirs before Google is attached to it. */
async function googleAuth(request, env) {
  requireGoogleConfig(env);
  const body = await readJson(request);
  await throttle(env, request, "google", 30, 900);

  const id = await verifyGoogleIdToken(env, body.idToken);
  const rows = await readUsers(env);

  const hit = rows.findIndex((r) => r[F.googleSub] === id.sub);
  if (hit !== -1) {
    const row = rows[hit];
    const rowNumber = hit + 2;
    await assertLoginable(env, row, rowNumber);
    /* Google just told us this address is verified, so heal a row that predates
       the column. The picture is refreshed at the same time because this is the
       only moment we are handed a current one. */
    const { token, row: next } = await completeLogin(env, row, rowNumber, {
      [F.emailVerified]: row[F.emailKey] === id.emailKey ? "1" : row[F.emailVerified],
      [F.googleEmail]: id.email,
      [F.googlePicture]: id.picture || row[F.googlePicture],
    });
    return json({ ok: true, mode: "signin", token, user: publicUser(next) });
  }

  if (rows.some((r) => r[F.emailKey] === id.emailKey)) {
    fail(409,
      "An account already exists for that email address. Sign in with your password, then connect Google from your profile.",
      "google_email_conflict");
  }

  /* Run the duplicate-person check HERE as well as inside createAccount. It is
     the same refusal either way, but finding out now costs the person nothing,
     whereas finding out after they have invented a password and a secret
     question wastes all of it. */
  const nameKey = `${id.firstName.toLowerCase()} ${id.lastName.toLowerCase()}`;
  if (id.firstName && id.lastName &&
      rows.some((r) => `${(r[F.firstName] || "").toLowerCase()} ${(r[F.lastName] || "").toLowerCase()}` === nameKey)) {
    fail(409, "An account already exists for that name. Try logging in, or use Forgot password.", "duplicate_person");
  }

  /* The ticket carries the only two facts that matter - who Google said this
     is, and at what address - signed, so the browser cannot edit them on the
     way to /auth/google/complete. It is signed, NOT encrypted: the same values
     come back in `prefill` anyway, so there is nothing to hide, and anyone
     tempted to "harden" this by encrypting it should know it would buy nothing.
     The signature is the entire point. */
  const ticket = await signPayload(env, {
    p: "gsignup",
    jti: randomId("gst"),
    gsub: id.sub,
    gem: id.email,
    gek: id.emailKey,
    gfn: id.firstName,
    gln: id.lastName,
    gpic: id.picture,
    iat: Date.now(),
    exp: Date.now() + GOOGLE_SIGNUP_TICKET_TTL_MS,
  });

  return json({
    ok: true,
    mode: "signup",
    ticket,
    expiresInSeconds: Math.floor(GOOGLE_SIGNUP_TICKET_TTL_MS / 1000),
    prefill: {
      firstName: id.firstName,
      lastName: id.lastName,
      email: id.email,
      suggestedUsername: suggestUsername(id.email, rows),
    },
  });
}

/* Finish a Google signup. The account created here is an ordinary ProDash
   account in every respect - same role, same password rules, same secret
   question - because a Google-only account would be one that cannot be
   recovered when Google is unavailable, and one that would lock its owner out
   the moment they disconnected Google. */
async function googleComplete(request, env) {
  requireGoogleConfig(env);
  const body = await readJson(request);
  await throttle(env, request, "signup", 10, 3600);

  const claims = await verifyPayload(env, String(body.ticket || ""));
  if (!claims || claims.p !== "gsignup" || !claims.gsub || Date.now() > Number(claims.exp || 0)) {
    fail(401, "That Google sign-up has expired. Please start again.", "bad_ticket");
  }

  const usedKey = `gsignup:${claims.jti}`;
  if (await env.PRODASH_KV.get(usedKey)) {
    fail(401, "That Google sign-up has already been used. Please start again.", "bad_ticket");
  }

  /* The ticket is burned inside createAccount's preflight - after every
     validation and uniqueness check has passed, immediately before the first
     write. Burning it earlier would mean a taken username costs the person
     their whole Google handshake instead of one retry. */
  const { token, row } = await createAccount(env, {
    firstName: body.firstName || claims.gfn,
    lastName: body.lastName || claims.gln,
    username: body.username,
    email: claims.gem,              // from the ticket, never the body
    password: body.password,
    secretQuestion: body.secretQuestion,
    secretAnswer: body.secretAnswer,
    nickname: body.nickname,
    emailVerified: true,            // Google verified it; we checked the claim
    google: { sub: claims.gsub, email: claims.gem, picture: claims.gpic || "" },
  }, async () => {
    await env.PRODASH_KV.put(usedKey, "1", { expirationTtl: 900 });
  });

  return json({ ok: true, token, user: publicUser(row) }, 201);
}

/* Connect Google to the account you are already signed in to.

   The password is required, and that is the most important line in this file's
   Google support. A session token is a thirty-day bearer credential sitting in
   localStorage; linking grants a permanent, password-free way in that survives
   the owner changing their password. Anyone who got one look at that token
   would have persistent access. Re-authenticating before ADDING an
   authentication factor is the standard rule, and here it costs one hash. */
async function googleLink(request, env) {
  requireGoogleConfig(env);
  const session = await requireSession(request, env);
  const body = await readJson(request);
  await throttle(env, request, "glink", 20, 900);

  const found = await findUser(env, (r) => r[F.userId] === session.uid);
  if (!found) fail(404, "Account not found.", "no_account");
  const { row, rowNumber } = found;

  /* A guest row is deactivated within 48 hours, and a Google identity attached
     to a dead row would be permanently unable to sign up for real without
     someone editing the sheet by hand. */
  if (normRole(row[F.role]) === "guest") {
    fail(403, "Guest access cannot be connected to a Google account.", "guest_no_link");
  }

  const ok = await verifySecret(String(body.password || ""), row[F.passwordHash], env);
  if (!ok) fail(401, "That password is not correct.", "bad_credentials");

  const id = await verifyGoogleIdToken(env, body.idToken);

  if (row[F.googleSub] === id.sub) {
    return json({ ok: true, alreadyLinked: true, google: googleFacts(row) });
  }
  if (row[F.googleSub]) {
    fail(409, "This account is already connected to a different Google account. Disconnect that one first.", "google_link_exists");
  }
  const rows = await readUsers(env);
  if (rows.some((r) => r[F.googleSub] === id.sub)) {
    fail(409, "That Google account is already connected to another ProDash account.", "google_sub_taken");
  }

  /* No epoch bump. Nothing about role, status or capability changed, so there
     is no reason to sign the person out of their other devices. */
  const next = await updateUserRow(env, rowNumber, row, {
    [F.googleSub]: id.sub,
    [F.googleEmail]: id.email,
    [F.googleLinkedAt]: new Date().toISOString(),
    [F.googlePicture]: id.picture || "",
    [F.emailVerified]: row[F.emailKey] === id.emailKey ? "1" : row[F.emailVerified],
  });
  return json({ ok: true, google: googleFacts(next) });
}

/* Disconnect Google. Password required for the same reason as linking, in
   reverse: quietly detaching someone's link is also an attack. Always safe to
   do, because every account has a password - the no_password branch cannot
   fire today and exists so that a future "Google-only signup" shortcut trips
   over it instead of stranding somebody. */
async function googleUnlink(request, env) {
  const session = await requireSession(request, env);
  const body = await readJson(request);

  const found = await findUser(env, (r) => r[F.userId] === session.uid);
  if (!found) fail(404, "Account not found.", "no_account");
  const { row, rowNumber } = found;

  if (!row[F.passwordHash]) {
    fail(409, "Set a password before disconnecting Google, or you will not be able to sign in.", "no_password");
  }
  const ok = await verifySecret(String(body.password || ""), row[F.passwordHash], env);
  if (!ok) fail(401, "That password is not correct.", "bad_credentials");

  if (!row[F.googleSub]) return json({ ok: true, google: googleFacts(row) });

  const next = await updateUserRow(env, rowNumber, row, {
    [F.googleSub]: "",
    [F.googleEmail]: "",
    [F.googleLinkedAt]: "",
    [F.googlePicture]: "",
  });
  return json({ ok: true, google: googleFacts(next) });
}

// ===========================================================================
// Endpoints — managing your own account
// ===========================================================================
/* Until now the only person who could change YOUR nickname was a Super Admin,
   and the only way to change your own password was to go through Forgot
   password. Both of those are answered here. */
async function changeNickname(request, env) {
  const session = await requireSession(request, env);
  const body = await readJson(request);

  const found = await findUser(env, (r) => r[F.userId] === session.uid);
  if (!found) fail(404, "Account not found.", "no_account");

  // No epoch bump - the reasoning is the same one /auth/me documents at length.
  const next = await updateUserRow(env, found.rowNumber, found.row, {
    [F.nickname]: cleanNickname(body.nickname),
  });
  return json({ ok: true, user: { nickname: next[F.nickname] || "" } });
}

/* Change your own password.

   Bumping sessionEpoch signs out every OTHER device, which is the correct
   behaviour: changing a password is what you do when you think someone else
   has it. The catch is that it would also sign out the tab doing the changing,
   because requireSession compares the epoch on the very next request. So a
   fresh token is minted at the new epoch and returned. Without that, "change
   my password" logs you out of the page you are sitting on, and everyone
   assumes that is normal and never reports it. */
async function changePassword(request, env) {
  const session = await requireSession(request, env);
  const body = await readJson(request);
  await throttle(env, request, "chpw", 10, 900);

  const nextPassword = requirePassword(body.newPassword);
  const found = await findUser(env, (r) => r[F.userId] === session.uid);
  if (!found) fail(404, "Account not found.", "no_account");
  const { row, rowNumber } = found;

  const ok = await verifySecret(String(body.currentPassword || ""), row[F.passwordHash], env);
  if (!ok) fail(401, "Your current password is not correct.", "bad_credentials");
  if (String(body.currentPassword) === nextPassword) {
    fail(400, "That is the password you are already using.", "same_password");
  }

  /* Deliberately no failedAttempts bump on a wrong current password, unlike
     login. The caller already holds a valid session, so guessing the old
     password buys them nothing they do not already have, and locking the
     account would punish the legitimate owner mid-session. The throttle above
     is the right control here. */
  const epoch = Number(row[F.sessionEpoch] || 1) + 1;
  const next = await updateUserRow(env, rowNumber, row, {
    [F.passwordHash]: await hashSecret(nextPassword, env),
    [F.passwordUpdatedAt]: new Date().toISOString(),
    [F.failedAttempts]: "0",
    [F.lockedUntil]: "",
    [F.sessionEpoch]: String(epoch),
  });
  await env.PRODASH_KV.put(epochKey(row[F.userId]), String(epoch));

  const token = await issueSession(env, {
    userId: next[F.userId], boardId: next[F.boardId], role: normRole(next[F.role]),
    username: next[F.username], epoch, caps: capsFor(next),
    gexp: guestExpiry(next), nick: next[F.nickname] || "",
  });
  return json({ ok: true, token, user: publicUser(next) });
}

/* Sign out everywhere else. Same epoch mechanism as a password change, without
   the password change - for "I left myself signed in on a machine I no longer
   have". The calling device keeps working, because it gets a new token. */
async function signOutOthers(request, env) {
  const session = await requireSession(request, env);
  const found = await findUser(env, (r) => r[F.userId] === session.uid);
  if (!found) fail(404, "Account not found.", "no_account");
  const { row, rowNumber } = found;

  const epoch = Number(row[F.sessionEpoch] || 1) + 1;
  const next = await updateUserRow(env, rowNumber, row, { [F.sessionEpoch]: String(epoch) });
  await env.PRODASH_KV.put(epochKey(row[F.userId]), String(epoch));

  const token = await issueSession(env, {
    userId: next[F.userId], boardId: next[F.boardId], role: normRole(next[F.role]),
    username: next[F.username], epoch, caps: capsFor(next),
    gexp: guestExpiry(next), nick: next[F.nickname] || "",
  });
  return json({ ok: true, token });
}

/* Delete your own account, permanently.

   Three gates, because this is the one irreversible thing a user can do to
   themselves here and there is no backup of a board anywhere: the password,
   the username typed back exactly, and the client's own confirmation. The
   board in KV goes first - a row with no board is a broken account, but a
   board with no row is an orphan nobody can ever reach or delete.

   The sheet row is CLEARED rather than removed. Deleting a row shifts every
   row below it up by one, and this Worker addresses rows by number within a
   single request (findUser returns rowNumber, updateUserRow writes to it), so
   a concurrent request holding a stale number would write one person's data
   over another's. Blanking is the safe operation: readUsers keeps returning a
   row, but with no username_key, no email_key and no google_sub it can never
   be found by any lookup, and its board is gone. */
async function deleteAccount(request, env) {
  const session = await requireSession(request, env);
  const body = await readJson(request);
  await throttle(env, request, "delacct", 5, 900);

  const found = await findUser(env, (r) => r[F.userId] === session.uid);
  if (!found) fail(404, "Account not found.", "no_account");
  const { row, rowNumber } = found;

  const ok = await verifySecret(String(body.password || ""), row[F.passwordHash], env);
  if (!ok) fail(401, "That password is not correct.", "bad_credentials");

  if (normUsername(String(body.confirmUsername || "")) !== row[F.usernameKey]) {
    fail(400, "Type your username exactly to confirm.", "confirm_mismatch");
  }

  /* A Super Admin deleting themselves could leave nobody able to manage
     anyone. The same reasoning already stops one demoting themselves. */
  if (normRole(row[F.role]) === "superadmin") {
    fail(403, "A Super Admin cannot delete their own account. Ask another Super Admin, or change your role first.", "self_delete_superadmin");
  }

  await env.PRODASH_KV.delete(boardKey(row[F.boardId]));
  await env.PRODASH_KV.delete(`uname:${row[F.usernameKey]}`);

  const blank = {};
  for (let i = 0; i < COL_COUNT; i++) blank[i] = "";
  blank[F.userId] = row[F.userId];                      // keeps the row identifiable in an audit
  blank[F.status] = "deleted";
  blank[F.createdAt] = row[F.createdAt] || "";
  blank[F.sessionEpoch] = String(Number(row[F.sessionEpoch] || 1) + 1);
  await updateUserRow(env, rowNumber, row, blank);

  // Kills every session this account still has open anywhere.
  await env.PRODASH_KV.put(epochKey(row[F.userId]), blank[F.sessionEpoch]);

  return json({ ok: true, deleted: true });
}

// ===========================================================================
// Email — built, and switched off until someone provides a key
// ===========================================================================
/* ProDash has never sent an email. Recovery is the secret question, which needs
   no provider, costs nothing and works when the rest of the internet does not.
   That remains the working path.

   This exists so that turning verification and reset-links on later is a
   configuration change rather than a feature to design under pressure. Nothing
   below runs until BOTH MAIL_API_KEY and MAIL_FROM are set on the Worker; until
   then every mail-dependent endpoint answers 503 `mail_not_configured` and the
   app hides the controls that would need it. No stub sender, no "pretend it
   worked" branch - an account that believes it sent a verification email it
   never sent is worse than one that says it cannot.

   Written against Resend's API because its free tier needs no card, but it is
   one fetch to one URL: MAIL_PROVIDER_URL can point at anything that accepts
   {from,to,subject,text} and a Bearer key.

   Deliverability warning for whoever switches this on: mail sent from a domain
   you do not own lands in spam. This wants a custom domain with SPF and DKIM
   before it is worth trusting for password resets. */
const MAIL_URL_DEFAULT = "https://api.resend.com/emails";
const VERIFY_TICKET_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours

function mailEnabled(env) {
  return !!(env && env.MAIL_API_KEY && env.MAIL_FROM);
}

function requireMail(env) {
  if (!mailEnabled(env)) {
    fail(503, "Email is not switched on for this server yet.", "mail_not_configured");
  }
}

async function sendMail(env, { to, subject, text }) {
  requireMail(env);
  const res = await fetch(env.MAIL_PROVIDER_URL || MAIL_URL_DEFAULT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MAIL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) {
    // Never the provider's body to the client: it echoes the recipient address
    // and would turn a failed send into an enumeration oracle.
    console.error("mail send failed", res.status, await res.text());
    fail(502, "Could not send the email just now. Please try again.", "mail_failed");
  }
}

/* The address the links in those emails point back at. It has to be configured
   rather than taken from the Origin header, or anyone could have the Worker
   mail a victim a link to a site the attacker controls. */
function appUrl(env, path) {
  const base = String(env.APP_URL || "").replace(/\/+$/, "");
  if (!base) fail(503, "Email is not switched on for this server yet.", "mail_not_configured");
  return `${base}${path}`;
}

/* Send yourself a verification link. Requires a session, so this is not an
   enumeration oracle - you can only ask about the address on your own row. */
async function verifySend(request, env) {
  const session = await requireSession(request, env);
  requireMail(env);
  await throttle(env, request, "verifysend", 5, 900);

  const found = await findUser(env, (r) => r[F.userId] === session.uid);
  if (!found) fail(404, "Account not found.", "no_account");
  const { row } = found;

  if (row[F.emailVerified] === "1") return json({ ok: true, alreadyVerified: true });

  const ticket = await signPayload(env, {
    p: "verify",
    uid: row[F.userId],
    ek: row[F.emailKey],          // pinned, so changing the address voids the link
    exp: Date.now() + VERIFY_TICKET_TTL_MS,
  });

  await sendMail(env, {
    to: row[F.email],
    subject: "Confirm your ProDash email address",
    text: `Confirm this address so ProDash can reach you about your account:\n\n`
      + `${appUrl(env, `/?verify=${encodeURIComponent(ticket)}`)}\n\n`
      + `The link works for 24 hours. If you did not create a ProDash account, ignore this email.`,
  });
  return json({ ok: true, sent: true });
}

/* Confirm an address from the link. Deliberately does NOT require a session:
   people open email on a different device from the one they signed up on. The
   ticket is the credential, and it grants exactly one thing - setting a flag
   on the row it names. */
async function verifyConfirm(request, env) {
  const body = await readJson(request);
  await throttle(env, request, "verifyconfirm", 20, 900);

  const claims = await verifyPayload(env, String(body.ticket || ""));
  if (!claims || claims.p !== "verify" || Date.now() > Number(claims.exp || 0)) {
    fail(401, "That confirmation link has expired. Send yourself a new one.", "bad_ticket");
  }

  const found = await findUser(env, (r) => r[F.userId] === claims.uid);
  if (!found) fail(404, "Account not found.", "no_account");
  // The address is pinned into the ticket: if it changed after the link was
  // sent, the link confirms nothing.
  if (found.row[F.emailKey] !== claims.ek) {
    fail(409, "That address has changed since the link was sent.", "email_changed");
  }
  if (found.row[F.emailVerified] === "1") return json({ ok: true, alreadyVerified: true });

  await updateUserRow(env, found.rowNumber, found.row, { [F.emailVerified]: "1" });
  return json({ ok: true, verified: true });
}

/* Password reset by emailed link — the alternative to the secret question, for
   when mail is switched on. It mints exactly the same `p:"reset"` ticket the
   secret-question path produces, so /auth/forgot/reset serves both and there is
   only one place that can set a password from a ticket.

   Always answers 200. Whether an address is registered is precisely the thing
   an unauthenticated recovery endpoint must not disclose, so a miss sends
   nothing and says the same sentence as a hit. */
async function forgotEmail(request, env) {
  requireMail(env);
  const body = await readJson(request);
  await throttle(env, request, "forgotemail", 10, 900);

  const same = json({ ok: true, sent: true });
  const key = String(body.email || "").trim().toLowerCase();
  if (!key) return same;

  const found = await findUser(env, (r) => r[F.emailKey] === key);
  if (!found || found.row[F.status] !== "active") return same;

  const ticket = await signPayload(env, {
    p: "reset",
    uid: found.row[F.userId],
    epoch: Number(found.row[F.sessionEpoch] || 1),
    exp: Date.now() + RESET_TICKET_TTL_MS,
  });

  try {
    await sendMail(env, {
      to: found.row[F.email],
      subject: "Reset your ProDash password",
      text: `Someone asked to reset the password for ${found.row[F.username]}.\n\n`
        + `${appUrl(env, `/?reset=${encodeURIComponent(ticket)}`)}\n\n`
        + `The link works for 10 minutes. If this was not you, nothing has changed and you can ignore this.`,
    });
  } catch (e) {
    // Swallowed on purpose: a send failure must not become the one response
    // shape that proves an address exists.
    console.error("reset mail failed", e && e.message);
  }
  return same;
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

  /* The nickname is read from the SHEET here, not from the token.

     Everything else in this response can safely come out of the signed token,
     because everything else KILLS THE SESSION when it changes: a role, a
     status or a permission change bumps sessionEpoch, so the holder is signed
     out and their next token is minted from the new row. The nickname
     deliberately does not do that - it is a word in a heading, and signing
     someone out over it would be absurd.

     That exemption is exactly what broke it. session.nick is a snapshot taken
     when the token was issued, so a nickname set afterwards was invisible to
     this endpoint for the life of the token - up to thirty days. The symptom
     was precise and misleading: saving worked, the sheet was correct, the
     heading changed instantly, and then the next page load called /auth/me,
     got nickname:"" from a token minted before the change, and merged that
     empty string back over the good value. It looked like the save had not
     persisted when in fact only this line disagreed with the sheet.

     One row read per boot. /auth/me is a background confirmation - the board
     has already opened from cache by the time it answers - so the cost is not
     on any path the user waits for. Wrapped, because a Sheets hiccup must
     degrade to the token's copy rather than fail the confirmation outright. */
  let nickname = session.nick || "";
  /* google stays NULL, not {linked:false}, when the sheet could not be read.
     "Unknown" and "not connected" are different answers, and the Profile screen
     needs to tell them apart: degrading to not-connected would offer a Connect
     Google button on an already-connected account, and someone would press it. */
  let google = null;
  let emailVerified = null;
  try {
    const found = await findUser(env, (r) => r[F.userId] === session.uid);
    if (found) {
      nickname = found.row[F.nickname] || "";
      google = googleFacts(found.row);
      emailVerified = found.row[F.emailVerified] === "1";
    }
  } catch (e) { /* keep the token's copy */ }

  return json({
    ok: true,
    user: {
      userId: session.uid,
      username: session.un,
      role: session.role,
      caps: session.caps || [],
      nickname: nickname,
      guestExpiresAt: session.gexp || null,
      boardId: session.bid,
      google: google,
      emailVerified: emailVerified,
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
// Endpoints — admin
// ===========================================================================
// The seam the earlier version left is now filled in: adminUsers and
// adminUpdateUser sit behind the same capability gate the placeholder used, and
// sessions, hashing and the sheet layout were not disturbed to add them - which
// was the point of leaving a seam rather than a stub.
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
  if (rows.some((r) => normRole(r[F.role]) === "superadmin")) fail(409, "A Super Admin account already exists.");
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
  row[F.role] = "superadmin";
  row[F.status] = "active";
  row[F.failedAttempts] = "0";
  row[F.boardId] = randomId("brd");   // the admin gets an ordinary board of its own
  row[F.createdAt] = now;
  row[F.passwordUpdatedAt] = now;
  row[F.sessionEpoch] = "1";
  row[F.perms] = "";
  row[F.activatedAt] = now;
  await appendUser(env, row);

  return json({ ok: true, note: "Temporary admin created. Delete ADMIN_BOOTSTRAP_TOKEN from the Worker's variables now." }, 201);
}

/* ---------------------------------------------------------------------------
   ADMIN
   ---------------------------------------------------------------------------
   The only endpoints in this Worker that touch somebody ELSE'S row, which is
   why they are the only place where the permission check is load-bearing rather
   than cosmetic. Gated on the "admin" capability read out of the signed token,
   never out of anything the client sends. */
async function adminUsers(request, env) {
  const session = await requireSession(request, env);
  requireCap(session, "admin");
  const rows = await readUsers(env);
  return json({
    ok: true,
    // Deliberately narrow: no hashes, no secret question, no email keys.
    // An admin screen needs to identify and triage accounts, not read them.
    users: rows.map((r) => {
      const gexp = guestExpiry(r);
      return {
        userId: r[F.userId],
        username: r[F.username],
        name: ((r[F.firstName] || "") + " " + (r[F.lastName] || "")).trim(),
        nickname: r[F.nickname] || "",
        email: r[F.email],
        role: normRole(r[F.role]),
        status: r[F.status] || "active",
        caps: capsFor(r),
        createdAt: r[F.createdAt],
        lastLoginAt: r[F.lastLoginAt],
        activatedAt: r[F.activatedAt],
        guestExpiresAt: gexp,
        guestExpired: gexp !== null && Date.now() > gexp,
        lockedUntil: Number(r[F.lockedUntil] || 0) || null,
        /* Whether Google is connected, and to which address. The email is
           already in this projection, so this discloses nothing new to someone
           who can already read the list - and without it, the only way to break
           a link for someone who has lost their Google account is to edit the
           sheet by hand. */
        googleLinked: !!r[F.googleSub],
        googleEmail: r[F.googleEmail] || "",
        emailVerified: r[F.emailVerified] === "1",
      };
    }),
    // So the admin screen can render the same capability list the server uses
    // rather than keeping its own copy that drifts.
    roles: Object.keys(CAPS),
    caps: CAPS,
  });
}

async function adminUpdateUser(request, env) {
  const session = await requireSession(request, env);
  requireCap(session, "admin");
  const body = await readJson(request);
  const targetId = String(body.userId || "");
  if (!targetId) fail(400, "Which user?");

  const found = await findUser(env, (r) => r[F.userId] === targetId);
  if (!found) fail(404, "No such user.");
  const { row, rowNumber } = found;

  /* Self-protection. An admin who demotes or deactivates their own account
     locks everyone out of administration permanently, because there is no
     recovery path short of editing the sheet by hand. Cheaper to refuse. */
  if (targetId === session.uid) {
    if (body.role !== undefined && normRole(body.role) !== "superadmin")
      fail(400, "You cannot remove your own Super Admin role.", "self_demote");
    if (body.status !== undefined && body.status !== "active")
      fail(400, "You cannot deactivate your own account.", "self_deactivate");
  }

  const patch = {};
  let killSessions = false;

  if (body.role !== undefined) {
    const r = normRole(body.role);
    if (!CAPS[r]) fail(400, "Unknown role.");
    patch[F.role] = r;
    killSessions = true;
    // Promoting into "guest" starts a fresh 48 hours - otherwise the clock
    // would run from whenever the account first existed, which for an account
    // converted from a user is already long past.
    if (r === "guest") patch[F.activatedAt] = new Date().toISOString();
  }

  if (body.status !== undefined) {
    const s = String(body.status);
    if (["active", "inactive", "deactivated"].indexOf(s) < 0) fail(400, "Unknown status.");
    patch[F.status] = s;
    if (s !== "active") killSessions = true;
    // Reactivating a guest restarts their clock; without this they would come
    // back already expired and bounce straight out again.
    if (s === "active" && normRole(patch[F.role] || row[F.role]) === "guest")
      patch[F.activatedAt] = new Date().toISOString();
  }

  /* The operator escape hatch for Google. Someone who has lost access to the
     Google account they connected cannot unlink it themselves - the unlink
     endpoint needs their password, which they have, but the link is only half
     the problem: that Google identity also stays blocked from ever signing up
     again, because a sub can only be attached to one row. This releases it.

     No killSessions: they can still sign in with their password, so there is
     nothing to revoke. Same reasoning as the nickname case below. */
  if (body.unlinkGoogle) {
    patch[F.googleSub] = "";
    patch[F.googleEmail] = "";
    patch[F.googleLinkedAt] = "";
    patch[F.googlePicture] = "";
  }

  // Explicit "give them another 48 hours" without touching role or status.
  if (body.resetGuestClock) {
    patch[F.activatedAt] = new Date().toISOString();
    if ((row[F.status] || "") === "deactivated") patch[F.status] = "active";
  }

  if (body.nickname !== undefined) {
    // Same clamp as signup, from one function, so the two entry points cannot
    // drift into disagreeing about what a nickname may contain.
    patch[F.nickname] = cleanNickname(body.nickname);
    // No killSessions: this is a word in a heading. It reaches them when they
    // next sign in, and the sheet - which is what this screen reads - is
    // correct immediately.
  }

  if (body.perms !== undefined) {
    // Stored as JSON text. Validated here so a malformed cell can never reach
    // capsFor() and silently collapse someone back to role defaults.
    if (body.perms === null || body.perms === "") patch[F.perms] = "";
    else {
      let p = body.perms;
      if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { fail(400, "Malformed permissions."); } }
      if (typeof p !== "object" || Array.isArray(p)) fail(400, "Permissions must be an object.");
      patch[F.perms] = JSON.stringify(p);
    }
    killSessions = true;
  }

  if (!Object.keys(patch).length) fail(400, "Nothing to change.");

  /* Any change to who someone IS has to reach the tokens they are already
     holding. Bumping the epoch signs them out everywhere, so a demotion or a
     deactivation takes effect on their next request rather than whenever their
     30-day token happens to lapse. */
  if (killSessions) {
    const nextEpoch = Number(row[F.sessionEpoch] || 1) + 1;
    patch[F.sessionEpoch] = String(nextEpoch);
    await env.PRODASH_KV.put(epochKey(targetId), String(nextEpoch));
  }

  const next = await updateUserRow(env, rowNumber, row, patch);
  const gexp = guestExpiry(next);
  return json({
    ok: true,
    user: {
      userId: next[F.userId],
      username: next[F.username],
      nickname: next[F.nickname] || "",
      role: normRole(next[F.role]),
      status: next[F.status],
      caps: capsFor(next),
      activatedAt: next[F.activatedAt],
      guestExpiresAt: gexp,
      guestExpired: gexp !== null && Date.now() > gexp,
    },
    signedOut: killSessions,
  });
}

/* Admin-issued temporary password, for "I cannot get in and Forgot password is
   not working for me".

   The plaintext exists for exactly one response and is never stored: it is
   hashed with the same PBKDF2 + pepper as any other password before it touches
   the sheet. If the admin loses it, there is no way to recover it - they issue
   another one. That is the property worth having.

   Issuing one also signs the account out everywhere. If the reason someone
   needs a temp password is that their account was compromised, leaving their
   old sessions alive would defeat the point. */
const TEMP_PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function makeTempPassword() {
  // Grouped as xxxx-xxxx-xxxx so it can be read aloud over a phone without
  // ambiguity. The alphabet already excludes O/0 and I/l/1 for the same reason.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i && i % 4 === 0) out += "-";
    out += TEMP_PW_ALPHABET[bytes[i] % TEMP_PW_ALPHABET.length];
  }
  /* requirePassword insists on an upper, a lower and a digit, and a random draw
     can miss one. Rather than reject and retry, append a guaranteed set - the
     entropy of the 12 random characters is what matters, and this only makes
     the result longer. */
  const pick = (s) => s[crypto.getRandomValues(new Uint8Array(1))[0] % s.length];
  return out + "-" + pick("ABCDEFGHJKLMNPQRSTUVWXYZ") + pick("abcdefghijkmnpqrstuvwxyz") + pick("23456789");
}

async function adminResetPassword(request, env) {
  const session = await requireSession(request, env);
  requireCap(session, "admin");
  const body = await readJson(request);
  const targetId = String(body.userId || "");
  if (!targetId) fail(400, "Which user?");

  const found = await findUser(env, (r) => r[F.userId] === targetId);
  if (!found) fail(404, "No such user.");
  const { row, rowNumber } = found;

  const temp = makeTempPassword();
  const nextEpoch = Number(row[F.sessionEpoch] || 1) + 1;

  await updateUserRow(env, rowNumber, row, {
    [F.passwordHash]: await hashSecret(temp, env),
    // Stamped as an admin action, not a user one. The value still answers
    // "when did this password last change", which is what it is for.
    [F.passwordUpdatedAt]: new Date().toISOString(),
    // Whatever lockout put them here is cleared, otherwise the temp password
    // would be handed over to an account that still refuses to accept it.
    [F.failedAttempts]: "0",
    [F.lockedUntil]: "",
    [F.sessionEpoch]: String(nextEpoch),
  });
  await env.PRODASH_KV.put(epochKey(targetId), String(nextEpoch));

  return json({
    ok: true,
    username: row[F.username],
    // The only time this string exists anywhere. Not logged, not stored.
    tempPassword: temp,
  });
}

function requireCap(session, cap) {
  const caps = session.caps || [];
  if (caps.indexOf(cap) < 0) fail(403, "You do not have access to that.", "forbidden");
}
// ===========================================================================
// Sessions — stateless signed tokens, with a KV escape hatch
// ===========================================================================
// The signature alone proves the token is ours and unmodified, so the common
// path costs no Sheets read at all. Two cheap KV reads then cover the two
// things a signature cannot express: this device signed out (revocation), and
// the password changed (epoch).
async function issueSession(env, { userId, boardId, role, username, epoch, caps, gexp, nick }) {
  await env.PRODASH_KV.put(epochKey(userId), String(epoch));
  /* A guest's token is capped at their 48-hour expiry rather than the usual 30
     days. That makes the clock enforce ITSELF through the ordinary expiry check
     in requireSession - no per-request sheet read, and nothing to bypass by
     editing localStorage, because the cap is inside the signature. */
  const ttl = Date.now() + SESSION_TTL_MS;
  const exp = (gexp && gexp < ttl) ? gexp : ttl;
  return signPayload(env, {
    p: "session",
    sid: randomId("ses"),
    uid: userId,
    bid: boardId,
    role: role || "user",
    un: username,
    caps: caps || [],
    gexp: gexp || null,
    /* Display only. In the token so the greeting can render at boot with no
       network call, which is what file:// use and the 30-day offline grace
       need. The cost is that an admin's edit lands on their next sign-in
       rather than immediately - acceptable for a word in a heading, and the
       alternative is a sheet read on every session check. */
    nick: nick || "",
    epoch,
    iat: Date.now(),
    exp,
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

// ===========================================================================
// Sign in with Google — ID token verification
// ===========================================================================
/* The browser runs Google's own sign-in UI and receives an ID token: a JWT
   signed by Google with RS256. Everything below exists to answer one question
   — did GOOGLE really say this, about this person, TO THIS APP — because the
   token arrives from the browser, which is exactly the place we cannot trust.

   Verified locally rather than by calling Google's /tokeninfo endpoint on every
   sign-in. Google's own documentation calls tokeninfo a debugging aid and says
   not to use it in production, and a round trip per login would cost more than
   the verification itself: RS256 verification is trivial next to the PBKDF2
   this Worker already runs inside the free plan's CPU budget.

   Note the direction. googleAccessToken() above SIGNS an RS256 assertion with
   our own private key; this VERIFIES one signed with Google's. Same algorithm,
   opposite halves of the key pair, and no shared code beyond the b64url
   helpers. */
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

/* Google publishes a Cache-Control max-age on the certs response and rotates
   the keys behind it. Cached in the isolate exactly like tokenCache, and
   deliberately re-fetched ONCE when a kid is missing: that is what a rotation
   looks like from here, and refusing a valid sign-in until the isolate happens
   to recycle would be an outage nobody could explain. */
let certsCache = { keys: null, expiresAt: 0 };

async function googleCerts(force) {
  if (!force && certsCache.keys && Date.now() < certsCache.expiresAt) return certsCache.keys;
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    console.error("google certs fetch failed", res.status);
    fail(502, "Could not reach Google to check your sign-in. Please try again.");
  }
  const body = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1] || 3600);
  certsCache = { keys: body.keys || [], expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return certsCache.keys;
}

async function verifyRs256(kid, signingInput, sigBytes) {
  for (const force of [false, true]) {
    const keys = await googleCerts(force);
    const jwk = keys.find((k) => k.kid === kid);
    if (!jwk) {
      if (force) return false;   // genuinely unknown key, not a stale cache
      continue;                  // might be a rotation: refetch once and retry
    }
    const key = await crypto.subtle.importKey(
      "jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, sigBytes,
      new TextEncoder().encode(signingInput),
    );
  }
  return false;
}

/* Returns the identity Google vouched for, or throws. Every refusal is the
   same 401 with the same wording: the client can do nothing differently with a
   more specific reason, and a detailed "why your forged token failed" is a gift
   to whoever forged it. The real reason goes to the log, matching how
   sheetsFetch collapses Google's errors. */
async function verifyGoogleIdToken(env, idToken) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    fail(503, "Sign in with Google is not set up on this server yet.", "google_not_configured");
  }
  const bad = (why) => {
    console.error("google id token rejected:", why);
    fail(401, "Google sign-in could not be verified. Please try again.", "invalid_google_token");
  };

  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) bad("not three parts");

  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch (e) { bad("undecodable"); }

  // alg is pinned. A token whose header says "none" or names an HMAC algorithm
  // is the oldest JWT attack there is, and the check costs one comparison.
  if (header.alg !== "RS256") bad(`alg was ${header.alg}`);
  if (!header.kid) bad("no kid");

  const ok = await verifyRs256(header.kid, `${parts[0]}.${parts[1]}`, b64urlDecode(parts[2]));
  if (!ok) bad("signature did not verify");

  // aud is the load-bearing one. Without it, an ID token minted for ANY other
  // site that uses Google sign-in would be accepted here — every one of them
  // is a real, correctly-signed Google token for a real person.
  if (claims.aud !== env.GOOGLE_OAUTH_CLIENT_ID) bad("aud is a different client");
  if (!GOOGLE_ISSUERS.includes(claims.iss)) bad(`iss was ${claims.iss}`);

  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || now >= Number(claims.exp)) bad("expired");
  // A little slack for a client whose clock runs fast; the token is short-lived
  // regardless, and exp above is the check that actually bounds it.
  if (claims.iat && Number(claims.iat) > now + 300) bad("issued in the future");

  if (!claims.sub) bad("no sub");
  // An unverified address would let anyone claim any email by signing up to
  // Google with it. It is also the claim the whole link/refuse decision rests
  // on, so it has to be Google's assertion and not merely Google's echo.
  if (claims.email_verified !== true && claims.email_verified !== "true") bad("email not verified");
  if (!claims.email) bad("no email");

  /* given_name/family_name are absent on some accounts, so fall back to
     splitting `name`. Both are clamped before they can reach the sheet by
     requireText in createAccount, and neutralised by cellSafe on the way in. */
  const whole = String(claims.name || "").trim();
  const first = String(claims.given_name || "") || whole.split(/\s+/)[0] || "";
  const last = String(claims.family_name || "") || whole.split(/\s+/).slice(1).join(" ") || "";

  return {
    sub: String(claims.sub),
    email: String(claims.email),
    emailKey: String(claims.email).trim().toLowerCase(),
    firstName: first,
    lastName: last,
    picture: String(claims.picture || ""),
  };
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
    `/values/${encodeURIComponent(`${SHEET_TAB}!A:${LAST_COL}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row.map(cellSafe)] }) },
  );
}

async function updateUserRow(env, rowNumber, currentRow, patch) {
  const next = currentRow.slice();
  for (const [idx, value] of Object.entries(patch)) next[Number(idx)] = value;
  await sheetsFetch(
    env,
    `/values/${encodeURIComponent(`${SHEET_TAB}!A${rowNumber}:${LAST_COL}${rowNumber}`)}?valueInputOption=RAW`,
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
  /* Two reasons to prefix an apostrophe, and Sheets strips it again on read.

     1. A leading =+-@ makes Sheets treat the cell as a FORMULA. A display name
        of "=IMPORTXML(...)" would otherwise run inside the accounts sheet.

     2. A run of 16+ digits gets stored as a NUMBER and handed back as
        "1.07812345678901E+20". A Google `sub` is around 21 digits, and it is
        the key every Google sign-in is matched on - so without this, linking
        would appear to work and then silently never match again, and two
        different Google accounts could even round to the same string. Nothing
        else in the schema is a long number (lockedUntil is 13 digits), so this
        clause only ever fires for the column it was written for. */
  return /^[=+\-@\t\r]/.test(s) || /^\d{16,}$/.test(s) ? `'${s}` : s;
}

// ===========================================================================
// Validation
// ===========================================================================
// Every field is checked here rather than trusted from the client, because the
// client's checks are a convenience the user can skip with one curl command.
/* Display-only, and it reaches the sheet from a PUBLIC endpoint, so the clamp
   belongs here rather than on the form. Control characters (newlines among
   them) become spaces: a nickname carrying a line break would corrupt the row
   visually in the sheet and mean nothing useful in a heading. Trimmed on both
   sides of the cut, so slicing mid-space cannot leave a trailing one.
   Absent is not an error - most accounts will never set one. */
function cleanNickname(value) {
  // Strings only. A JSON body carrying a number or an object would otherwise be
  // stringified into someone's greeting, and "[object Object]" is not a
  // nickname. Ignoring it beats a 400 on a field nobody has to fill in.
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
}

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
  //
  // caps and guestExpiresAt are here because the browser decides what to DRAW
  // from this object. Leaving them out did not weaken anything - the token
  // carries both and the server reads them from there - but it left the client
  // guessing, and its guess for "no caps listed" is a full-access account
  // WITHOUT admin. That produced a Super Admin badge above a missing Super
  // Admin tab, and a guest with no visible countdown. Same shape as /auth/me,
  // deliberately, so the two can never disagree about the same account.
  return {
    userId: row[F.userId],
    username: row[F.username],
    firstName: row[F.firstName],
    lastName: row[F.lastName],
    role: normRole(row[F.role]),
    caps: capsFor(row),
    nickname: row[F.nickname] || "",
    guestExpiresAt: guestExpiry(row),
    /* The connected-account facts, so the Profile screen can render without a
       second round trip and so login, signup and /auth/me cannot disagree
       about the same account - which is what the note above insists on.

       Yes, this puts an email address in a browser-facing payload, against the
       first line of this comment. It is the person's OWN linked Google address,
       in a response only ever sent to that same person, and Profile cannot say
       WHICH account is connected without it. /admin/users builds its own
       narrower projection and deliberately does not gain this. */
    google: {
      linked: !!row[F.googleSub],
      email: row[F.googleEmail] || "",
      picture: row[F.googlePicture] || "",
      linkedAt: row[F.googleLinkedAt] || "",
    },
    emailVerified: row[F.emailVerified] === "1",
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
