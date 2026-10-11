import type {
  AccountingProvider,
  OpenDbResult,
  PrivilegeGroup,
  ProviderCtx,
  ProviderDb,
  ProviderTokenSet,
  ProviderUser,
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
    const j = await this.getEnvelope<{ id: string; email: string; name: string; phone?: string }>(
      "/api/userinfo.do",
      accessToken
    );
    return {
      providerUserId: j.d.id,
      email: j.d.email,
      name: j.d.name,
      phone: typeof j.d.phone === "string" ? j.d.phone : "",
    };
  }

  async listDbs(accessToken: string): Promise<ProviderDb[]> {
    const j = await this.getEnvelope<{ id: number; alias: string; name: string; admin: boolean }[]>(
      "/api/db-list.do",
      accessToken
    );
    return j.d.map((r) => ({
      providerDbId: String(r.id),
      alias: r.alias,
      name: r.name ?? r.alias,
      admin: r.admin,
    }));
  }

  async openDb(accessToken: string, providerDbId: string): Promise<OpenDbResult> {
    const j = await this.getEnvelope<unknown>(
      `/api/open-db.do?id=${encodeURIComponent(providerDbId)}`,
      accessToken
    );
    if (!j.session || !j.host) throw new Error("open-db tidak mengembalikan session/host");
    return { session: j.session, host: j.host };
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
