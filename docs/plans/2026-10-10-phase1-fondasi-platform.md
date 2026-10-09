# Fase 1 — Fondasi Platform: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform multi-tenant siap pakai: monorepo web+api, Prisma+Neon, launch dari Accurate **tanpa login/register** (OAuth Accurate mock maupun asli), landing page, halaman Settings, dan interface `AccountingProvider` — pondasi untuk Fase 2 (AI chat) & 3 (Drive).

**Architecture:** pnpm workspaces — `apps/api` (Express 4 + TypeScript + Prisma), `apps/web` (React 18 + Vite + TypeScript), `packages/shared` (tipe bersama). Koneksi provider via OAuth Accurate (authorization code) dengan **AccurateAdapter** yang bisa menunjuk mock (`MOCK_ACCURATE_URL`) atau API asli (`ACCURATE_API_BASE`) lewat satu interface. Token dienkripsi AES-256-GCM at rest; session = cookie httpOnly acak yang validasinya ke tabel `Session`. Web dev memakai Vite proxy `/api` → API (tanpa CORS).

**Tech Stack:** Node 22, TypeScript strict, Express 4, Prisma 6 (Neon PG18), Vitest + supertest, React 18, Vite 6, pnpm workspaces.

**Environment (sudah ada di `.env` root):** `DATABASE_URL` (Neon), `ACCURATE_CLIENT_ID/SECRET`, `GEMINI_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`. **Belum ada:** `GOOGLE_OAUTH_CLIENT_SECRET` (task Google menunggu), `TOKEN_ENC_KEY` (dibuat di Task 3). Port API `3001`, web dev `5173`, mock Accurate `4010`.

**Prasyarat manual pemilik (sekali saja, saat Task 6 diuji ke API asli):** daftarkan redirect URI `http://localhost:3001/api/oauth/accurate/callback` di `account.accurate.id/developer` untuk client id di `.env`. Task 6 diuji ke **mock** dulu; uji asli opsional di akhir task.

---

## File Structure

```
pnpm-workspace.yaml             — workspace: apps/*, packages/*, mocks/*
package.json                    — root: script dev/test/bereksekusi lint type
packages/shared/
  package.json                  — name @aigoogle/shared, exports src/index.ts
  src/index.ts                  — tipe: Me, ConnectionInfo, AppSettings, dsb.
apps/api/
  package.json, tsconfig.json, vitest.config.ts
  prisma/schema.prisma          — Tenant, User, Role, RolePermission, Connection, Session, AppSetting
  src/
    env.ts                      — load & validasi env (throw jelas bila kurang)
    crypto.ts                   — encryptToken/decryptToken (AES-256-GCM)
    db.ts                       — singleton PrismaClient
    app.ts                      — createApp(): wire express + routes
    index.ts                    — listen (PORT)
    middleware/session.ts       — baca cookie sid → req.user (atau null)
    routes/health.ts            — GET /api/health
    routes/launch.ts            — GET /api/launch, GET /api/oauth/accurate/callback
    routes/me.ts                — GET /api/me, POST /api/logout
    routes/settings.ts          — GET /api/settings, PUT /api/settings
    routes/connections.ts       — GET /api/connections
    providers/accounting/types.ts     — AccountingProvider interface + tipe
    providers/accounting/accurate.ts  — AccurateAdapter (mock/real via env)
  test/
    crypto.test.ts, session.test.ts, oauth-launch.test.ts, settings.test.ts
    helpers/mock.ts             — start mock Accurate in-process, seed prisma test
apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/
    main.tsx, App.tsx           — router: / landing, /app shell, /settings
    api.ts                      — fetch wrapper (credentials: include)
    pages/Landing.tsx           — halaman info (bukan dari provider)
    pages/Shell.tsx             — placeholder app (chat & file manager menyusul)
    pages/Settings.tsx          — status koneksi + voice engine
mocks/accurate/package.json     — tambah "exports": "./src/server.ts" (cross-import di test)
```

---

## Task Outline

### Task 1: Scaffold monorepo (workspace, api, web, shared) + health
### Task 2: Prisma schema multi-tenant + migrasi ke Neon
### Task 3: Crypto token (AES-256-GCM) + TOKEN_ENC_KEY
### Task 4: Session middleware (cookie sid) + /api/me + logout
### Task 5: AccountingProvider interface + AccurateAdapter (envelope real, mock/real switch)
### Task 6: Rute launch & callback OAuth Accurate (upsert tenant/user/connection)
### Task 7: Rute settings & connections (API)
### Task 8: Web scaffold (Vite React) + routing + Landing + Shell
### Task 9: Halaman Settings (UI) + tombol connect Accurate
### Task 10: Integrasi mock e2e lokal (mock :4010 + api + web) + verifikasi manual
### Task 11: Skeleton Google OAuth (route + tombol; secret menunggu)
### Task 12: Konsolidasi: README dev, root scripts, verifikasi akhir

---

<!-- TASKS -->

### Task 1: Scaffold monorepo (workspace, api, web, shared) + health

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json` (root), `packages/shared/package.json`, `packages/shared/src/index.ts`, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/test/health.test.ts`, `apps/web/` (minimal dulu: package.json)

