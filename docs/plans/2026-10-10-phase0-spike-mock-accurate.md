# Fase 0 — Spike & Mock Server Accurate: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memverifikasi API Accurate Online yang tidak pasti (spike) dan membangun mock server Accurate lengkap untuk meng-enablir pengembangan Fase 1–2 tanpa credential akun.

**Architecture:** `mocks/accurate/` — server Express TypeScript mandiri dengan fixture in-memory (2 tenant db, 2 user dengan level privilege berbeda), diuji vitest + supertest. Semua bentuk response mock dikontrakkan di `docs/spikes/2026-10-10-accurate-api-findings.md`; adapter asli di Fase 1 akan menerjemahkan real↔mock. Spike non-mock: skrip CLI Gemini native audio (`scripts/spike-gemini-audio.mjs`).

**Tech Stack:** Node 22, TypeScript, Express 4, vitest 2, supertest, pnpm, tsx.

**Kontrak response mock (dipakai semua task):** envelope `{ s: { status: boolean, message?: string }, d: any }`; base path `/accurate/api/{module}/{action}.do`; auth API = header `X-Session-ID` (bukan Bearer — Bearer hanya untuk `/oauth/*` dan `/api/db-list.do`, `/api/open-db.do`).

**Environment:** file `.env` di root sudah berisi `GEMINI_API_KEY` dan `GOOGLE_OAUTH_CLIENT_ID` (milik pemilik project; `.env` memang ikut ter-commit — keputusan pemilik). Semua perintah dijalankan dari `/root/aigoogle`.

---

## File Structure

```
mocks/accurate/
  package.json          — paket mandiri, script dev/start/test
  tsconfig.json         — strict, NodeNext, noEmit
  vitest.config.ts      — environment node
  src/
    server.ts           — createApp() + autostart via env MOCK_ACCURATE_AUTOSTART=1
    store.ts            — data in-memory: users, dbs, sessions, token, kode OAuth; helper akses
    oauth.ts            — router /oauth/authorize|token|userinfo
    session.ts          — middleware X-Session-ID → req.mockCtx { dbId, userId }
    api-router.ts       — router mount /accurate/api + /api/db-list.do, /api/open-db.do
    modules/
      access-privilege.ts — list.do, detail.do (katalog privilege per db)
      customer.ts         — list.do (diproteksi AllowView)
      sales-entry.ts      — list.do (diproteksi AllowView)
  test/
    app.test.ts           — smoke /health
    store.test.ts         — helper lookup
    oauth.test.ts         — authorize/token/userinfo
    db-session.test.ts    — db-list/open-db/session guard
    access-privilege.test.ts
    modules.test.ts       — proteksi modul + isolasi tenant
scripts/
  spike-gemini-audio.mjs  — spike TTS-out Gemini (Bahasa Indonesia)
docs/spikes/
  2026-10-10-accurate-api-findings.md   — temuan spike Accurate (diisi bertahap)
  2026-10-10-gemini-audio-findings.md   — temuan spike audio
```

---

## Task Outline

### Task 1: Scaffold paket mocks/accurate + smoke test
### Task 2: Spike — dokumentasi publik Accurate (OpenAPI + GitHub resmi)
### Task 3: Store — fixture & helper lookup
### Task 4: OAuth mock — authorize, token, userinfo
### Task 5: db-list, open-db, session guard
### Task 6: access-privilege list & detail
### Task 7: Modul read (customer, sales-entry) + isolasi tenant
### Task 8: Spike — Gemini native audio (Bahasa Indonesia)
### Task 9: Konsolidasi findings + README mock

---

<!-- TASKS -->

### Task 1: Scaffold paket mocks/accurate + smoke test

**Files:**
- Create: `mocks/accurate/package.json`, `mocks/accurate/tsconfig.json`, `mocks/accurate/vitest.config.ts`, `mocks/accurate/src/server.ts`, `mocks/accurate/test/app.test.ts`

- [ ] **Step 1: Verifikasi .env ada**

Run: `test -f /root/aigoogle/.env && grep -c GEMINI_API_KEY /root/aigoogle/.env`
Expected: `1` — kalau gagal, berhenti dan tanya pemilik project.

- [ ] **Step 2: Buat skeleton file**

Create `mocks/accurate/package.json`:

```json
{
  "name": "@mock/accurate",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "MOCK_ACCURATE_AUTOSTART=1 tsx watch src/server.ts",
    "start": "MOCK_ACCURATE_AUTOSTART=1 tsx src/server.ts",
    "test": "vitest run"
  },
  "dependencies": { "express": "^4.21.2" },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `mocks/accurate/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Create `mocks/accurate/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 3: Tulis failing test**

Create `mocks/accurate/test/app.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

