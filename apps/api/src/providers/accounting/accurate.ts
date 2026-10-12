const DEFAULT_LIST_FIELDS: Record<string, string> = {
  "customer.list": "id,name,email,phone,phone1,mobilePhone",
  "salesInvoice.list": "id,no,customerName,date,total,status,dueDate,customer,totalAmount,description",
  "salesOrder.list": "id,no,customerName,date,total,status,customer,totalAmount",
  "item.list": "id,code,name,unit,sellingPrice",
  "vendor.list": "id,code,name,phone,email,address",
  "glaccount.list": "id,code,name,type",
  "purchaseInvoice.list": "id,no,vendorName,date,total,status,vendor,totalAmount",
  "salesReceipt.list": "id,no,customerName,date,total,status,customer,totalAmount",
};

import type {
  AccountingProvider,
  OpenDbResult,
  PrivilegeGroup,
  ProviderCtx,
  ProviderDb,
  ProviderTokenSet,
  ProviderUser,
  SalesInvoiceInput,
  SalesReceiptInput,
  ToolSpec,
} from "./types.js";
import { ACCURATE_CATALOG } from "./catalog.js";
import { ACTION_ROUTES, ACCURATE_OAUTH_SCOPES } from "./accurate-paths.js";

interface Envelope<T> {
  s?: boolean;
  d?: T;
  /** sebagian aksi save membalas objek hasil di "r" (bukan "s"/"d") */
  r?: unknown;
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
    // scope resmi dari manifest (196 scope securitySchemes ∩ kebutuhan aksi; util tanpa scope)
    u.searchParams.set("scope", ACCURATE_OAUTH_SCOPES.join(" "));
    u.searchParams.set("state", opts.state);
    return u.toString();
  }

  private async tokenRequest(params: Record<string, string>): Promise<ProviderTokenSet> {
    // Accurate mewajibkan HTTP Basic Auth (client_id:client_secret) — bukan di body
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await fetch(`${this.cfg.apiBase}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams(params),
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

  /** GET JSON: dukung envelope {s,d} (mock) maupun objek langsung (Accurate asli). */
  private async fetchJson(path: string, accessToken: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.cfg.apiBase}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new Error("token ditolak provider (401)");
    const raw = await res.text();
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`provider non-JSON ${res.status} ${path}: ${raw.slice(0, 300)}`);
    }
    if (j && typeof j === "object" && "s" in j && !j.s) {
      throw new Error(`provider gagal ${path}: ${raw.slice(0, 300)}`);
    }
    return j ?? {};
  }

  async fetchUser(accessToken: string): Promise<ProviderUser> {
    const j = await this.fetchJson("/api/userinfo.do", accessToken);
    // Accurate asli: profil gaya OpenID {sub,name,email,phone_number}; mock: envelope {s,d:{id,...}}
    const d = (j.sub ? j : ((j.d as Record<string, unknown>) ?? j)) as Record<string, unknown>;
    const id = d.sub ?? d.id;
    if (!id || !d.email) throw new Error(`userinfo tak dikenal: ${JSON.stringify(j).slice(0, 300)}`);
    return {
      providerUserId: String(id),
      email: String(d.email),
      name: String(d.name ?? ""),
      phone: typeof d.phone_number === "string" ? d.phone_number : typeof d.phone === "string" ? d.phone : "",
    };
  }

  async listDbs(accessToken: string): Promise<ProviderDb[]> {
    const j = await this.fetchJson("/api/db-list.do", accessToken);
    const arr = Array.isArray(j) ? j : Array.isArray(j.d) ? (j.d as Record<string, unknown>[]) : null;
    if (!arr) throw new Error(`db-list tak dikenal: ${JSON.stringify(j).slice(0, 300)}`);
    return arr.map((r) => ({
      providerDbId: String(r.id),
      alias: String(r.alias ?? ""),
      name: String(r.name ?? r.alias ?? ""),
      admin: Boolean(r.admin),
    }));
  }

  async openDb(accessToken: string, providerDbId: string): Promise<OpenDbResult> {
    const j = await this.fetchJson(`/api/open-db.do?id=${encodeURIComponent(providerDbId)}`, accessToken);
    const d = (j.d && typeof j.d === "object" ? j.d : {}) as Record<string, unknown>;
    const host = j.host ?? d.host;
    const session = j.session ?? d.session;
    if (!host || !session) throw new Error(`open-db tidak mengembalikan session/host: ${JSON.stringify(j).slice(0, 300)}`);
    return { session: String(session), host: String(host) };
  }

  private async utilGet(util: string, ctx: ProviderCtx, extraQuery = ""): Promise<unknown> {
    // seluruh util ada di API Dasar (account.accurate.id), bukan host company
    const res = await fetch(`${this.cfg.apiBase}/api/${util}.do${extraQuery}`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
      redirect: "follow",
    });
    if (res.status === 401) throw new Error("token ditolak provider (401)");
    const j = (await res.json()) as Envelope<unknown>;
    if (!j.s) throw new Error(`provider gagal: ${JSON.stringify(j.d)}`);
    return j.d;
  }
  approvedScope(ctx: ProviderCtx): Promise<unknown> {
    return this.utilGet("approved-scope", ctx);
  }
  authInfo(ctx: ProviderCtx): Promise<unknown> {
    return this.utilGet("auth-info", ctx);
  }
  dbCheckSession(ctx: ProviderCtx, dbId?: string): Promise<unknown> {
    return this.utilGet("db-check-session", ctx, dbId ? `?id=${encodeURIComponent(dbId)}` : "");
  }
  dbDetail(ctx: ProviderCtx, dbId?: string): Promise<unknown> {
    return this.utilGet("db-detail", ctx, dbId ? `?id=${encodeURIComponent(dbId)}` : "");
  }
  dbList(ctx: ProviderCtx): Promise<unknown> {
    return this.utilGet("db-list", ctx);
  }
  dbRefreshSession(ctx: ProviderCtx, dbId?: string): Promise<unknown> {
    return this.utilGet("db-refresh-session", ctx, dbId ? `?id=${encodeURIComponent(dbId)}` : "");
  }
  dbStatus(ctx: ProviderCtx, dbId?: string): Promise<unknown> {
    return this.utilGet("db-status", ctx, dbId ? `?id=${encodeURIComponent(dbId)}` : "");
  }
  webhookHistory(ctx: ProviderCtx, from?: string, to?: string): Promise<unknown> {
    const q = from ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to ?? from)}` : "";
    return this.utilGet("webhook-history", ctx, q);
  }
  webhookRenew(ctx: ProviderCtx): Promise<unknown> {
    return this.utilGet("webhook-renew", ctx);
  }

  capabilityCatalog(): ToolSpec[] {
    return ACCURATE_CATALOG;
  }

  /** fetch API company dgn deteksi HTML (SPA = path tak ada / transient 302) + retry utk non-docsOnly */
  private async requestText(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    docsOnly: boolean
  ): Promise<string> {
    const attempt = async (): Promise<string> => {
      const res = await fetch(url, {
        method: method as "GET" | "POST" | "DELETE",
        headers,
        redirect: "follow",
        body,
      });
      if (res.status === 401) throw new Error("sesi/token ditolak provider (401)");
      const txt = await res.text();
      if (/^\s*</.test(txt)) {
        if (docsOnly) {
          throw new Error(
            "tolak-dokumentasi: path docs-only tidak tersedia di API Accurate asli (respons HTML SPA)"
          );
        }
        // transient (rate-limit/idle) — bukan kesalahan payload
        throw new Error("html-transient: provider membalas HTML (kemungkinan transient 302)");
      }
      return txt;
    };
    try {
      return await attempt();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (docsOnly || !msg.startsWith("html-transient")) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return await attempt();
    }
  }

  private parseEnvelope(txt: string): Envelope<unknown> {
    const j = JSON.parse(txt) as Envelope<unknown>;
    // envelope standar {s,d}; sebagian save membalas {r:{...data dgn id}} tanpa field s
    if (j.s === false) throw new Error(`provider gagal: ${JSON.stringify(j.d)}`);
    return j;
  }

  private async moduleGet(path: string, ctx: ProviderCtx, docsOnly = false): Promise<Envelope<unknown>> {
    const txt = await this.requestText(
      "GET",
      `${ctx.host}${path}`,
      { Authorization: `Bearer ${ctx.accessToken}`, "X-Session-ID": ctx.session },
      undefined,
      docsOnly
    );
    return this.parseEnvelope(txt);
  }

  private buildQuery(args: Record<string, unknown>): string {
    const qs = new URLSearchParams();
    if (typeof args.fields === "string" && args.fields) qs.set("fields", args.fields);
    if (typeof args.keywords === "string" && args.keywords) qs.set("keywords", args.keywords);
    if (typeof args.page === "number") qs.set("sp.page", String(args.page));
    if (typeof args.pageSize === "number") qs.set("sp.pageSize", String(args.pageSize));
    if (typeof args.sort === "string" && args.sort) qs.set("sp.sort", args.sort);
    const filter = args.filter;
    if (filter && typeof filter === "object") {
      for (const [field, cond] of Object.entries(filter as Record<string, unknown>)) {
        if (cond && typeof cond === "object") {
          const { op, value } = cond as { op?: string; value?: unknown };
          if (op) qs.set(`filter.${field}.op`, String(op));
          if (value !== undefined) {
            const vals = Array.isArray(value) ? value : [value];
            vals.forEach((v, i) => qs.set(`filter.${field}.val${vals.length > 1 ? `[${i}]` : ""}`, String(v)));
          }
        }
      }
    }
    // argumen tambahan (id, accountCode, dst) ikut terkirim apa adanya
    for (const [k, v] of Object.entries(args)) {
      if (["fields", "keywords", "page", "pageSize", "sort", "filter"].includes(k)) continue;
      if (v === undefined || v === null || typeof v === "object") continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `?${s}` : "";
  }

  async execute(tool: string, args: Record<string, unknown>, ctx: ProviderCtx): Promise<unknown> {
    const route = ACTION_ROUTES[tool];
    if (!route) throw new Error(`tool tidak dikenal: ${tool}`);
    if (route.method === "GET") {
      let merged = args;
      // API Accurate asli hanya membalas {id} kecuali dimintai fields;
      // mock menyaring sendiri kolom yang dikenal → daftar gabungan aman dua arah
      if (tool.endsWith(".list") && !(typeof args.fields === "string" && args.fields) && DEFAULT_LIST_FIELDS[tool]) {
        merged = { ...args, fields: DEFAULT_LIST_FIELDS[tool] };
      }
      const j = await this.moduleGet(`${route.path}${this.buildQuery(merged)}`, ctx, route.docsOnly);
      return j.d;
    }
    if (route.method === "DELETE") {
      const id = args.id;
      if (typeof id !== "string" || !id) throw new Error("args.id wajib string untuk aksi delete");
      const txt = await this.requestText(
        "DELETE",
        `${ctx.host}${route.path}?id=${encodeURIComponent(id)}`,
        { Authorization: `Bearer ${ctx.accessToken}`, "X-Session-ID": ctx.session },
        undefined,
        route.docsOnly
      );
      const j = this.parseEnvelope(txt);
      return j.d;
    }
    const j = await this.modulePost(route.path, args, ctx, route.docsOnly);
    // save membalas objek hasil di "r" (berisi id) — fallback ke "d" (pesan array)
    return j.r ?? j.d;
  }

  private async modulePost(path: string, body: unknown, ctx: ProviderCtx, docsOnly = false): Promise<Envelope<unknown>> {
    const txt = await this.requestText(
      "POST",
      `${ctx.host}${path}`,
      {
        Authorization: `Bearer ${ctx.accessToken}`,
        "X-Session-ID": ctx.session,
        "Content-Type": "application/json",
      },
      JSON.stringify(body),
      docsOnly
    );
    return this.parseEnvelope(txt);
  }

  async createSalesInvoice(ctx: ProviderCtx, data: SalesInvoiceInput): Promise<{ id: string }> {
    const j = await this.modulePost(
      "/accurate/api/sales-invoice/add.do",
      {
        customerName: data.customerName,
        date: data.date || new Date().toISOString().slice(0, 10),
        total: data.total ?? 0,
        description: data.description ?? "",
        ...(data.no ? { no: data.no } : {}),
      },
      ctx
    );
    return { id: String(j.d ?? "") };
  }

  async createSalesReceipt(ctx: ProviderCtx, data: SalesReceiptInput): Promise<{ id: string }> {
    const j = await this.modulePost(
      "/accurate/api/sales-receipt/add.do",
      {
        customerName: data.customerName,
        date: data.date || new Date().toISOString().slice(0, 10),
        amount: data.amount ?? 0,
        description: data.description ?? "",
        ...(data.no ? { no: data.no } : {}),
      },
      ctx
    );
    return { id: String(j.d ?? "") };
  }

  async refreshToken(refreshToken: string): Promise<ProviderTokenSet> {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async privilegeCatalog(ctx: ProviderCtx): Promise<PrivilegeGroup[]> {
    const list = await this.moduleGet("/accurate/api/access-privilege/list.do", ctx);
    const groups = (list.d as Array<{ id: string; name: string }>) ?? [];
    const out: PrivilegeGroup[] = [];
    for (const g of groups) {
      const detail = await this.moduleGet(
        `/accurate/api/access-privilege/detail.do?id=${encodeURIComponent(g.id)}`,
        ctx
      );
      const row = (detail.d as Array<{ Privilege: Array<{ ModuleName: string; AllowView: boolean }> }>)[0];
      out.push({
        id: g.id,
        name: g.name,
        allowViewModules: (row?.Privilege ?? []).filter((m) => m.AllowView).map((m) => m.ModuleName),
      });
    }
    return out;
  }
}