- [ ] **Step 1: Buat workspace root**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "mocks/*"
```

Create `package.json` root:

```json
{
  "name": "aigoogle",
  "private": true,
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 2: Buat packages/shared (tipikal, kosong dulu)**

Create `packages/shared/package.json`:

```json
{
  "name": "@aigoogle/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

Create `packages/shared/src/index.ts`:

```ts
export interface Me {
  userId: string;
  email: string;
  name: string;
  tenant: { id: string; name: string; alias: string; provider: string };
  roleKey: string;
}
export interface ConnectionInfo {
  provider: string;
  status: "connected" | "expired" | "none";
  accountLabel?: string;
  expiresAt?: string;
}
export interface AppSettings {
  voiceEngine: "gemini-native" | "web-speech";
}
```

- [ ] **Step 3: Buat apps/api (skeleton + health)**

Create `apps/api/package.json`:

```json
{
  "name": "@aigoogle/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aigoogle/shared": "workspace:*",
    "@prisma/client": "^6.2.0",
    "cookie-parser": "^1.4.7",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^6.2.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `apps/api/tsconfig.json`:

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
  "include": ["src", "test", "prisma"]
}
```

Create `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", fileParallelism: false } });
```

Create `apps/api/src/env.ts`:

```ts
import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  TOKEN_ENC_KEY: z.string().regex(/^[0-9a-f]{64}$/, "TOKEN_ENC_KEY = 64 hex (32 byte)"),
  ACCURATE_CLIENT_ID: z.string().min(1),
  ACCURATE_CLIENT_SECRET: z.string().min(1),
  ACCURATE_API_BASE: z.string().default("https://account.accurate.id"),
  MOCK_ACCURATE_URL: z.string().default(""),
  APP_ORIGIN: z.string().default("http://localhost:5173"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
});
export const env = Env.parse(process.env);
```

Create `apps/api/src/app.ts`:

```ts
import express from "express";
import cookieParser from "cookie-parser";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  return app;
}
```

Create `apps/api/src/index.ts`:

```ts
import { env } from "./env.js";
import { createApp } from "./app.js";

createApp().listen(env.PORT, () => {
  console.log(`api :${env.PORT}`);
});
```

Create `apps/api/test/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("api health", () => {
  it("GET /api/health → { ok: true }", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 4: Buat apps/web minimal**

Create `apps/web/package.json`:

```json
{
  "name": "@aigoogle/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aigoogle/shared": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.5"
  }
}
```

- [ ] **Step 5: Install semua workspace**

Run: `pnpm install` (di root)
Expected: `Done`, tanpa error.

- [ ] **Step 6: Test API — FAIL lalu PASS**

Jalankan `pnpm test` (di `apps/api/`) → FAIL (env.ts belum bisa parse DATABASE_URL saat import app? — health test belum import env; app.ts murni). Kalau PASS langsung: lanjut. Kalau gagal import path, perbaiki.

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml package.json packages apps
git commit -m "feat(fase1): scaffold monorepo workspace + api health"
```

---

### Task 2: Prisma schema multi-tenant + migrasi ke Neon

**Files:**
- Create: `apps/api/prisma/schema.prisma`, `apps/api/src/db.ts`

- [ ] **Step 1: Tulis schema**

Create `apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id           String       @id @default(cuid())
  provider     String       // "accurate" | "mekari" | "paper"
  providerDbId String       // id data usaha di provider
  name         String
  alias        String
  createdAt    DateTime     @default(now())
  users        User[]
  connections  Connection[]
  roles        Role[]
  @@unique([provider, providerDbId])
}

model Role {
  id          String           @id @default(cuid())
  tenant      Tenant           @relation(fields: [tenantId], references: [id])
  tenantId    String
  key         String           // "admin" | "staff" | custom
  name        String
  permissions RolePermission[]
  users       User[]
  @@unique([tenantId, key])
}

model RolePermission {
  id            String @id @default(cuid())
  role          Role   @relation(fields: [roleId], references: [id], onDelete: Cascade)
  roleId        String
  permissionKey String // "accurate:customer:view" | "app:drive.tidy" | ...
  @@unique([roleId, permissionKey])
}

model User {
  id             String   @id @default(cuid())
  tenant         Tenant   @relation(fields: [tenantId], references: [id])
  tenantId       String
  providerUserId String   // id dari OAuth user info
  email          String
  name           String
  role           Role     @relation(fields: [roleId], references: [id])
  roleId         String
  createdAt      DateTime @default(now())
  sessions       Session[]
  @@unique([tenantId, providerUserId])
}

model Connection {
  id             String    @id @default(cuid())
  tenant         Tenant    @relation(fields: [tenantId], references: [id])
  tenantId       String
  provider       String
  accessTokenEnc String
  refreshTokenEnc String
  expiresAt      DateTime
  host           String    @default("") // host module Accurate (dari open-db)
  status         String    @default("connected")
  updatedAt      DateTime  @updatedAt
  @@unique([tenantId, provider])
}

model Session {
  id        String   @id // sid acak 32 byte hex
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model AppSetting {
  key   String @id
  value String
}
```

- [ ] **Step 2: Migrate ke Neon**

Run (di `apps/api/`): `pnpm exec prisma migrate dev --name init`
Expected: `Your database is now in sync with your Prisma schema` — tabel terbentuk di Neon.

- [ ] **Step 3: Buat db.ts singleton**

Create `apps/api/src/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck` (di `apps/api/`)
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma apps/api/src/db.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(fase1): skema prisma multi-tenant + migrasi Neon"
```

<!-- TASKS-CONTINUE -->

### Task 3: Crypto token (AES-256-GCM) + TOKEN_ENC_KEY

**Files:**
- Create: `apps/api/src/crypto.ts`, `apps/api/test/crypto.test.ts`
- Modify: `.env` ( tambah TOKEN_ENC_KEY )

- [ ] **Step 1: Generate key & simpan**

Run: `echo "TOKEN_ENC_KEY=$(openssl rand -hex 32)" >> /root/aigoogle/.env`
Expected: baris baru di `.env`. (Key dev — produksi pakai secret manager/Vercel env.)

- [ ] **Step 2: Tulis failing test**

Create `apps/api/test/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "../src/crypto.js";

describe("crypto token", () => {
  it("enkripsi → dekripsi bulat; teks asli tidak muncul di ciphertext", () => {
    const plain = "tok-RAHASIA-123";
    const enc = encryptToken(plain);
    expect(enc).not.toContain("RAHASIA");
    expect(decryptToken(enc)).toBe(plain);
  });

  it("nonce berbeda tiap panggilan (ciphertext berbeda untuk plaintext sama)", () => {
    expect(encryptToken("sama")).not.toBe(encryptToken("sama"));
  });

  it("ciphertext rusak → throw", () => {
    expect(() => decryptToken("aqQ=".repeat(8))).toThrow();
  });
});
```

- [ ] **Step 3: Jalankan — harus FAIL**

Run: `pnpm test` (di `apps/api/`)
Expected: FAIL — crypto.js belum ada.

- [ ] **Step 4: Implement**

Create `apps/api/src/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env.js";

const KEY = Buffer.from(env.TOKEN_ENC_KEY, "hex");

export function encryptToken(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, nonce);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [nonce, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(payload: string): string {
  const [nonce, tag, enc] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", KEY, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
```

Catatan: test memuat `env.ts` → pastikan test dijalankan dengan `.env` termuat. Tambahkan di `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: loadEnv("", "/root/aigoogle", ""),
  },
});
```

(Tambah `vite` ke devDependencies api bila belum ada — dipakai loadEnv.)

- [ ] **Step 5: Jalankan — harus PASS**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/crypto.ts apps/api/test/crypto.test.ts apps/api/vitest.config.ts .env
git commit -m "feat(fase1): enkripsi token AES-256-GCM + TOKEN_ENC_KEY"
```

---

### Task 4: Session middleware (cookie sid) + /api/me + logout

**Files:**
- Create: `apps/api/src/middleware/session.ts`, `apps/api/src/routes/me.ts`, `apps/api/test/session.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Tulis failing test**

Create `apps/api/test/session.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let app: ReturnType<typeof createApp>;
let cookie = "";

beforeAll(async () => {
  app = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: "t-1", name: "PT Uji", alias: "UJI" },
  });
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: "admin", name: "Admin" },
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: "u-1", email: "uji@demo.local", name: "Uji", roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) },
  });
  cookie = `sid=${sid}`;
});

describe("session & /api/me", () => {
  it("/api/me tanpa cookie → 401", async () => {
    expect((await request(app).get("/api/me")).status).toBe(401);
  });

  it("/api/me dengan cookie valid → profil user + tenant", async () => {
    const res = await request(app).get("/api/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: "uji@demo.local",
      roleKey: "admin",
      tenant: { alias: "UJI", provider: "accurate" },
    });
  });

  it("POST /api/logout menghapus session; cookie lama jadi 401", async () => {
    const out = await request(app).post("/api/logout").set("Cookie", cookie);
    expect(out.status).toBe(200);
    expect((await request(app).get("/api/me").set("Cookie", cookie)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Jalankan — harus FAIL**

Run: `pnpm test`
Expected: FAIL — route /api/me 404.

- [ ] **Step 3: Implement middleware + rute**

Create `apps/api/src/middleware/session.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string; roleKey: string; tenant: { id: string; name: string; alias: string; provider: string } };
    }
  }
}

