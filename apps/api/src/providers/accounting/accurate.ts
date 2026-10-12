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
    u.searchParams.set("scope", "item_view customer_view sales_invoice_view sales_invoice_save");
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

  capabilityCatalog(): ToolSpec[] {
    return ACCURATE_CATALOG;
  }

  private async moduleGet(path: string, ctx: ProviderCtx): Promise<Envelope<unknown>> {
    const res = await fetch(`${ctx.host}${path}`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, "X-Session-ID": ctx.session },
      redirect: "follow",
    });
    if (res.status === 401) throw new Error("sesi/token ditolak provider (401)");
    const j = (await res.json()) as Envelope<unknown>;
    if (!j.s) throw new Error(`provider gagal: ${JSON.stringify(j.d)}`);
    return j;
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
    const s = qs.toString();
    return s ? `?${s}` : "";
  }

  async execute(tool: string, args: Record<string, unknown>, ctx: ProviderCtx): Promise<unknown> {
    const listPaths: Record<string, string> = {
      "customer.list": "/accurate/api/customer/list.do",
      "salesInvoice.list": "/accurate/api/sales-invoice/list.do",
      "salesOrder.list": "/accurate/api/sales-order/list.do",
      "item.list": "/accurate/api/item/list.do",
      "vendor.list": "/accurate/api/vendor/list.do",
      "glAccount.list": "/accurate/api/glaccount/list.do",
      "purchaseInvoice.list": "/accurate/api/purchase-invoice/list.do",
      "salesReceipt.list": "/accurate/api/sales-receipt/list.do",
    };
    const detailPaths: Record<string, string> = {
      "customer.detail": "/accurate/api/customer/detail.do",
      "salesInvoice.detail": "/accurate/api/sales-invoice/detail.do",
    };
    const listPath = listPaths[tool];
    if (listPath) {
      const j = await this.moduleGet(`${listPath}${this.buildQuery(args)}`, ctx);
      return j.d;
    }
    const detailPath = detailPaths[tool];
    if (detailPath) {
      const id = args.id;
      if (typeof id !== "string" || !id) throw new Error("args.id wajib string untuk tool detail");
      const j = await this.moduleGet(`${detailPath}?id=${encodeURIComponent(id)}`, ctx);
      return j.d;
    }
    throw new Error(`tool tidak dikenal: ${tool}`);
  }

  private async modulePost(path: string, body: unknown, ctx: ProviderCtx): Promise<Envelope<unknown>> {
    const res = await fetch(`${ctx.host}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        "X-Session-ID": ctx.session,
        "Content-Type": "application/json",
      },
      redirect: "follow",
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("sesi/token ditolak provider (401)");
    const j = (await res.json()) as Envelope<unknown>;
    if (!j.s) throw new Error(`provider gagal: ${JSON.stringify(j.d)}`);
    return j;
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