describe("mock accurate app", () => {
  it("GET /health → 200 { ok: true }", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 4: Install dependensi**

Run: `pnpm install` (di `mocks/accurate/`)
Expected: `Done in ...s`, tanpa error peer dep.

- [ ] **Step 5: Jalankan test — harus FAIL (module belum ada)**

Run: `pnpm test` (di `mocks/accurate/`)
Expected: FAIL — `Cannot find module '../src/server.js'`

- [ ] **Step 6: Implement minimal**

Create `mocks/accurate/src/server.ts`:

```ts
import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

if (process.env.MOCK_ACCURATE_AUTOSTART === "1") {
  const port = Number(process.env.PORT ?? 4010);
  createApp().listen(port, () => {
    console.log(`mock accurate listening :${port}`);
  });
}
```

- [ ] **Step 7: Jalankan test — harus PASS**

Run: `pnpm test`
Expected: PASS, 1 test hijau.

- [ ] **Step 8: Commit**

```bash
git add mocks/accurate .env
git commit -m "feat(mock-accurate): scaffold paket + smoke test /health"
```

---

### Task 2: Spike — dokumentasi publik Accurate (OpenAPI + GitHub resmi)

**Files:**
- Create: `docs/spikes/2026-10-10-accurate-api-findings.md`
- Create: `docs/spikes/accurate-openapi.json` (arsip skema)

- [ ] **Step 1: Unduh skema OpenAPI publik**

Run: `curl -sL "https://account.accurate.id/open-api/json.do" -o docs/spikes/accurate-openapi.json && wc -c docs/spikes/accurate-openapi.json`
Expected: file terunduh, ukuran > 0. Kalau 401/HTML login → catat di findings "butuh akun developer" dan lanjut Step 2.

- [ ] **Step 2: Inspeksi skema**

Run (di `/root/aigoogle`):

```bash
node -e "
const s = require('./docs/spikes/accurate-openapi.json');
const paths = Object.keys(s.paths ?? {});
console.log('total paths:', paths.length);
console.log(paths.filter(p => p.includes('oauth') || p.includes('db-list') || p.includes('open-db') || p.includes('privilege')).join('\n'));
console.log('---contoh modul---');
console.log(paths.slice(0, 40).join('\n'));
"
```

Expected: daftar path tercetak. Catat: (a) bentuk envelope response, (b) nama endpoint OAuth persis, (c) parameter `open-db.do`, (d) bentuk `access-privilege/detail.do` — ada/tidak pemetaan per-user.

- [ ] **Step 3: Riset GitHub resmi & mekanisme launch add-on**

- WebSearch: `site:github.com aol-integration accurate online cpssoft` dan `accurate online add-on developer documentation oauth dbId`
- WebFetch README repo resmi yang ditemukan (termasuk `accurate-schema-mcp` bila ada), serta halaman developer (`account.accurate.id/developer` — kalau butuh login, catat).
- WebFetch `https://ai.google.dev/gemini-api/docs/audio` untuk daftar model native audio (dipakai Task 8).

- [ ] **Step 4: Tulis findings**

Create `docs/spikes/2026-10-10-accurate-api-findings.md` dengan bagian:

```markdown
# Spike: API Accurate Online — Temuan (2026-10-10)

## Status per butir spike
| # | Butir | Status | Jawaban |
|---|---|---|---|
| 1 | Parameter launch add-on (dbId/token) | ... | ... |
| 2 | access-privilege detail: matriks per-user? | ... | ... |
| 6 | Scope OAuth final per modul | ... | ... |

## Envelope response (real)
## Endpoint OAuth (real)
## open-db.do — parameter & response
## access-privilege — bentuk list & detail; pemetaan user→privilege
## Daftar modul & naming
## Keputusan untuk mock & Fase 1
## Gap yang butuh akun developer CPSsoft
```

Isi setiap bagian dari hasil Step 1–3; yang tidak terjawab = "BUTUH AKUN DEVELOPER" di kolom status + apa yang harus ditanyakan.

- [ ] **Step 5: Commit**

```bash
git add docs/spikes
git commit -m "docs(spike): temuan API Accurate Online dari sumber publik"
```

<!-- TASKS-CONTINUE -->

### Task 3: Store — fixture & helper lookup

**Files:**
- Create: `mocks/accurate/src/store.ts`, `mocks/accurate/test/store.test.ts`

- [ ] **Step 1: Tulis failing test**

Create `mocks/accurate/test/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  listDbs, getDb, listUsers, getUser,
  issueCode, exchangeCode, issueAccess, issueRefresh, useRefresh, userFromBearer,
  createSession, resolveSession,
} from "../src/store.js";

describe("store", () => {
  it("menyediakan 2 db & 2 user fixture", () => {
    expect(listDbs()).toHaveLength(2);
    expect(listUsers().map((u) => u.id)).toEqual(["user-admin", "user-staff"]);
    expect(getDb("1001")?.name).toBe("PT Maju Jaya");
  });

  it("siklus kode OAuth: issue → exchange", () => {
    const code = issueCode("user-admin");
    expect(exchangeCode(code)).toBe("user-admin");
    expect(exchangeCode(code)).toBeNull(); // sekali pakai
  });

  it("siklus access & refresh token", () => {
    const at = issueAccess("user-admin");
    expect(userFromBearer(`Bearer ${at}`)).toBe("user-admin");
    const rt = issueRefresh("user-admin");
    expect(useRefresh(rt)).toBe("user-admin");
    expect(useRefresh(rt)).toBeNull(); // rotasi: sekali pakai
  });

  it("siklus session: create → resolve → expired", () => {
    const sid = createSession("1001", "user-admin");
    expect(resolveSession(sid)).toMatchObject({ dbId: "1001", userId: "user-admin" });
    expect(resolveSession("sess-nihil")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test — harus FAIL**

Run: `pnpm test` (di `mocks/accurate/`)
Expected: FAIL — store.js belum ada.

- [ ] **Step 3: Implement store**

Create `mocks/accurate/src/store.ts`:

```ts
import { randomUUID } from "node:crypto";

export interface PrivilegeRow {
  ModuleName: string;
  AllowView: boolean;
  AllowCreate: boolean;
  AllowUpdate: boolean;
  AllowDelete: boolean;
}
export interface MockUser { id: string; email: string; name: string; }
export interface Customer { id: string; name: string; }
export interface SalesEntry { id: string; customerName: string; date: string; total: number; }
export interface MockDb {
  id: string; name: string; alias: string;
  userPrivileges: Record<string, string>; // userId → privilegeId
  privileges: Record<string, PrivilegeRow[]>; // privilegeId → modul
  data: { customers: Customer[]; salesEntries: SalesEntry[] };
}

const ALL_MODULES = ["customer", "sales-entry", "purchase-entry", "account"];
const priv = (mods: string[], allow: boolean): PrivilegeRow[] =>
  ALL_MODULES.map((m) => ({
    ModuleName: m, AllowView: allow && mods.includes(m),
    AllowCreate: false, AllowUpdate: false, AllowDelete: false,
  }));

const dbs: Record<string, MockDb> = {
  "1001": {
    id: "1001", name: "PT Maju Jaya", alias: "MAJU",
    userPrivileges: { "user-admin": "priv-admin", "user-staff": "priv-staff" },
    privileges: {
      "priv-admin": priv(ALL_MODULES, true),
      "priv-staff": priv(["sales-entry"], true),
    },
    data: {
      customers: [{ id: "C-001", name: "Budi Santoso" }, { id: "C-002", name: "Siti Aminah" }],
      salesEntries: [{ id: "SJ-001", customerName: "Budi Santoso", date: "2026-10-01", total: 2500000 }],
    },
  },
  "1002": {
    id: "1002", name: "CV Sejahtera", alias: "SIAP",
    userPrivileges: { "user-admin": "priv-admin" },
    privileges: { "priv-admin": priv(ALL_MODULES, true) },
    data: {
      customers: [{ id: "C-101", name: "Toko Bersama" }],
      salesEntries: [{ id: "SJ-101", customerName: "Toko Bersama", date: "2026-10-03", total: 1750000 }],
    },
  },
};

const users: Record<string, MockUser> = {
  "user-admin": { id: "user-admin", email: "admin@demo.local", name: "Admin Demo" },
  "user-staff": { id: "user-staff", email: "staff@demo.local", name: "Staff Demo" },
};

const codes = new Map<string, string>();
const accessTokens = new Map<string, { userId: string; exp: number }>();
const refreshTokens = new Map<string, string>();
const sessions = new Map<string, { dbId: string; userId: string; exp: number }>();
const DAY = 86400;
const HOUR_MS = 3600_000;

export const listDbs = () => Object.values(dbs).map(({ id, name, alias }) => ({ id, name, alias }));
export const getDb = (id: string) => dbs[id] ?? null;
export const listUsers = () => Object.values(users);
export const getUser = (id: string) => users[id] ?? null;

export const issueCode = (userId: string) => {
  const c = `code-${randomUUID()}`;
  codes.set(c, userId);
  return c;
};
export const exchangeCode = (code: string) => {
  const u = codes.get(code) ?? null;
  codes.delete(code);
  return u;
};
export const issueAccess = (userId: string) => {
  const t = `at-${randomUUID()}`;
  accessTokens.set(t, { userId, exp: Date.now() + 15 * DAY * 1000 });
  return t;
};
export const issueRefresh = (userId: string) => {
  const t = `rt-${randomUUID()}`;
  refreshTokens.set(t, userId);
  return t;
};
export const useRefresh = (rt: string) => {
  const u = refreshTokens.get(rt) ?? null;
  refreshTokens.delete(rt);
  return u;
};
export const userFromBearer = (header?: string) => {
  if (!header?.startsWith("Bearer ")) return null;
  const rec = accessTokens.get(header.slice(7));
  if (!rec || rec.exp < Date.now()) return null;
  return rec.userId;
};
export const createSession = (dbId: string, userId: string) => {
  const sid = `sess-${randomUUID()}`;
  sessions.set(sid, { dbId, userId, exp: Date.now() + HOUR_MS });
  return sid;
};
export const resolveSession = (sid: string | undefined) => {
  if (!sid) return null;
  const rec = sessions.get(sid);
  if (!rec || rec.exp < Date.now()) return null;
  return rec;
};
export const privilegeOf = (dbId: string, userId: string, module: string): PrivilegeRow | null =>
  dbs[dbId]?.privileges[dbs[dbId].userPrivileges[userId] ?? ""]?.find((p) => p.ModuleName === module) ?? null;
export const privilegesOf = (dbId: string, userId: string): PrivilegeRow[] =>
  dbs[dbId]?.privileges[dbs[dbId].userPrivileges[userId] ?? ""] ?? [];
export const privilegeGroups = (dbId: string) =>
  Object.entries(dbs[dbId]?.privileges ?? {}).map(([id]) => ({ id, name: id === "priv-admin" ? "Administrator" : "Staff Penjualan" }));
```

- [ ] **Step 4: Jalankan test — harus PASS**

Run: `pnpm test`
Expected: PASS — store suite hijau (app test tetap hijau).

- [ ] **Step 5: Commit**

```bash
git add mocks/accurate/src/store.ts mocks/accurate/test/store.test.ts
git commit -m "feat(mock-accurate): store fixture 2 db, 2 user, token/session lifecycle"
```

---

### Task 4: OAuth mock — authorize, token, userinfo

**Files:**
- Create: `mocks/accurate/src/oauth.ts`, `mocks/accurate/test/oauth.test.ts`
- Modify: `mocks/accurate/src/server.ts`

- [ ] **Step 1: Tulis failing test**

Create `mocks/accurate/test/oauth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

const app = createApp();

async function login(user?: string) {
  const q = new URLSearchParams({
    client_id: "mock-client", redirect_uri: "http://localhost:3000/cb", state: "abc",
    ...(user ? { user } : {}),
  });
  const auth = await request(app).get(`/oauth/authorize?${q}`);
  const code = new URL(auth.headers.location).searchParams.get("code")!;
  const tok = await request(app).post("/oauth/token").send({
    grant_type: "authorization_code", code, client_id: "mock-client", client_secret: "x",
  });
  return tok.body as { access_token: string; refresh_token: string; expires_in: number };
}

describe("oauth mock", () => {
  it("authorize redirect balikkan code & state", async () => {
    const res = await request(app).get(
      "/oauth/authorize?client_id=mock-client&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&state=xyz"
    );
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe("http://localhost:3000/cb");
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("code")).toMatch(/^code-/);
  });

  it("authorize ?user=staff menghasilkan token staff", async () => {
    const tok = await login("staff");
    const info = await request(app).get("/oauth/userinfo").set("Authorization", `Bearer ${tok.access_token}`);
    expect(info.body.email).toBe("staff@demo.local");
  });

  it("token: expires_in 15 hari & code sekali pakai", async () => {
    const q = new URLSearchParams({ client_id: "c", redirect_uri: "http://localhost:3000/cb" });
    const auth = await request(app).get(`/oauth/authorize?${q}`);
    const code = new URL(auth.headers.location).searchParams.get("code")!;
    const tok1 = await request(app).post("/oauth/token").send({ grant_type: "authorization_code", code });
    expect(tok1.body.expires_in).toBe(15 * 86400);
    const tok2 = await request(app).post("/oauth/token").send({ grant_type: "authorization_code", code });
    expect(tok2.status).toBe(400);
  });

  it("refresh token menghasilkan akses baru; refresh lama hangus", async () => {
    const tok = await login();
    const re = await request(app).post("/oauth/token").send({ grant_type: "refresh_token", refresh_token: tok.refresh_token });
    expect(re.status).toBe(200);
    expect(re.body.access_token).toMatch(/^at-/);
    const re2 = await request(app).post("/oauth/token").send({ grant_type: "refresh_token", refresh_token: tok.refresh_token });
    expect(re2.status).toBe(400);
  });

  it("userinfo tanpa token → 401", async () => {
    const res = await request(app).get("/oauth/userinfo");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Jalankan test — harus FAIL**

Run: `pnpm test`
Expected: FAIL — oauth router belum dipasang (route 404).

- [ ] **Step 3: Implement oauth router**

Create `mocks/accurate/src/oauth.ts`:

```ts
import { Router } from "express";
import { exchangeCode, getUser, issueAccess, issueCode, issueRefresh, useRefresh, userFromBearer } from "./store.js";

export const oauthRouter = Router();

oauthRouter.get("/authorize", (req, res) => {
  const { redirect_uri, state, user } = req.query as Record<string, string>;
  if (!redirect_uri) return res.status(400).json({ error: "redirect_uri required" });
  const userId = user === "staff" ? "user-staff" : "user-admin";
  const url = new URL(redirect_uri);
  url.searchParams.set("code", issueCode(userId));
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

oauthRouter.post("/token", (req, res) => {
  const { grant_type, code, refresh_token } = req.body as Record<string, string>;
  const payload = (userId: string) => ({
    token_type: "Bearer",
    access_token: issueAccess(userId),
    refresh_token: issueRefresh(userId),
    expires_in: 15 * 86400,
  });
  if (grant_type === "authorization_code") {
    const userId = exchangeCode(code);
    if (!userId) return res.status(400).json({ error: "invalid_code" });
    return res.json(payload(userId));
  }
  if (grant_type === "refresh_token") {
    const userId = useRefresh(refresh_token);
    if (!userId) return res.status(400).json({ error: "invalid_refresh_token" });
    return res.json(payload(userId));
  }
  return res.status(400).json({ error: "unsupported_grant_type" });
});

oauthRouter.get("/userinfo", (req, res) => {
  const userId = userFromBearer(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: "invalid_token" });
  const u = getUser(userId)!;
  res.json({ id: u.id, email: u.email, name: u.name });
});
```

Modify `mocks/accurate/src/server.ts` — tambah import & mount:

```ts
import { oauthRouter } from "./oauth.js";
// di dalam createApp(), setelah app.use(...):
app.use("/oauth", oauthRouter);
```

- [ ] **Step 4: Jalankan test — harus PASS**

Run: `pnpm test`
Expected: PASS semua suite.

- [ ] **Step 5: Commit**

```bash
git add mocks/accurate/src/oauth.ts mocks/accurate/src/server.ts mocks/accurate/test/oauth.test.ts
git commit -m "feat(mock-accurate): oauth authorize/token/userinfo + rotasi refresh token"
```

---

### Task 5: db-list, open-db, session guard

**Files:**
- Create: `mocks/accurate/src/session.ts`, `mocks/accurate/src/api-router.ts`, `mocks/accurate/test/db-session.test.ts`
- Modify: `mocks/accurate/src/server.ts`

- [ ] **Step 1: Tulis failing test**

Create `mocks/accurate/test/db-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { issueAccess } from "../src/store.js";

const app = createApp();
const bearer = () => `Bearer ${issueAccess("user-admin")}`;

describe("db-list, open-db, session", () => {
  it("db-list tanpa Bearer → 401; dengan Bearer → 2 db", async () => {
    expect((await request(app).post("/api/db-list.do")).status).toBe(401);
    const res = await request(app).post("/api/db-list.do").set("Authorization", bearer());
    expect(res.status).toBe(200);
    expect(res.body.s.status).toBe(true);
    expect(res.body.d.rows.map((r: { id: string }) => r.id)).toEqual(["1001", "1002"]);
  });

  it("open-db dbId valid → session + host mock", async () => {
    const res = await request(app).post("/api/open-db.do")
      .set("Authorization", bearer()).send({ dbId: "1001" });
    expect(res.body.s.status).toBe(true);
    expect(res.body.d.session).toMatch(/^sess-/);
    expect(res.body.d.host).toMatch(/^http/);
  });

  it("open-db dbId asing → status false", async () => {
    const res = await request(app).post("/api/open-db.do")
      .set("Authorization", bearer()).send({ dbId: "9999" });
    expect(res.body.s.status).toBe(false);
  });

  it("modul butuh X-Session-ID valid", async () => {
    const tanpa = await request(app).post("/accurate/api/ping.do");
    expect(tanpa.status).toBe(401);
    const { body } = await request(app).post("/api/open-db.do")
      .set("Authorization", bearer()).send({ dbId: "1001" });
    const ok = await request(app).post("/accurate/api/ping.do")
      .set("X-Session-ID", body.d.session);
    expect(ok.status).toBe(200);
    expect(ok.body.d).toMatchObject({ dbId: "1001", userId: "user-admin" });
  });
});
```

- [ ] **Step 2: Jalankan test — harus FAIL**

Run: `pnpm test`
Expected: FAIL — route `/api/db-list.do` 404.

- [ ] **Step 3: Implement session middleware & api-router**

Create `mocks/accurate/src/session.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { resolveSession } from "./store.js";

export interface MockCtx { dbId: string; userId: string; }
declare global { namespace Express { interface Request { mockCtx?: MockCtx } } }

export function sessionGuard(req: Request, res: Response, next: NextFunction) {
  const ctx = resolveSession(req.header("X-Session-ID") ?? undefined);
  if (!ctx) return res.status(401).json({ s: { status: false, message: "Session tidak valid" }, d: null });
  req.mockCtx = ctx;
  next();
}

export function envelope(status: boolean, d: unknown, message?: string) {
  return { s: { status, ...(message ? { message } : {}) }, d };
}
```

Create `mocks/accurate/src/api-router.ts`:

```ts
import { Router } from "express";
import { sessionGuard, envelope } from "./session.js";
import { createSession, getDb, listDbs, userFromBearer } from "./store.js";

export const apiRouter = Router(); // mount di /accurate/api (modul, butuh session)
export const rootApiRouter = Router(); // mount di / (db-list & open-db, butuh Bearer)

rootApiRouter.post("/api/db-list.do", (req, res) => {
  const userId = userFromBearer(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: "invalid_token" });
  const rows = listDbs();
  res.json(envelope(true, { rows, total: rows.length }));
});

rootApiRouter.post("/api/open-db.do", (req, res) => {
  const userId = userFromBearer(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: "invalid_token" });
  const dbId = String((req.body as Record<string, string>).dbId ?? "");
  if (!getDb(dbId)) return res.json(envelope(false, null, "Database tidak ditemukan"));
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json(envelope(true, { session: createSession(dbId, userId), host: origin }));
});

apiRouter.post("/ping.do", sessionGuard, (req, res) => {
  res.json(envelope(true, { ...req.mockCtx }));
});
```

Modify `mocks/accurate/src/server.ts` — mount:

```ts
import { apiRouter, rootApiRouter } from "./api-router.js";
// di createApp(), setelah app.use("/oauth", oauthRouter):
app.use(rootApiRouter);
app.use("/accurate/api", apiRouter);
```

- [ ] **Step 4: Jalankan test — harus PASS**

Run: `pnpm test`
Expected: PASS semua suite.

- [ ] **Step 5: Commit**

```bash
git add mocks/accurate/src mocks/accurate/test/db-session.test.ts
git commit -m "feat(mock-accurate): db-list, open-db, session guard X-Session-ID"
```

---

### Task 6: access-privilege list & detail

**Files:**
- Create: `mocks/accurate/src/modules/access-privilege.ts`, `mocks/accurate/test/access-privilege.test.ts`
- Modify: `mocks/accurate/src/api-router.ts`

- [ ] **Step 1: Tulis failing test**

Create `mocks/accurate/test/access-privilege.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { issueAccess } from "../src/store.js";

const app = createApp();

async function session(dbId: string, userId = "user-admin") {
  const res = await request(app).post("/api/open-db.do")
    .set("Authorization", `Bearer ${issueAccess(userId)}`).send({ dbId });
  return res.body.d.session as string;
}

describe("access-privilege", () => {
  it("list.do → grup privilege di db itu", async () => {
    const sid = await session("1001");
    const res = await request(app).post("/accurate/api/access-privilege/list.do")
      .set("X-Session-ID", sid);
    expect(res.body.s.status).toBe(true);
    expect(res.body.d.rows.map((r: { id: string }) => r.id)).toEqual(["priv-admin", "priv-staff"]);
  });

  it("detail.do admin → semua modul AllowView true", async () => {
    const sid = await session("1001");
    const res = await request(app).get("/accurate/api/access-privilege/detail.do?id=priv-admin")
      .set("X-Session-ID", sid);
    const rows = res.body.d.Privilege as { ModuleName: string; AllowView: boolean }[];
    expect(rows.every((r) => r.AllowView)).toBe(true);
  });

  it("detail.do staff → account false, sales-entry true", async () => {
    const sid = await session("1001");
    const res = await request(app).get("/accurate/api/access-privilege/detail.do?id=priv-staff")
      .set("X-Session-ID", sid);
    const byMod = Object.fromEntries(
      (res.body.d.Privilege as { ModuleName: string; AllowView: boolean }[]).map((r) => [r.ModuleName, r.AllowView])
    );
    expect(byMod["sales-entry"]).toBe(true);
    expect(byMod["account"]).toBe(false);
  });

  it("detail.do id ngawur → status false", async () => {
    const sid = await session("1001");
    const res = await request(app).get("/accurate/api/access-privilege/detail.do?id=xxx")
      .set("X-Session-ID", sid);
    expect(res.body.s.status).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test — harus FAIL**

Run: `pnpm test`
Expected: FAIL — access-privilege 404 di router.

- [ ] **Step 3: Implement access-privilege**

Create `mocks/accurate/src/modules/access-privilege.ts`:

```ts
import { Router } from "express";
import { sessionGuard, envelope } from "../session.js";
import { getDb, privilegeGroups } from "../store.js";

export const accessPrivilegeRouter = Router();

accessPrivilegeRouter.post("/list.do", sessionGuard, (req, res) => {
  const rows = privilegeGroups(req.mockCtx!.dbId);
  res.json(envelope(true, { rows, total: rows.length }));
});

accessPrivilegeRouter.get("/detail.do", sessionGuard, (req, res) => {
  const db = getDb(req.mockCtx!.dbId);
  const priv = db?.privileges[String(req.query.id ?? "")];
  if (!priv) return res.json(envelope(false, null, "Privilege tidak ditemukan"));
  res.json(envelope(true, { Privilege: priv }));
});
```

Modify `mocks/accurate/src/api-router.ts` — mount di dalam `apiRouter`:

```ts
import { accessPrivilegeRouter } from "./modules/access-privilege.js";
apiRouter.use("/access-privilege", accessPrivilegeRouter);
```

- [ ] **Step 4: Jalankan test — harus PASS**

Run: `pnpm test`
Expected: PASS semua suite.

- [ ] **Step 5: Commit**

```bash
git add mocks/accurate/src mocks/accurate/test/access-privilege.test.ts
git commit -m "feat(mock-accurate): access-privilege list & detail per db"
```

---

### Task 7: Modul read (customer, sales-entry) + isolasi tenant

**Files:**
- Create: `mocks/accurate/src/modules/customer.ts`, `mocks/accurate/src/modules/sales-entry.ts`, `mocks/accurate/test/modules.test.ts`
- Modify: `mocks/accurate/src/api-router.ts`

- [ ] **Step 1: Tulis failing test**

Create `mocks/accurate/test/modules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { issueAccess } from "../src/store.js";

const app = createApp();

async function session(dbId: string, userId = "user-admin") {
  const res = await request(app).post("/api/open-db.do")
    .set("Authorization", `Bearer ${issueAccess(userId)}`).send({ dbId });
  return res.body.d.session as string;
}

describe("modul read + isolasi tenant", () => {
  it("isolasi: customer db 1001 ≠ db 1002", async () => {
    const s1 = await session("1001");
    const s2 = await session("1002");
    const r1 = await request(app).post("/accurate/api/customer/list.do").set("X-Session-ID", s1);
    const r2 = await request(app).post("/accurate/api/customer/list.do").set("X-Session-ID", s2);
    expect(r1.body.d.rows[0].name).toBe("Budi Santoso");
    expect(r2.body.d.rows[0].name).toBe("Toko Bersama");
  });

  it("staff db 1001: sales-entry boleh", async () => {
    const sid = await session("1001", "user-staff");
    const res = await request(app).post("/accurate/api/sales-entry/list.do").set("X-Session-ID", sid);
    expect(res.body.s.status).toBe(true);
    expect(res.body.d.rows[0].total).toBe(2500000);
  });

  it("staff db 1001: customer ditolak (AllowView false di privilege staff)", async () => {
    const sid = await session("1001", "user-staff");
    const res = await request(app).post("/accurate/api/customer/list.do").set("X-Session-ID", sid);
    expect(res.body.s.status).toBe(false);
    expect(res.body.s.message).toMatch(/tidak punya akses modul customer/i);
  });

  it("user tanpa akses db → semua modul ditolak", async () => {
    const sid = await session("1002", "user-staff");
    const res = await request(app).post("/accurate/api/customer/list.do").set("X-Session-ID", sid);
    expect(res.body.s.status).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test — harus FAIL**

Run: `pnpm test`
Expected: FAIL — customer/list.do 404.

- [ ] **Step 3: Implement dua modul**

Create `mocks/accurate/src/modules/customer.ts`:

```ts
import { Router } from "express";
import { sessionGuard, envelope } from "../session.js";
import { getDb, privilegeOf } from "../store.js";

export const customerRouter = Router();

customerRouter.post("/list.do", sessionGuard, (req, res) => {
  const { dbId, userId } = req.mockCtx!;
  if (!privilegeOf(dbId, userId, "customer")?.AllowView) {
    return res.json(envelope(false, null, "Anda tidak punya akses modul customer"));
  }
  const rows = getDb(dbId)!.data.customers;
  res.json(envelope(true, { rows, total: rows.length }));
});
```

Create `mocks/accurate/src/modules/sales-entry.ts`:

```ts
import { Router } from "express";
import { sessionGuard, envelope } from "../session.js";
import { getDb, privilegeOf } from "../store.js";

export const salesEntryRouter = Router();

salesEntryRouter.post("/list.do", sessionGuard, (req, res) => {
  const { dbId, userId } = req.mockCtx!;
  if (!privilegeOf(dbId, userId, "sales-entry")?.AllowView) {
    return res.json(envelope(false, null, "Anda tidak punya akses modul sales-entry"));
  }
  const rows = getDb(dbId)!.data.salesEntries;
  res.json(envelope(true, { rows, total: rows.length }));
});
```

Modify `mocks/accurate/src/api-router.ts` — mount di dalam `apiRouter`:

```ts
import { customerRouter } from "./modules/customer.js";
import { salesEntryRouter } from "./modules/sales-entry.js";
apiRouter.use("/customer", customerRouter);
apiRouter.use("/sales-entry", salesEntryRouter);
```

- [ ] **Step 4: Jalankan test — harus PASS**

Run: `pnpm test`
Expected: PASS semua suite (store, oauth, db-session, access-privilege, modules, app).

- [ ] **Step 5: Commit**

```bash
git add mocks/accurate/src mocks/accurate/test/modules.test.ts
git commit -m "feat(mock-accurate): modul customer & sales-entry dengan proteksi AllowView + isolasi tenant"
```

---

### Task 8: Spike — Gemini native audio (Bahasa Indonesia)

**Files:**
- Create: `scripts/spike-gemini-audio.mjs`, `docs/spikes/2026-10-10-gemini-audio-findings.md`

- [ ] **Step 1: Konfirmasi model native audio terkini**

WebFetch `https://ai.google.dev/gemini-api/docs/audio` — catat ID model **native audio** yang didokumentasikan (mis. keluarga `gemini-2.5-flash-*-native-audio*`). Catat juga model flash biasa sebagai fallback TTS-out.

- [ ] **Step 2: Tulis skrip spike**

Create `scripts/spike-gemini-audio.mjs`:

```js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const KEY = env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY kosong di .env"); process.exit(1); }

// Isi dengan ID model hasil Step 1; fallback diuji berurutan.
const MODELS = process.argv[2] ? [process.argv[2]] : [
  "gemini-2.5-flash",
];

const PROMPTS = [
  "Sebutkan 3 pertanyaan akuntansi yang sering ditanyakan staf ke bagian keuangan.",
  "Jelaskan bedanya piutang dan hutang dalam satu kalimat sederhana.",
];

const outDir = new URL("../docs/spikes/samples/", import.meta.url);
mkdirSync(outDir, { recursive: true });

for (const model of MODELS) {
  for (const [i, prompt] of PROMPTS.entries()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["AUDIO"] },
    };
    const t0 = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    const json = await res.json();
    if (!res.ok) {
      console.log(`[${model}] #${i} GAGAL ${res.status}: ${json.error?.message ?? "?"}`);
      continue;
    }
    const part = json.candidates?.[0]?.content?.parts?.[0];
    const audio = part?.inlineData?.data;
    const text = part?.text;
    if (audio) {
      const ext = (part.inlineData.mimeType ?? "audio/wav").includes("mpeg") ? "mp3" : "wav";
      const file = new URL(`${model}-${i}.${ext}`, outDir);
      writeFileSync(file, Buffer.from(audio, "base64"));
      console.log(`[${model}] #${i} OK audio ${ms}ms → ${file.pathname}`);
    } else {
      console.log(`[${model}] #${i} respons TANPA audio (${ms}ms): ${JSON.stringify(text ?? part).slice(0, 200)}`);
    }
  }
}
```

- [ ] **Step 3: Jalankan spike**

Run: `node --env-file=.env scripts/spike-gemini-audio.mjs`
Expected: log per model/prompt — "OK audio" (file tersimpan di `docs/spikes/samples/`) atau "GAGAL/TANPA audio" dengan pesan error. Kalau semua gagal auth → berhenti, tanya pemilik apakah key valid (format key unik, perlu verifikasi).

- [ ] **Step 4: Tulis findings**

Create `docs/spikes/2026-10-10-gemini-audio-findings.md`:

```markdown
# Spike: Gemini Native Audio — Temuan (2026-10-10)

## Model yang berhasil
- ID model: ...
- Latensi rata-rata: ... ms

## Kualitas audio Bahasa Indonesia (catatan subjektif)
- Pengucapan angka/rupiah: ...
- Intonasi/jelas: ...

## Dampak ke keputusan produk
- Default voice engine (gemini-native vs web-speech): ...
- Kebutuhan untuk Phase 2 (streaming full-duplex vs sekali panggil): ...

## File samples
docs/spikes/samples/
```

- [ ] **Step 5: Commit**

```bash
git add scripts/spike-gemini-audio.mjs docs/spikes
git commit -m "docs(spike): eksperimen Gemini native audio Bahasa Indonesia"
```

---

### Task 9: Konsolidasi findings + README mock

**Files:**
- Create: `mocks/accurate/README.md`
- Modify: `docs/spikes/2026-10-10-accurate-api-findings.md`

- [ ] **Step 1: Lengkapi bagian "Keputusan untuk mock & Fase 1"**

Edit `docs/spikes/2026-10-10-accurate-api-findings.md` — pastikan bagian keputusan memuat:

```markdown
## Keputusan untuk mock & Fase 1
1. Kontrak mock (dipakai adapter Fase 1): envelope { s: { status, message? }, d };
   base path /accurate/api/{module}/{action}.do; session via header X-Session-ID.
2. Mock base URL: http://localhost:4010 (env MOCK_ACCURATE_URL di Fase 1).
3. Fixture: db 1001 "PT Maju Jaya" (admin+staff), db 1002 "CV Sejahtera" (admin saja);
   user demo: admin@demo.local (Administrator), staff@demo.local (Staff Penjualan).
4. Jika temuan API real berbeda dari kontrak mock: yang diterjemahkan adalah ADAPTER
   (AccurateAdapter) — mock tidak diubah agar test Fase 1 stabil.
5. Pemetaan user→privilege: dari session open-db; fallback bila API real tidak
   menyediakan per-user mapping → (isi setelah spike: <keputusan>).
```

- [ ] **Step 2: Tulis README mock**

Create `mocks/accurate/README.md`:

```markdown
# Mock Server Accurate Online

Server tiruan untuk pengembangan Fase 1–2 tanpa credential akun Accurate.

## Jalankan
pnpm install
pnpm test        # seluruh suite vitest
pnpm dev         # http://localhost:4010 (PORT env untuk ganti)

## Demo
- OAuth: GET /oauth/authorize?client_id=c&redirect_uri=http://localhost:3000/cb&state=s
  (tambah &user=staff untuk user staf) → code → POST /oauth/token
- GET /oauth/userinfo (Bearer)
- POST /api/db-list.do (Bearer) → db 1001 & 1002
- POST /api/open-db.do (Bearer, { dbId }) → { session, host }
- POST /accurate/api/{module}/{action}.do (X-Session-ID)

## User demo
| Email | Role mock | Akses modul (db 1001) |
|---|---|---|
| admin@demo.local | Administrator | semua modul view |
| staff@demo.local | Staff Penjualan | sales-entry view saja |

Kredensial OAuth di mock tidak diverifikasi (client_id/bebas) — mock hanya mensimulasikan alur.
```

- [ ] **Step 3: Final review — jalankan seluruh suite + smoke server**

Run (di `mocks/accurate/`): `pnpm test`
Expected: PASS semua suite.
Run: `pnpm start` lalu `curl -s http://localhost:4010/health` → `{"ok":true}` — lalu hentikan (Ctrl+C / kill).

- [ ] **Step 4: Commit**

```bash
git add docs/spikes mocks/accurate/README.md
git commit -m "docs(mock-accurate): konsolidasi keputusan Fase 1 + README"
```

---

## Selesai Fase 0

**Keluaran yang diharapkan:**
- Mock server Accurate lengkap & teruji (oauth, db, session, privilege, 2 modul read, isolasi tenant) di `mocks/accurate/`
- Temuan spike tertulis di `docs/spikes/` — termasuk daftar gap yang butuh akun developer CPSsoft (parameter launch, pemetaan per-user privilege, scope final)
- Keputusan terverifikasi untuk Gemini audio + rekomendasi default voice engine

**Langkah berikutnya:** review hasil spike bersama pemilik → jawaban untuk gap (atau keputusan fallback) → susun **plan Fase 1** (fondasi platform) di `docs/plans/`.