export function loadSession(req: Request, res: Response, next: NextFunction) {
  const sid = req.cookies?.sid as string | undefined;
  if (!sid) return next();
  void (async () => {
    const s = await prisma.session.findUnique({
      where: { id: sid },
      include: { user: { include: { role: true, tenant: true } } },
    });
    if (s && s.expiresAt > new Date()) {
      req.user = {
        id: s.user.id,
        email: s.user.email,
        name: s.user.name,
        roleKey: s.user.role.key,
        tenant: {
          id: s.user.tenant.id,
          name: s.user.tenant.name,
          alias: s.user.tenant.alias,
          provider: s.user.tenant.provider,
        },
      };
    }
    next();
  })().catch(next);
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "belum_login" });
  next();
}
```

Create `apps/api/src/routes/me.ts`:

```ts
import { Router } from "express";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";

export const meRouter = Router();

meRouter.get("/me", requireUser, (req, res) => {
  res.json(req.user);
});

meRouter.post("/logout", async (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) await prisma.session.deleteMany({ where: { id: sid } });
  res.clearCookie("sid").json({ ok: true });
});
```

Modify `apps/api/src/app.ts`:

```ts
import express from "express";
import cookieParser from "cookie-parser";
import { loadSession } from "./middleware/session.js";
import { meRouter } from "./routes/me.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(loadSession);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", meRouter);
  return app;
}
```

- [ ] **Step 4: Jalankan — harus PASS**

Run: `pnpm test`
Expected: PASS semua (health + crypto + session). **Bila test session minta DB kosong/gangguan antar test:** jalankan dengan urutan file; beforeAll membuat data unik (providerDbId "t-1") — bila bentrok unique saat run ulang, ganti dengan `randomBytes(4).toString("hex")` untuk providerDbId.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test/session.test.ts apps/api/src/app.ts
git commit -m "feat(fase1): session cookie sid + /api/me + logout"
```

---

### Task 5: AccountingProvider interface + AccurateAdapter

**Files:**
- Create: `apps/api/src/providers/accounting/types.ts`, `apps/api/src/providers/accounting/accurate.ts`, `apps/api/test/accurate-adapter.test.ts`
- Modify: `mocks/accurate/package.json` (exports)

- [ ] **Step 1: Expose mock sebagai paket workspace**

Modify `mocks/accurate/package.json` — tambah:

```json
"exports": { ".": "./src/server.ts" }
```

- [ ] **Step 2: Tulis interface**

Create `apps/api/src/providers/accounting/types.ts`:

```ts
export interface ProviderTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}
export interface ProviderUser {
  providerUserId: string;
  email: string;
  name: string;
}
export interface ProviderDb {
  providerDbId: string;
  alias: string;
  name: string;
  admin: boolean;
}
export interface OpenDbResult {
  session: string;
  host: string;
}
export interface AccountingProvider {
  id: "accurate";
  authorizeUrl(opts: { redirectUri: string; state: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<ProviderTokenSet>;
  fetchUser(accessToken: string): Promise<ProviderUser>;
  listDbs(accessToken: string): Promise<ProviderDb[]>;
  openDb(accessToken: string, providerDbId: string): Promise<OpenDbResult>;
}
```

- [ ] **Step 3: Tulis failing test adapter (ke mock in-process)**

Create `apps/api/test/accurate-adapter.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp as createMockApp } from "@mock/accurate";
import { AccurateAdapter } from "../src/providers/accounting/accurate.js";

let server: Server;
let base: string;
let adapter: AccurateAdapter;

beforeAll(async () => {
  server = createMockApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  adapter = new AccurateAdapter({
    clientId: "c",
    clientSecret: "s",
    apiBase: base, // account API dasar → mock
  });
});
afterAll(() => server.close());

async function loginMock(user?: string) {
  const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
  if (user) url.searchParams.set("user", user);
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  return adapter.exchangeCode(code, "http://x/cb");
}

describe("AccurateAdapter against mock", () => {
  it("authorizeUrl menunjuk /oauth/authorize dengan client_id & state", () => {
    const u = new URL(adapter.authorizeUrl({ redirectUri: "http://cb", state: "xyz" }));
    expect(u.pathname).toBe("/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("c");
    expect(u.searchParams.get("state")).toBe("xyz");
  });

  it("exchange → fetchUser (admin) → listDbs (2 db) → openDb", async () => {
    const tok = await loginMock();
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const user = await adapter.fetchUser(tok.accessToken);
    expect(user).toMatchObject({ email: "admin@demo.local" });
    const dbs = await adapter.listDbs(tok.accessToken);
    expect(dbs.map((d) => d.providerDbId)).toEqual(["1001", "1002"]);
    const open = await adapter.openDb(tok.accessToken, "1001");
    expect(open.session).toMatch(/^sess-/);
    expect(open.host).toBe(base);
  });
});
```

- [ ] **Step 4: Jalankan — harus FAIL**

Run: `pnpm test` (di `apps/api/`)
Expected: FAIL — accurate.js belum ada.

- [ ] **Step 5: Implement adapter**

Create `apps/api/src/providers/accounting/accurate.ts`:

```ts
import type {
  AccountingProvider, OpenDbResult, ProviderDb, ProviderTokenSet, ProviderUser,
} from "./types.js";

interface Envelope<T> {
  s: boolean;
  d: T;
  session?: string;
  host?: string;
  admin?: boolean;
}

export class AccurateAdapter implements AccountingProvider {
  id = "accurate" as const;
  constructor(private cfg: { clientId: string; clientSecret: string; apiBase: string }) {}

  authorizeUrl(opts: { redirectUri: string; state: string }): string {
    const u = new URL(`${this.cfg.apiBase}/oauth/authorize`);
    u.searchParams.set("client_id", this.cfg.clientId);
    u.searchParams.set("redirect_uri", opts.redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", opts.state);
    return u.toString();
  }

  private async tokenRequest(params: Record<string, string>): Promise<ProviderTokenSet> {
    const res = await fetch(`${this.cfg.apiBase}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        ...params,
      }),
    });
    if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: new Date(Date.now() + j.expires_in * 1000),
    };
  }

  exchangeCode(code: string, redirectUri: string): Promise<ProviderTokenSet> {
    return this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  }

  private async getEnvelope<T>(path: string, accessToken: string): Promise<Envelope<T>> {
    const res = await fetch(`${this.cfg.apiBase}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new Error("token ditolak provider (401)");
    const j = (await res.json()) as Envelope<T>;
    if (!j.s) throw new Error(`provider gagal: ${JSON.stringify(j.d)}`);
    return j;
  }

  async fetchUser(accessToken: string): Promise<ProviderUser> {
    const j = await this.getEnvelope<{ id: string; email: string; name: string }>("/api/userinfo.do", accessToken);
    return { providerUserId: j.d.id, email: j.d.email, name: j.d.name };
  }

  async listDbs(accessToken: string): Promise<ProviderDb[]> {
    const j = await this.getEnvelope<
      { id: number; alias: string; name: string; admin: boolean }[]
    >("/api/db-list.do", accessToken);
    return j.d.map((r) => ({ providerDbId: String(r.id), alias: r.alias, name: r.name ?? r.alias, admin: r.admin }));
  }

  async openDb(accessToken: string, providerDbId: string): Promise<OpenDbResult> {
    const j = await this.getEnvelope<unknown>(`/api/open-db.do?id=${encodeURIComponent(providerDbId)}`, accessToken);
    if (!j.session || !j.host) throw new Error("open-db tidak mengembalikan session/host");
    return { session: j.session, host: j.host };
  }
}
```

- [ ] **Step 6: Jalankan — harus PASS**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/providers apps/api/test/accurate-adapter.test.ts mocks/accurate/package.json
git commit -m "feat(fase1): interface AccountingProvider + AccurateAdapter (mock/real)"
```

---

### Task 6: Rute launch & callback OAuth Accurate

**Files:**
- Create: `apps/api/src/routes/launch.ts`, `apps/api/src/providers/accounting/index.ts`, `apps/api/test/oauth-launch.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Factory adapter (mock vs real via env)**

Create `apps/api/src/providers/accounting/index.ts`:

```ts
import { env } from "../../env.js";
import { AccurateAdapter } from "./accurate.js";
import type { AccountingProvider } from "./types.js";

export function accurateProvider(): AccountingProvider {
  return new AccurateAdapter({
    clientId: env.ACCURATE_CLIENT_ID,
    clientSecret: env.ACCURATE_CLIENT_SECRET,
    apiBase: env.MOCK_ACCURATE_URL || env.ACCURATE_API_BASE,
  });
}

export const OAUTH_REDIRECT_URI = "http://localhost:3001/api/oauth/accurate/callback";
```

- [ ] **Step 2: Tulis failing test launch flow (mock)**

Create `apps/api/test/oauth-launch.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let mockBase: string;

beforeAll(async () => {
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  mockBase = `http://127.0.0.1:${mockSrv.address().port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
});
afterAll(() => mockSrv.close());

