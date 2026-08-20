# Insightyyy Cloud — Setup & Security Model

This folder is the **cloud version**: accounts, cross-device sync, and end-to-end
encryption on top of the v1 app. The original folder (`Insightyyy`) is untouched and
keeps working standalone. With no Supabase configuration, this version behaves
exactly like v1 (local-only) — cloud features light up when the env vars exist.

## One-time setup (you do this part — it needs your own accounts)

1. **Create a Supabase project** at https://supabase.com (free tier is fine to start).
   Choose a strong database password and a region near you.
2. **Run the schema**: Dashboard → SQL Editor → New query → paste the entire contents
   of [`supabase/schema.sql`](../supabase/schema.sql) → Run. This creates the tables
   (`user_keys`, `projects`, `insights`, `seq_blocks`), enables row-level security on
   all of them, and installs the `reserve_block` / `get_login_params` functions.
3. **Get the API credentials**: Dashboard → Project Settings → API. Copy the
   *Project URL* and the *anon public* key.
4. **Configure the app**: copy `.env.example` to `.env.local` and fill both values.
   (For a deployed build, set the same two variables before `npm run build` — they
   are baked into the bundle. The anon key is public by design; RLS is the guard.)
5. **Auth settings** (Dashboard → Authentication):
   - Providers → Email: leave "Confirm email" ON for a real SaaS.
   - URL Configuration → Site URL: your deployed domain (used by reset emails).
6. `npm run dev` → the app now opens on the **credentials page**. Create your account,
   and **save the recovery key it shows you** — with E2E encryption it is the only
   way back in after a forgotten password.

Deploying is the same as v1 (static files on any HTTPS host); only the two env vars
at build time differ.

## What the server can and cannot see

| Server stores | Readable? |
| --- | --- |
| Insight content, images, source tags, project names | **No — AES-GCM-256 ciphertext only** |
| Your password | **No** — the login credential is a PBKDF2 hash derived on-device (600k iterations); the real password never leaves the browser |
| The master encryption key | **No** — stored only wrapped (encrypted) by keys derived from your password / recovery key |
| Email address, project prefixes, ref numbers, timestamps, deleted/purged flags | Yes (needed for login, uniqueness, and sync ordering) |

Key envelope (Bitwarden-style): random 256-bit master key → wrapped by a
password-derived KEK and separately by a recovery-key-derived KEK. Password change or
recovery re-wraps the same master key, so old data stays readable. The unlocked key
lives **only in memory** — a reload lands on the Unlock screen.

Implementation: [`src/cloud/crypto.ts`](../src/cloud/crypto.ts) (envelope, KDF, AES-GCM),
[`src/cloud/auth.ts`](../src/cloud/auth.ts) (signup/login/recovery flows),
[`src/cloud/sync.ts`](../src/cloud/sync.ts) (encrypt-before-upload sync),
[`src/cloud/blocks.ts`](../src/cloud/blocks.ts) (ID reservation).

## How sync works

- Local IndexedDB remains the source of truth for the UI — the app is still
  offline-first. Every local write sets a `dirty` flag.
- Sync (on unlock, after each capture, every 60s, and on regaining connectivity)
  pushes dirty rows (encrypting content client-side first) and pulls rows newer than
  the last cursor. Conflict rule: last-write-wins by timestamp, but **a row with
  unpushed local edits is never overwritten**.
- Deletes, restores, and purge tombstones sync like any other edit — D1 (numbers
  never reused) holds across every device.

## Reference IDs across devices (the durability answer)

Each device **reserves blocks of 100 upcoming numbers per project** via an atomic
server function. Captures take numbers from the local block, which is why:

- the Capture Zone shows **"Next: Q3-47" before you submit** — guaranteed, so you can
  write it in the notebook first;
- two devices capturing offline can never collide (they hold disjoint ranges);
- numbering may skip ranges when you switch devices — allowed by design (D1 permits
  gaps; uniqueness is what notebooks need, not contiguity).

Blocks auto-refill in the background when fewer than 20 numbers remain. A device that
has never been online for a project has no numbers and **refuses to capture rather
than guess** — the one rule this product never breaks.

## Security posture summary (SaaS expectations)

- E2E encryption as above; TLS everywhere (Supabase + your HTTPS host).
- Row-level security on every table: a user's session can only touch `auth.uid()` rows.
- Auth: Supabase (bcrypt at rest server-side, rate limiting, email verification,
  reset emails) — receiving only the derived hash, never the password.
- CSP in `index.html`: only self-hosted scripts run; network egress limited to Supabase.
- Password floor (10+ chars, letters+digits) enforced client-side at signup.
- Recovery key: 128-bit random, shown once, acknowledged before continuing.
- Residual risks to accept/track: a compromised *build* of the app itself could
  exfiltrate keys (mitigation: control your deploy pipeline), and metadata
  (prefixes, ref counts, timing) is visible to the server by design.

## Business/SaaS runway (not built yet, by intent)

- **Billing**: add Stripe + a `subscriptions` table checked by RLS policies or an
  edge function; the client already gates all cloud calls through one module.
- **Realtime sync**: Supabase Realtime channels can replace the 60s poll.
- **Large libraries**: move image ciphertext from table rows to Supabase Storage
  objects when average insight size grows (the envelope format already isolates
  content serialization in `sync.ts`).
- **Email domain**: point Supabase SMTP at your own domain before launch.