describe("launch & callback", () => {
  it("GET /api/launch → 302 ke authorize mock dengan state", async () => {
    const res = await request(api).get("/api/launch?dbId=1001").redirects(0);
    expect(res.status).toBe(302);
    const u = new URL(res.headers.location);
    expect(u.origin + u.pathname).toBe(`${mockBase}/oauth/authorize`);
    expect(u.searchParams.get("state")).toMatch(/^ls-/);
  });

  it("callback penuh: code → session cookie → /api/me + tenant & connection tersimpan, tanpa duplikasi", async () => {
    const launch = await request(api).get("/api/launch?dbId=1001").redirects(0);
    const state = new URL(launch.headers.location).searchParams.get("state")!;
    const cbUrl = encodeURIComponent("http://localhost:3001/api/oauth/accurate/callback");
    const au = await fetch(`${mockBase}/oauth/authorize?client_id=c&redirect_uri=${cbUrl}&state=${state}&user=admin`, { redirect: "manual" });
    const code = new URL(au.headers.get("location")!).searchParams.get("code")!;
    const cb = await request(api).get(`/api/oauth/accurate/callback?code=${code}&state=${state}`).redirects(0);
    expect(cb.status).toBe(302);
    const sid = /sid=([^;]+)/.exec((cb.headers["set-cookie"] ?? []).join(";"))?.[1];
    expect(sid).toBeTruthy();
    const me = await request(api).get("/api/me").set("Cookie", `sid=${sid}`);
    expect(me.status).toBe(200);
    expect(me.body.tenant.provider).toBe("accurate");
    const tenant = await prisma.tenant.findFirst({ where: { providerDbId: "1001" } });
    expect(tenant).toBeTruthy();
    expect(await prisma.connection.count({ where: { tenantId: tenant!.id, provider: "accurate" } })).toBe(1);
    const au2 = await fetch(`${mockBase}/oauth/authorize?client_id=c&redirect_uri=${cbUrl}&state=${state}&user=admin`, { redirect: "manual" });
    const code2 = new URL(au2.headers.get("location")!).searchParams.get("code")!;
    await request(api).get(`/api/oauth/accurate/callback?code=${code2}&state=${state}`).redirects(0);
    expect(await prisma.tenant.count({ where: { providerDbId: "1001" } })).toBe(1);
    expect(await prisma.user.count({ where: { email: "admin@demo.local" } })).toBe(1);
  });

  it("state tidak dikenal → redirect error", async () => {
    const res = await request(api).get("/api/oauth/accurate/callback?code=x&state=unknown").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error");
  });
});
```

- [ ] **Step 3: Jalankan — harus FAIL**

Run: `pnpm test`
Expected: FAIL — rute launch belum ada.

- [ ] **Step 4: Implement launch + callback**

Create `apps/api/src/routes/launch.ts`:

```ts
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { encryptToken } from "../crypto.js";
import { accurateProvider, OAUTH_REDIRECT_URI } from "../providers/accounting/index.js";

export const launchRouter = Router();

// state sementara in-memory (dev; produksi: tabel/signed state)
const pending = new Map<string, { dbId?: string; exp: number }>();

launchRouter.get("/launch", (req, res) => {
  const q = z.object({ dbId: z.string().optional(), user: z.string().optional() }).parse(req.query);
  const state = `ls-${randomBytes(16).toString("hex")}`;
  pending.set(state, { dbId: q.dbId, exp: Date.now() + 600_000 });
  const url = new URL(accurateProvider().authorizeUrl({ redirectUri: OAUTH_REDIRECT_URI, state }));
  if (q.user) url.searchParams.set("user", q.user); // mock only
  res.redirect(url.toString());
});

launchRouter.get("/oauth/accurate/callback", async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    const st = pending.get(state);
    pending.delete(state);
    if (!st || st.exp < Date.now()) return res.redirect(`${env.APP_ORIGIN}/?error=state`);
    const provider = accurateProvider();
    const tok = await provider.exchangeCode(code, OAUTH_REDIRECT_URI);
    const pUser = await provider.fetchUser(tok.accessToken);
    const dbs = await provider.listDbs(tok.accessToken);
    const db = (st.dbId ? dbs.find((d) => d.providerDbId === st.dbId) : dbs[0]) ?? dbs[0];
    if (!db) return res.redirect(`${env.APP_ORIGIN}/?error=nodb`);

    const tenant = await prisma.tenant.upsert({
      where: { provider_providerDbId: { provider: "accurate", providerDbId: db.providerDbId } },
      create: { provider: "accurate", providerDbId: db.providerDbId, name: db.name, alias: db.alias },
      update: {},
    });
    const roleKey = db.admin ? "admin" : "staff";
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: roleKey } },
      create: { tenantId: tenant.id, key: roleKey, name: db.admin ? "Administrator" : "Staff" },
      update: {},
    });
    if (db.admin) {
      await prisma.rolePermission.createMany({
        data: ["app:users.manage", "app:settings.manage", "app:drive.tidy", "app:chat.history"].map(
          (permissionKey) => ({ roleId: role.id, permissionKey })
        ),
        skipDuplicates: true,
      });
    }
    const user = await prisma.user.upsert({
      where: { tenantId_providerUserId: { tenantId: tenant.id, providerUserId: pUser.providerUserId } },
      create: { tenantId: tenant.id, providerUserId: pUser.providerUserId, email: pUser.email, name: pUser.name, roleId: role.id },
      update: { roleId: role.id },
    });
    await prisma.connection.upsert({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "accurate" } },
      create: {
        tenantId: tenant.id, provider: "accurate",
        accessTokenEnc: encryptToken(tok.accessToken), refreshTokenEnc: encryptToken(tok.refreshToken),
        expiresAt: tok.expiresAt,
      },
      update: {
        accessTokenEnc: encryptToken(tok.accessToken), refreshTokenEnc: encryptToken(tok.refreshToken),
        expiresAt: tok.expiresAt, status: "connected",
      },
    });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
    res.redirect(`${env.APP_ORIGIN}/app`);
  } catch (e) {
    next(e);
  }
});
```

Modify `apps/api/src/app.ts` — tambah `app.use("/api", launchRouter);`

- [ ] **Step 5: Jalankan — harus PASS**

Run: `pnpm test`
Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test/oauth-launch.test.ts
git commit -m "feat(fase1): launch + callback OAuth Accurate (upsert tenant/user/connection)"
```

---

### Task 7: Rute settings & connections (API)

**Files:**
- Create: `apps/api/src/routes/settings.ts`, `apps/api/test/settings.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Tulis failing test**

Create `apps/api/test/settings.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let cookie = "";

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `s-${randomBytes(3).toString("hex")}`, name: "PT Set", alias: "SET" },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `su-${randomBytes(3).toString("hex")}`, email: "set@demo.local", name: "Set", roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
});

describe("settings & connections", () => {
  it("GET /api/settings tanpa login → 401", async () => {
    expect((await request(api).get("/api/settings")).status).toBe(401);
  });

  it("GET default voiceEngine = web-speech; PUT mengubah; GET ulang konsisten", async () => {
    const g1 = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g1.body).toEqual({ voiceEngine: "web-speech" });
    const put = await request(api).put("/api/settings").set("Cookie", cookie).send({ voiceEngine: "gemini-native" });
    expect(put.status).toBe(200);
    const g2 = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g2.body.voiceEngine).toBe("gemini-native");
  });

  it("PUT voiceEngine ngawur → 400", async () => {
    const res = await request(api).put("/api/settings").set("Cookie", cookie).send({ voiceEngine: "asal" });
    expect(res.status).toBe(400);
  });

  it("GET /api/connections → mengandung accurate connected", async () => {
    const res = await request(api).get("/api/connections").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual(expect.objectContaining({ provider: "accurate", status: "connected" }));
  });
});
```

- [ ] **Step 2: Jalankan — harus FAIL**

Run: `pnpm test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/api/src/routes/settings.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import type { AppSettings } from "@aigoogle/shared";

export const settingsRouter = Router();

const PutBody = z.object({ voiceEngine: z.enum(["gemini-native", "web-speech"]) });

settingsRouter.get("/settings", requireUser, async (_req, res) => {
  const row = await prisma.appSetting.findUnique({ where: { key: "voiceEngine" } });
  res.json({ voiceEngine: row?.value ?? "web-speech" });
});

settingsRouter.put("/settings", requireUser, async (req, res) => {
  const body = PutBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "bad_request" });
  await prisma.appSetting.upsert({
    where: { key: "voiceEngine" },
    create: { key: "voiceEngine", value: body.data.voiceEngine },
    update: { value: body.data.voiceEngine },
  });
  res.json(body.data);
});

settingsRouter.get("/connections", requireUser, async (req, res) => {
  const conns = await prisma.connection.findMany({ where: { tenantId: req.user!.tenant.id } });
  const accurate = conns.find((c) => c.provider === "accurate");
  res.json([
    {
      provider: "accurate",
      status: accurate ? (accurate.expiresAt < new Date() ? "expired" : accurate.status) : "none",
      accountLabel: req.user!.tenant.alias,
      expiresAt: accurate?.expiresAt.toISOString(),
    },
    { provider: "google", status: "none" },
  ]);
});
```

Modify `apps/api/src/app.ts` — tambah `app.use("/api", settingsRouter);`

- [ ] **Step 4: Jalankan — harus PASS**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test/settings.test.ts
git commit -m "feat(fase1): rute settings (voice engine) & connections"
```

---

### Task 8: Web scaffold (Vite React) + routing + Landing + Shell

**Files:**
- Create: `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/pages/Landing.tsx`, `apps/web/src/pages/Shell.tsx`, `apps/web/src/pages/Settings.tsx` (placeholder)

- [ ] **Step 1: Konfigurasi Vite + proxy**

Create `apps/web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
});
```

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Google — Add-on AI Accurate</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: API client + halaman**

Create `apps/web/src/api.ts`:

```ts
import type { Me } from "@aigoogle/shared";

export async function getMe(): Promise<Me | null> {
  const res = await fetch("/api/me");
  if (!res.ok) return null;
  return res.json();
}
```

Create `apps/web/src/pages/Landing.tsx`:

```tsx
export function Landing() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 560, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 650 }}>AI Google untuk Accurate Online</h1>
      <p style={{ lineHeight: 1.6, color: "#444" }}>
        Add-on ini dipakai langsung dari <strong>Accurate</strong>. Buka dari menu add-on di
        Accurate Anda — tanpa login terpisah.
      </p>
      <a href="https://account.accurate.id" style={{ color: "#3d6b54" }}>Buka Accurate →</a>
    </main>
  );
}
```

Create `apps/web/src/pages/Shell.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";

export function Shell() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { void getMe().then(setMe); }, []);
  if (me === undefined) return <p style={{ padding: 24 }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/";
    return null;
  }
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "48px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>{me.tenant.name}</h1>
      <p style={{ color: "#555" }}>
        Halo, {me.name} ({me.roleKey}). Chat AI &amp; Explore Manager menyusul di fase berikutnya.
      </p>
      <a href="/settings" style={{ color: "#3d6b54" }}>Pengaturan →</a>
    </main>
  );
}
```

Create `apps/web/src/pages/Settings.tsx` (placeholder; UI lengkap di Task 9):

```tsx
export function Settings() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Pengaturan</h1>
    </main>
  );
}
```

Create `apps/web/src/App.tsx`:

```tsx
import { Landing } from "./pages/Landing";
import { Shell } from "./pages/Shell";
import { Settings } from "./pages/Settings";

export function App() {
  const path = window.location.pathname;
  if (path === "/settings") return <Settings />;
  if (path === "/app") return <Shell />;
  return <Landing />;
}
```

Create `apps/web/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 3: Install & verifikasi build**

Run: `pnpm install` (root) lalu `pnpm build` (di `apps/web/`)
Expected: `✓ built` tanpa error.

- [ ] **Step 4: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(fase1): web scaffold vite react + landing + shell"
```

---

### Task 9: Halaman Settings (UI) + tombol connect Accurate

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`, `apps/web/src/api.ts`

- [ ] **Step 1: Extend api.ts**

Tambah ke `apps/web/src/api.ts`:

```ts
import type { AppSettings, ConnectionInfo } from "@aigoogle/shared";

export async function getSettings(): Promise<AppSettings> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("gagal memuat pengaturan");
  return res.json();
}

export async function putSettings(body: AppSettings): Promise<AppSettings> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("gagal menyimpan pengaturan");
  return res.json();
}

export async function getConnections(): Promise<ConnectionInfo[]> {
  const res = await fetch("/api/connections");
  if (!res.ok) return [];
  return res.json();
}
```

- [ ] **Step 2: Implement Settings UI**

Replace `apps/web/src/pages/Settings.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { AppSettings, ConnectionInfo } from "@aigoogle/shared";
import { getConnections, getMe, getSettings, putSettings } from "../api";

const card: React.CSSProperties = {
  border: "1px solid #e3ddd4", borderRadius: 6, padding: 16, marginBottom: 12,
  background: "#faf8f5", fontFamily: "system-ui",
};
const btn: React.CSSProperties = {
  border: "none", borderRadius: 4, padding: "8px 14px", cursor: "pointer",
  background: "#3d6b54", color: "white", fontSize: 14,
};

export function Settings() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>>>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getMe().then(setMe);
    void getSettings().then(setSettings);
    void getConnections().then(setConns);
  }, []);

  if (!me || !settings) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Memuat…</p>;

  const accurate = conns.find((c) => c.provider === "accurate");
  const google = conns.find((c) => c.provider === "google");

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Pengaturan</h1>
      <p style={{ color: "#666" }}>{me.tenant.name} · {me.email}</p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Koneksi</h2>
      <div style={card}>
        <strong>Accurate Online</strong>
        <p style={{ color: "#666", fontSize: 14 }}>
          Status: {accurate?.status === "connected" ? `terhubung (${accurate.accountLabel})` : accurate?.status ?? "none"}
        </p>
        {accurate?.status !== "connected" && (
          <a href="/api/launch"><button style={btn}>Hubungkan Accurate</button></a>
        )}
      </div>
      <div style={card}>
        <strong>Google Drive</strong>
        <p style={{ color: "#666", fontSize: 14 }}>
          Status: {google?.status ?? "none"} — menyusul (butuh client secret Google)
        </p>
        <button style={{ ...btn, background: "#9a9a9a" }} disabled>Hubungkan Google (segera)</button>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Suara</h2>
      <div style={card}>
        <label style={{ display: "block", marginBottom: 8 }}>
          <input
            type="radio" name="voice" checked={settings.voiceEngine === "web-speech"}
            onChange={() => setSettings({ ...settings, voiceEngine: "web-speech" })}
          />{" "}
          Browser (Web Speech) — ringan
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <input
            type="radio" name="voice" checked={settings.voiceEngine === "gemini-native"}
            onChange={() => setSettings({ ...settings, voiceEngine: "gemini-native" })}
          />{" "}
          Gemini native audio — kualitas terbaik
        </label>
        <button
          style={btn}
          onClick={() => { void putSettings(settings).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }); }}
        >
          {saved ? "Tersimpan ✓" : "Simpan"}
        </button>
      </div>
      <a href="/app" style={{ color: "#3d6b54", fontSize: 14 }}>← Kembali</a>
    </main>
  );
}
```

- [ ] **Step 3: Build**

Run: `pnpm build` (di `apps/web/`)
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "feat(fase1): halaman settings (koneksi + voice engine)"
```

---

### Task 10: Integrasi mock e2e lokal + verifikasi manual

**Files:**
- Create: `docs/spikes/2026-10-10-phase1-manual-check.md`

- [ ] **Step 1: Jalankan tiga proses (3 terminal / 3 background)**

```bash
# terminal 1 — mock Accurate
cd mocks/accurate && pnpm dev          # :4010
# terminal 2 — API
cd apps/api && MOCK_ACCURATE_URL=http://localhost:4010 pnpm dev   # :3001
# terminal 3 — web
cd apps/web && pnpm dev                # :5173
```

- [ ] **Step 2: Checklist manual di browser**

1. Buka `http://localhost:5173/` (tanpa login) → **landing page** tampil.
2. Buka `http://localhost:5173/api/launch?dbId=1001` → diarahkan ke authorize mock → auto-kembali → **`/app`** tampil "PT Maju Jaya · Halo, Admin Demo (admin)".
3. Buka `http://localhost:5173/settings` → koneksi Accurate **terhubung**; ubah suara ke Gemini → Simpan → muat ulang → tetap Gemini.
4. `POST /api/logout` via curl (`curl -X POST -b "sid=..." http://localhost:5173/api/logout`) lalu buka `/app` → kembali ke landing.

- [ ] **Step 3: Dokumentasikan hasil**

Create `docs/spikes/2026-10-10-phase1-manual-check.md` — daftar 4 butir di atas ✓/✗ + catatan.

- [ ] **Step 4: Commit**

```bash
git add docs/spikes
git commit -m "docs(fase1): hasil verifikasi manual e2e lokal"
```

---

### Task 11: Skeleton Google OAuth (route + tombol; secret menunggu)

**Files:**
- Create: `apps/api/src/routes/google.ts`, `apps/api/test/google.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Failing test (stub jelas saat secret kosong)**

Create `apps/api/test/google.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("google oauth skeleton", () => {
  it("GET /api/oauth/google/start tanpa GOOGLE_OAUTH_CLIENT_SECRET → 501 dengan pesan jelas", async () => {
    const res = await request(createApp()).get("/api/oauth/google/start").redirects(0);
    if (!process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/secret/i);
    } else {
      expect(res.status).toBe(302);
    }
  });
});
```

- [ ] **Step 2: Implement skeleton**

Create `apps/api/src/routes/google.ts`:

```ts
import { Router } from "express";
import { env } from "../env.js";

export const googleRouter = Router();

const SCOPES = ["https://www.googleapis.com/auth/drive"];

googleRouter.get("/oauth/google/start", (req, res) => {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return res.status(501).json({
      error: "google_secret_missing",
      message: "Isi GOOGLE_OAUTH_CLIENT_SECRET di .env (Google Cloud Console → OAuth client).",
    });
  }
  const state = req.user ? req.user.tenant.id : "";
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  u.searchParams.set("redirect_uri", "http://localhost:3001/api/oauth/google/callback");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  res.redirect(u.toString());
});

// callback: menukar code → refresh token Google → simpan di Connection(provider="google")
// DIIMPLEMENTASIKAN PENUH DI FASE 3 (Explore Manager) — saat secret tersedia.
```

Modify `apps/api/src/app.ts` — mount `app.use("/api", googleRouter);` (setelah loadSession agar `req.user` tersedia).

- [ ] **Step 3: Jalankan test — PASS**

Run: `pnpm test`
Expected: PASS (501 path aktif selama secret kosong).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src apps/api/test/google.test.ts
git commit -m "feat(fase1): skeleton OAuth Google (start 501 sampai secret ada)"
```

**Catatan untuk pemilik:** saat ingin mengaktifkan Google, isi `GOOGLE_OAUTH_CLIENT_SECRET` di `.env` dan daftarkan redirect URI `http://localhost:3001/api/oauth/google/callback` di Google Cloud Console.

---

### Task 12: Konsolidasi: README dev, root scripts, verifikasi akhir

**Files:**
- Create: `README.md`
- Modify: `.env` (APP_ORIGIN), `package.json` root

- [ ] **Step 1: Lengkapi env**

Pastikan `.env` root memuat `APP_ORIGIN=http://localhost:5173`.

- [ ] **Step 2: README**

Create `README.md` (ringkas):

```markdown
# AI Google — Add-on AI untuk Accurate Online

## Struktur
- `apps/api` — Express + Prisma (Neon) — port 3001
- `apps/web` — React + Vite — port 5173 (proxy /api → 3001)
- `mocks/accurate` — mock API Accurate — port 4010
- `packages/shared` — tipe TS bersama

## Dev lokal
```bash
pnpm install
cd apps/api && pnpm exec prisma migrate dev   # sekali
# 3 terminal:
cd mocks/accurate && pnpm dev
cd apps/api && MOCK_ACCURATE_URL=http://localhost:4010 pnpm dev
cd apps/web && pnpm dev
```
Buka http://localhost:5173 → landing. Launch mock: http://localhost:5173/api/launch?dbId=1001

## Uji
`pnpm test` (root, semua paket) · `pnpm typecheck`

## Environment (.env root)
DATABASE_URL (Neon), TOKEN_ENC_KEY, ACCURATE_CLIENT_ID/SECRET,
ACCURATE_API_BASE, MOCK_ACCURATE_URL, APP_ORIGIN, GEMINI_API_KEY,
GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (menyusul)

## Fase berikutnya
Fase 2: AI chat + voice (Gemini tool loop + permission).
```

- [ ] **Step 3: Verifikasi akhir penuh**

```bash
pnpm test          # root — semua paket
pnpm typecheck     # root
pnpm --filter @aigoogle/web build
```
Expected: semua PASS/exit 0. `git status` bersih setelah commit.

- [ ] **Step 4: Commit**

```bash
git add README.md .env package.json
git commit -m "docs(fase1): README dev + env final"
```

---

## Selesai Fase 1

**Keluaran:** platform monorepo berjalan — launch dari Accurate (mock/real) tanpa login, tenant+user+role+connection terotomasi, Settings (voice engine + status koneksi), skeleton Google OAuth, token terenkripsi, seluruh suite test hijau.

**Prasyarat yang menunggu pemilik:** (a) `GOOGLE_OAUTH_CLIENT_SECRET` bila ingin uji Google live; (b) daftarkan redirect URI Accurate untuk uji API asli; (c) key Gemini valid untuk spike audio Fase 0.

**Langkah berikutnya:** plan **Fase 2 — AI chat + voice** (Gemini tool loop, AccurateAdapter live/mock, UI chat, STT/TTS).




