/**
 * Kolom default tiap daftar — HANYA nama yang benar-benar dikenal Accurate.
 *
 * Diverifikasi langsung ke API (uji 66 tool .list, nol error): nama kolom tak dikenal
 * dibuang DIAM-DIAM tanpa pesan kesalahan. Karena itu daftar lama (no/customerName/date/
 * total/status/code/unit/…) tidak pernah terbalaskan → model tidak melihat nomor transaksi
 * lalu MENGARANG-nya (kasus nyata: menampilkan "INV-2050" dari id 2050, padahal nomor asli
 * `SI.2017.01.00010`).
 */
const DEFAULT_LIST_FIELDS: Record<string, string> = {
  "customer.list": "id,customerNo,name,email,mobilePhone,balance",
  "vendor.list": "id,vendorNo,name,email,mobilePhone,balance",
  "item.list": "id,no,name,quantity",
  "glaccount.list": "id,no,name,accountType,balance",
  "currency.list": "id,code,name",
  "salesInvoice.list": "id,number,transDate,dueDate,totalAmount,approvalStatus,statusName,customerNo,customer,description",
  "salesOrder.list": "id,number,transDate,totalAmount,status,approvalStatus,customerNo,customer",
  "salesQuotation.list": "id,number,transDate,totalAmount,approvalStatus,customerNo,customer,description",
  "salesReceipt.list": "id,number,transDate,approvalStatus,customerNo,customer,description",
  "salesReturn.list": "id,number,transDate,totalAmount,approvalStatus,customerNo,customer,description",
  "deliveryOrder.list": "id,number,transDate,approvalStatus,customerNo,customer,description",
  "purchaseInvoice.list": "id,number,transDate,dueDate,totalAmount,approvalStatus,statusName,vendor,description",
  "purchaseOrder.list": "id,number,transDate,dueDate,totalAmount,approvalStatus,vendor,description",
  "purchaseQuotation.list": "id,number,transDate,totalAmount,approvalStatus,vendor,description",
  "purchaseReturn.list": "id,number,transDate,totalAmount,approvalStatus,vendor,description",
  "journalVoucher.list": "id,number,transDate,totalAmount,approvalStatus,description",
  "expense.list": "id,number,transDate,totalAmount,approvalStatus,description",
  "bankTransfer.list": "id,number,transDate,totalAmount,approvalStatus,description",
};

/**
 * Fallback utk SEMUA modul lain — satu daftar lintas modul; Accurate membuang sendiri
 * nama kolom yang tidak berlaku di modul tsb (sudah diuji: 66/66 .list tanpa error),
 * sehingga nomor transaksi/kode tetap muncul di modul yang belum tercantum di atas.
 */
const GENERIC_LIST_FIELDS =
  "id,name,no,number,code,customerNo,vendorNo,transDate,dueDate,totalAmount,subTotal," +
  "approvalStatus,description,quantity,balance,accountType,customer,vendor,email,mobilePhone";

/** Kolom `fields` bawaan utk satu tool daftar (modul spesifik, atau fallback generik). */
export function listFieldsFor(tool: string): string {
  return DEFAULT_LIST_FIELDS[tool] ?? GENERIC_LIST_FIELDS;
}

import type {
  AccountingProvider,
  BankTransferInput,
  CustomerLookupInput,
  CustomerRef,
  ExpenseInput,
  OpenDbResult,
  PrivilegeGroup,
  ProviderCtx,
  ProviderDb,
  ProviderTokenSet,
  ProviderUser,
  PurchaseInvoiceInput,
  SalesInvoiceInput,
  SalesOrderInput,
  SalesReceiptInput,
  SavedDoc,
  ToolSpec,
} from "./types.js";
import { ACCURATE_CATALOG } from "./catalog.js";
import { ACTION_ROUTES, ACCURATE_OAUTH_SCOPES } from "./accurate-paths.js";
import { AGGREGATION_TOOLS, runAggregation } from "./aggregation.js";

interface Envelope<T> {
  s?: boolean;
  d?: T;
  /** sebagian aksi save membalas objek hasil di "r" (bukan "s"/"d") */
  r?: unknown;
  /** meta pagination daftar (page, pageSize, rowCount, pageCount) */
  sp?: { page?: number; pageSize?: number; rowCount?: number; pageCount?: number };
  session?: string;
  host?: string;
  admin?: boolean;
}

export interface ListResult {
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  /** TOTAL baris yang cocok dgn filter (bukan hanya halaman ini) */
  total: number;
  pageCount: number;
}

interface GlAccount {
  no: string;
  name: string;
  accountType: string;
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
    // katalog penuh = aksi Accurate asli (366) + tool agregasi server-side (pemangkas putaran LLM)
    return [...ACCURATE_CATALOG, ...AGGREGATION_TOOLS];
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
    if (j.s === false) {
      const msg = Array.isArray(j.d) ? j.d.map(String).join("; ") : JSON.stringify(j.d);
      throw new Error(`provider gagal: ${msg}`);
    }
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
    if (typeof args.sort === "string" && args.sort) {
      // Accurate hanya menerima sort by "id" — field lain (date, no, …) balas "Upsss..."
      // Map tanggal ke id (auto-increment ≈ urut waktu) supaya "terakhir" tetap benar
      const sanitized = args.sort
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [field, dir] = part.split("|").map((s) => s.trim());
          const allowed = /^(id)$/i.test(field);
          const f = allowed ? "id" : /^(date|transactionDate|transDate|createdDate|no)$/i.test(field) ? "id" : null;
          if (!f) return null;
          const d = /^(desc|asc)$/i.test(dir ?? "") ? dir.toLowerCase() : "desc";
          return `${f}|${d}`;
        })
        .filter(Boolean);
      if (sanitized.length > 0) qs.set("sp.sort", sanitized.join(";"));
    }
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
        } else if (cond !== undefined && cond !== null) {
          // kolom tanpa operator (filter.customerNo, filter.outstanding) → value langsung
          qs.set(`filter.${field}`, String(cond));
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
    // tool agregasi server-side → jalankan rantai Accurate (search → list → detail) sekali
    if (AGGREGATION_TOOLS.some((t) => t.name === tool)) {
      return runAggregation(tool, args, ctx, (t, a) => this.execute(t, a, ctx));
    }
    const route = ACTION_ROUTES[tool];
    if (!route) throw new Error(`tool tidak dikenal: ${tool}`);
    if (route.method === "GET") {
      let merged = args;
      // API Accurate asli hanya membalas {id} kecuali dimintai fields;
      // mock menyaring sendiri kolom yang dikenal → daftar gabungan aman dua arah.
      // Tanpa fallback generik, modul yang tak ada di map balik tanpa nomor transaksi.
      if (tool.endsWith(".list") && !(typeof args.fields === "string" && args.fields)) {
        merged = { ...args, fields: listFieldsFor(tool) };
      }
      const j = await this.moduleGet(`${route.path}${this.buildQuery(merged)}`, ctx, route.docsOnly);
      if (tool.endsWith(".list")) {
        // bentuk + meta total/halaman → model TAHU jumlah baris & tak menebak-nebak
        // paging (dulu: page 2, page 3 … tiap halaman = +1 putaran LLM 0,5-15 dtk)
        const items = Array.isArray(j.d) ? (j.d as Array<Record<string, unknown>>) : [];
        const sp = j.sp ?? {};
        return {
          items,
          page: sp.page ?? 1,
          pageSize: sp.pageSize ?? items.length,
          total: sp.rowCount ?? items.length,
          pageCount: sp.pageCount ?? (items.length ? 1 : 0),
        } satisfies ListResult;
      }
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

  /** Lengkapi {id,number} dari balasan save; ambil detail bila nomor tidak ikut. */
  private async savedDoc(j: Envelope<unknown>, detailPath?: string, ctx?: ProviderCtx): Promise<SavedDoc> {
    const r = (j.r ?? {}) as { id?: unknown; number?: unknown; totalAmount?: unknown; total?: unknown };
    let id = String(r.id ?? "");
    let number = String(r.number ?? "");
    const rawTotal = Number(r.totalAmount ?? r.total ?? NaN);
    if ((!id || !number) && detailPath && ctx) {
      try {
        const q = id ? `id=${encodeURIComponent(id)}` : `number=${encodeURIComponent(number)}`;
        const d = await this.moduleGet(`${detailPath}?${q}`, ctx);
        const row = (Array.isArray(d.d) ? d.d[0] : d.d) as Record<string, unknown> | undefined;
        if (row) {
          id = id || String(row.id ?? "");
          number = number || String(row.number ?? "");
        }
      } catch {
        /* biarkan fallback id/number */
      }
    }
    if (!id) id = number;
    if (!number) number = id;
    return { id, number, ...(Number.isFinite(rawTotal) && rawTotal > 0 ? { total: rawTotal } : {}) };
  }

  /** Pesanan penjualan (SO) — item WAJIB memakai kode barang Accurate (itemNo). */
  async createSalesOrder(ctx: ProviderCtx, data: SalesOrderInput): Promise<SavedDoc> {
    if (!data.customerNo.trim()) throw new Error("pelanggan Accurate (customerNo) wajib diisi");
    const raw = (data.items ?? []).slice(0, 50);
    if (!raw.length) throw new Error("pesanan penjualan butuh minimal 1 item");
    const detailItem = raw.map((it) => {
      const itemNo = String(it.itemNo ?? "").trim();
      if (!itemNo) throw new Error("kode barang (itemNo) wajib diisi untuk pesanan penjualan");
      const unitPrice = Number(it.price);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error(`harga item "${itemNo}" belum terbaca — lengkapi harga item`);
      }
      return { itemNo, quantity: it.qty ?? 1, unitPrice };
    });
    const branch = await this.resolveBranchName(ctx);
    const j = await this.modulePost(
      "/accurate/api/sales-order/save.do",
      {
        customerNo: data.customerNo.trim(),
        transDate: this.toAccurateDate(data.date),
        ...(branch ? { branchName: branch } : {}),
        ...(data.no ? { number: data.no } : {}),
        description: data.description ?? "",
        taxable: data.taxable === true,
        detailItem,
        detailExpense: [],
      },
      ctx
    );
    return this.savedDoc(j, "/accurate/api/sales-order/detail.do", ctx);
  }

  /** Tutup pesanan penjualan (manual-close-order). */
  async closeSalesOrder(ctx: ProviderCtx, data: { number: string }): Promise<void> {
    const number = data.number.trim();
    if (!number) throw new Error("nomor pesanan penjualan wajib diisi");
    await this.modulePost("/accurate/api/sales-order/manual-close-order.do", { number, orderClosed: true }, ctx);
  }

  /** Cari pelanggan berdasarkan nomor HP lalu nama (exact) — tanpa menebak. */
  private async searchCustomer(ctx: ProviderCtx, name: string, phone: string): Promise<CustomerRef | null> {
    const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
    const wantPhone = digits(phone);
    const queries = [...new Set([phone, name].map((q) => q.trim()).filter(Boolean))];
    for (const q of queries) {
      const j = await this.moduleGet(
        `/accurate/api/customer/list.do?sp.pageSize=20&fields=customerNo,name,mobilePhone&keywords=${encodeURIComponent(q)}`,
        ctx
      );
      const arr = (j.d as Array<Record<string, unknown>>) ?? [];
      const byPhone = wantPhone
        ? arr.find((c) => digits(c.mobilePhone) && digits(c.mobilePhone) === wantPhone)
        : undefined;
      const hit = byPhone ?? (name ? arr.find((c) => String(c.name ?? "").trim().toLowerCase() === name.trim().toLowerCase()) : undefined);
      if (hit?.customerNo) {
        return {
          customerNo: String(hit.customerNo),
          name: String(hit.name ?? name),
          mobilePhone: hit.mobilePhone ? String(hit.mobilePhone) : undefined,
        };
      }
    }
    return null;
  }

  async listCustomers(ctx: ProviderCtx, opts: { keywords?: string; limit?: number }): Promise<CustomerRef[]> {
    const pageSize = Math.min(50, Math.max(1, opts.limit ?? 20));
    const kw = (opts.keywords ?? "").trim();
    const j = await this.moduleGet(
      `/accurate/api/customer/list.do?sp.pageSize=${pageSize}&fields=customerNo,name,mobilePhone${
        kw ? `&keywords=${encodeURIComponent(kw)}` : ""
      }`,
      ctx
    );
    return ((j.d as Array<Record<string, unknown>>) ?? [])
      .map((c) => ({
        customerNo: String(c.customerNo ?? ""),
        name: String(c.name ?? ""),
        mobilePhone: c.mobilePhone ? String(c.mobilePhone) : undefined,
      }))
      .filter((c) => c.customerNo && c.name);
  }

  /**
   * Cari pelanggan by HP/nama; bila tidak ada dan `createName` diisi, buat baru
   * dengan penanda WhatsApp/Online (description + notes) supaya mudah difilter di Accurate.
   */
  async findOrCreateCustomer(ctx: ProviderCtx, data: CustomerLookupInput): Promise<CustomerRef | null> {
    const name = (data.name ?? "").trim();
    const phone = (data.phone ?? "").trim();
    const found = await this.searchCustomer(ctx, name, phone);
    if (found) return found;
    const createName = (data.createName ?? "").trim();
    if (!createName) return null;
    const branch = await this.resolveBranchName(ctx);
    const j = await this.modulePost(
      "/accurate/api/customer/save.do",
      {
        name: createName,
        transDate: this.toAccurateDate(),
        ...(branch ? { branchName: branch } : {}),
        ...(phone ? { mobilePhone: phone } : {}),
        ...(data.categoryName ? { categoryName: data.categoryName } : {}),
        description: data.description ?? (phone ? `Pembeli WhatsApp ${phone}` : "Pembeli WhatsApp/Online"),
        notes: "WA/Online",
      },
      ctx
    );
    const r = (j.r ?? {}) as { customerNo?: unknown; id?: unknown };
    if (r.customerNo) return { customerNo: String(r.customerNo), name: createName, mobilePhone: phone || undefined };
    // balasan save tidak memuat customerNo → cari ulang by nama tepat
    const after = await this.searchCustomer(ctx, createName, phone);
    if (after) return after;
    throw new Error(`pelanggan "${createName}" dibuat tetapi customerNo tidak terbaca dari Accurate`);
  }

  async createSalesInvoice(ctx: ProviderCtx, data: SalesInvoiceInput): Promise<SavedDoc> {
    const customerNo = await this.resolveByName(ctx, "customer", data.customerName.trim());
    if (!customerNo) throw new Error(`pelanggan "${data.customerName}" tidak ditemukan di Accurate`);
    const detailItem: Array<Record<string, unknown>> = [];
    const missing: string[] = [];
    for (const it of (data.items ?? []).slice(0, 50)) {
      const itemNo = it.itemNo?.trim() || (await this.resolveByName(ctx, "item", it.name.trim()));
      if (!itemNo) {
        missing.push(it.name);
        continue;
      }
      const unitPrice = Number(it.price);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error(`harga item "${it.name}" belum terbaca — lengkapi harga item`);
      }
      detailItem.push({ itemNo, quantity: it.qty ?? 1, unitPrice });
    }
    if (missing.length) throw new Error(`item tidak ditemukan di Accurate: ${missing.join(", ")}`);
    if (!detailItem.length) throw new Error("faktur penjualan butuh minimal 1 item");
    const branch = await this.resolveBranchName(ctx);
    // ongkos kirim / biaya lain ikut ditagihkan sebagai detailExpense agar total
    // faktur = total yang dibayar pembeli (sebelumnya faktur hanya berisi barang,
    // sehingga penerimaan kas "melebihi nilai piutang faktur").
    // API asli mewajibkan accountNo di detailExpense (tanpa itu Accurate menolak:
    // "Detail ... tidak ada atau sudah dihapus dari database") — akun diambil dari
    // COA yang sudah ada (akun pendapatan yg mengandung kata ongkir/ongkos/kirim,
    // fallback pendapatan lain-lain); bila tidak ketemu → faktur barang saja
    // (penerimaan kas otomatis dibatasi ke sisa piutang oleh createSalesReceipt).
    const shipAmount = Number(data.shipping?.amount ?? 0);
    let detailExpense: Array<Record<string, unknown>> = [];
    if (Number.isFinite(shipAmount) && shipAmount > 0) {
      const accountNo =
        data.shipping?.accountNo?.trim() || (await this.shippingRevenueAccount(ctx));
      detailExpense =
        accountNo
          ? [
              {
                accountNo: accountNo,
                expenseName: String(data.shipping?.name ?? "Ongkos Kirim").slice(0, 100),
                expenseAmount: shipAmount,
              },
            ]
          : [];
    }
    const j = await this.modulePost(
      "/accurate/api/sales-invoice/save.do",
      {
        customerNo,
        transDate: this.toAccurateDate(data.date),
        ...(branch ? { branchName: branch } : {}),
        ...(data.no ? { number: data.no } : {}),
        description: data.description ?? "",
        taxable: false,
        detailDownPayment: [],
        detailExpense,
        detailItem,
      },
      ctx
    );
    const doc = await this.savedDoc(j, "/accurate/api/sales-invoice/detail.do", ctx);
    if (doc.total === undefined && doc.id) {
      try {
        const d = await this.moduleGet(`/accurate/api/sales-invoice/detail.do?id=${encodeURIComponent(doc.id)}`, ctx);
        const row = (Array.isArray(d.d) ? d.d[0] : d.d) as Record<string, unknown> | undefined;
        const t = Number(row?.totalAmount ?? row?.grandTotal ?? NaN);
        if (Number.isFinite(t) && t > 0) doc.total = t;
      } catch {
        /* total tak terbaca — pemanggil memakai total pesanan */
      }
    }
    return doc;
  }

  /** Sisa piutang faktur penjualan by nomor (totalAmount − paidAmount). Null bila faktur
   *  tidak ketemu / total tak terbaca → pemanggil tidak boleh membatasi jumlah. */
  private async invoiceOutstanding(ctx: ProviderCtx, invoiceNo: string): Promise<number | null> {
    const no = invoiceNo.trim();
    if (!no) return null;
    try {
      const j = await this.moduleGet(
        `/accurate/api/sales-invoice/list.do?sp.pageSize=10&fields=id,number,totalAmount,paidAmount&keywords=${encodeURIComponent(no)}`,
        ctx
      );
      const arr = (j.d as Array<Record<string, unknown>>) ?? [];
      // hanya pakai baris dgn nomor persis — jangan cap dgn faktur milik orang lain
      const row = arr.find((r) => String(r.number ?? "").trim() === no);
      if (!row) return null;
      const total = Number(row.totalAmount ?? NaN);
      if (!Number.isFinite(total)) return null;
      const paid = Number(row.paidAmount ?? 0);
      return Math.max(0, Math.round((total - (Number.isFinite(paid) ? paid : 0)) * 100) / 100);
    } catch {
      return null;
    }
  }

  async createSalesReceipt(ctx: ProviderCtx, data: SalesReceiptInput): Promise<SavedDoc> {
    const customerNo = await this.resolveByName(ctx, "customer", data.customerName.trim());
    if (!customerNo) throw new Error(`pelanggan "${data.customerName}" tidak ditemukan di Accurate`);
    if (!data.invoiceNo?.trim()) throw new Error("nomor faktur yang dibayar wajib diisi untuk penerimaan kas");
    const all = await this.allAccounts(ctx);
    const cash = all.filter(
      (a) => a.accountType === "CASH_BANK" && this.isLeaf(a) && !/\b(USD|SGD|EUR|MYR|AUD|JPY)\b/i.test(a.name)
    );
    const bankNo = data.bankNo?.trim() || cash[0]?.no;
    if (!bankNo) throw new Error("rekening kas/bank rupiah tidak ditemukan di Accurate");
    let amount = Number(data.amount ?? 0);
    if (!(amount > 0)) throw new Error("jumlah penerimaan kas wajib lebih dari 0");
    // Accurate menolak bila pembayaran > sisa piutang faktur ("melebihi nilai
    // piutang fakturnya") — batasi ke sisa piutang yang sebenarnya.
    const invoiceNo = data.invoiceNo.trim();
    const outstanding = await this.invoiceOutstanding(ctx, invoiceNo);
    if (outstanding !== null) {
      if (outstanding <= 0) throw new Error(`faktur ${invoiceNo} sudah lunas — penerimaan kas dilewati`);
      if (outstanding < amount) amount = outstanding;
    }
    const branch = await this.resolveBranchName(ctx);
    const j = await this.modulePost(
      "/accurate/api/sales-receipt/save.do",
      {
        customerNo,
        bankNo,
        chequeAmount: amount,
        transDate: this.toAccurateDate(data.date),
        ...(branch ? { branchName: branch } : {}),
        ...(data.no ? { number: data.no } : {}),
        description: data.description ?? "",
        detailInvoice: [{ invoiceNo, paymentAmount: amount }],
      },
      ctx
    );
    return this.savedDoc(j, "/accurate/api/sales-receipt/detail.do", ctx);
  }

  // ── Referensi akuntansi (cabang, buku besar) — cache 5 menit per sesi ──

  private static refCache = new Map<string, { at: number; v: unknown }>();
  private async cachedRef<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = AccurateAdapter.refCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.v as T;
    const v = await fn();
    AccurateAdapter.refCache.set(key, { at: Date.now(), v });
    return v;
  }

  /** Accurate mewajibkan transDate dd/MM/yyyy (ISO ditolak). */
  private toAccurateDate(iso?: string): string {
    const d = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  /** Cabang aktif — DB multi-cabang menolak save tanpa branchName. */
  private async resolveBranchName(ctx: ProviderCtx): Promise<string | undefined> {
    return await this.cachedRef(`branch:${ctx.host}`, async () => {
      try {
        const j = await this.moduleGet("/accurate/api/branch/list.do?fields=name", ctx);
        const arr = (j.d as Array<{ name?: string }>) ?? [];
        return arr.map((b) => b.name ?? "").find(Boolean) || undefined;
      } catch {
        return undefined;
      }
    });
  }

  /** Semua akun buku besar (berhalaman) — dipakai utk pilih akun daun. */
  private async allAccounts(ctx: ProviderCtx): Promise<GlAccount[]> {
    return await this.cachedRef(`gl:${ctx.host}`, async () => {
      const out: GlAccount[] = [];
      for (let page = 1; page <= 5; page++) {
        const j = await this.moduleGet(
          `/accurate/api/glaccount/list.do?sp.pageSize=100&sp.page=${page}&fields=no,name,accountType`,
          ctx
        );
        const arr = (j.d as GlAccount[]) ?? [];
        out.push(...arr);
        if (arr.length < 100) break;
      }
      return out;
    });
  }

  /**
   * Akun daun = nomor tidak berakhiran "-00" (nomor "-00" adalah grup/indak di
   * bagan Accurate). Terverifikasi live: leaf 111.102-01, 511.000-01, 213.100-01;
   * induk 111.000-00, 511.000-00, 213.000-00.
   */
  private isLeaf(a: GlAccount): boolean {
    return !a.no.endsWith("-00");
  }

  /** Cari akun daun sesuai kata kunci dari deskripsi; fallback akun pertama sesuai tipe. */
  private pickAccount(all: GlAccount[], types: RegExp, hint: string, requireLeaf = true): GlAccount | null {
    const pool = all.filter((a) => types.test(a.accountType) && (!requireLeaf || this.isLeaf(a)));
    const words = hint
      .toLowerCase()
      .split(/[^\p{L}\d]+/u)
      .filter((w) => w.length >= 4);
    const hit =
      pool.find((a) => words.some((w) => a.name.toLowerCase().includes(w))) ??
      pool.find((a) => words.some((w) => w.includes(a.name.toLowerCase().split(" ")[0] ?? "\0")));
    return hit ?? pool[0] ?? null;
  }

  /** Akun pendapatan utk ongkir yang ditagihkan ke pelanggan — dari COA yang sudah ada
   *  (bukan membuat akun baru): utamakan akun bernuansa ongkir/ongkos kirim, lalu
   *  pendapatan lain-lain/jasa. Undefined bila tidak ada yang cocok → faktur barang saja. */
  private async shippingRevenueAccount(ctx: ProviderCtx): Promise<string | undefined> {
    const all = await this.allAccounts(ctx);
    const income = all.filter(
      (a) => (a.accountType === "REVENUE" || a.accountType === "OTHER_INCOME") && this.isLeaf(a)
    );
    const hit =
      income.find((a) => /ongkir|ongkos\s*kirim|pengiriman|freight|shipping/i.test(a.name)) ??
      income.find((a) => /lain-lain|other\s*income|jasa/i.test(a.name));
    return hit?.no || undefined;
  }

  private async resolveByName(ctx: ProviderCtx, api: "vendor" | "item" | "customer", name: string): Promise<string | null> {
    const field = api === "vendor" ? "vendorNo" : api === "customer" ? "customerNo" : "no";
    const j = await this.moduleGet(
      `/accurate/api/${api}/list.do?sp.pageSize=5&fields=${field},name&keywords=${encodeURIComponent(name)}`,
      ctx
    );
    const arr = (j.d as Array<Record<string, string>>) ?? [];
    const hit = arr.find((r) => String(r.name ?? "").toLowerCase() === name.toLowerCase()) ?? arr[0];
    return hit ? String(hit[field] ?? "") || null : null;
  }

  async createPurchaseInvoice(ctx: ProviderCtx, data: PurchaseInvoiceInput): Promise<SavedDoc> {
    const vendorNo = await this.resolveByName(ctx, "vendor", data.vendorName.trim());
    if (!vendorNo) throw new Error(`vendor "${data.vendorName}" tidak ditemukan di Accurate`);
    const detailItem: Array<Record<string, unknown>> = [];
    const missing: string[] = [];
    for (const it of (data.items ?? []).slice(0, 50)) {
      const itemNo = await this.resolveByName(ctx, "item", it.name.trim());
      if (itemNo) detailItem.push({ itemNo, quantity: it.qty ?? 1, unitPrice: it.price ?? 0 });
      else missing.push(it.name);
    }
    if (missing.length) throw new Error(`item tidak ditemukan di Accurate: ${missing.join(", ")}`);
    if (!detailItem.length) throw new Error("faktur pembelian butuh minimal 1 item — item tidak terbaca, isi rincian manual");
    const branch = await this.resolveBranchName(ctx);
    const j = await this.modulePost(
      "/accurate/api/purchase-invoice/save.do",
      {
        vendorNo,
        transDate: this.toAccurateDate(data.date),
        ...(branch ? { branchName: branch } : {}),
        billNumber: data.no || `SCAN-${Date.now().toString(36).toUpperCase()}`,
        description: data.description ?? "",
        taxable: false,
        detailItem,
      },
      ctx
    );
    return this.savedDoc(j, "/accurate/api/purchase-invoice/detail.do", ctx);
  }

  async createExpense(ctx: ProviderCtx, data: ExpenseInput): Promise<SavedDoc> {
    const amount = Number(data.total ?? 0);
    if (!(amount > 0)) throw new Error("nominal beban wajib lebih dari 0");
    const all = await this.allAccounts(ctx);
    const hint = data.description ?? "";
    const picked = data.accountNo
      ? all.find((a) => a.no === data.accountNo && this.isLeaf(a))
      : null;
    const expense = picked ?? this.pickAccount(all, /EXPENSE|COGS/i, hint);
    if (!expense) throw new Error("akun beban tidak ditemukan di Accurate");
    const payable = this.pickAccount(all, /^OTHER_CURRENT_LIABILITY$/i, "", true);
    if (!payable) throw new Error("akun liabilitas jangka pendek tidak ditemukan di Accurate");
    const branch = await this.resolveBranchName(ctx);
    const j = await this.modulePost(
      "/accurate/api/expense/save.do",
      {
        transDate: this.toAccurateDate(data.date),
        dueDate: this.toAccurateDate(data.date),
        ...(branch ? { branchName: branch } : {}),
        description: hint,
        expensePayableNo: payable.no,
        detailAccount: [
          { accountNo: expense.no, amount, expenseName: hint.slice(0, 100) || "Beban operasional" },
        ],
      },
      ctx
    );
    return this.savedDoc(j, "/accurate/api/expense/detail.do", ctx);
  }

  async createBankTransfer(ctx: ProviderCtx, data: BankTransferInput): Promise<SavedDoc> {
    const amount = Number(data.total ?? 0);
    if (!(amount > 0)) throw new Error("nominal transfer wajib lebih dari 0");
    const all = await this.allAccounts(ctx);
    // transfer antar rekening sendiri: hanya RUPIAH — akun USD/SGD ditolak API ("mata uang asing")
    const cash = all.filter(
      (a) => a.accountType === "CASH_BANK" && this.isLeaf(a) && !/\b(USD|SGD|EUR|MYR|AUD|JPY)\b/i.test(a.name)
    );
    if (cash.length < 2) throw new Error("rekening kas/bank rupiah daun minimal 2 di Accurate");
    const from = cash.find((a) => a.no === data.fromBankNo);
    const to = cash.find((a) => a.no === data.toBankNo && a.no !== data.fromBankNo);
    if (!from) throw new Error("rekening bank sumber tidak valid / tidak ditemukan");
    if (!to) throw new Error("rekening bank tujuan tidak valid / tidak ditemukan");
    if (from.no === to.no) throw new Error("rekening sumber dan tujuan tidak boleh sama");
    const branch = await this.resolveBranchName(ctx);
    const j = await this.modulePost(
      "/accurate/api/bank-transfer/save.do",
      {
        transDate: this.toAccurateDate(data.date),
        ...(branch ? { branchName: branch } : {}),
        fromBankNo: from.no,
        toBankNo: to.no,
        fromBankAmount: amount,
        description: data.description ?? "",
      },
      ctx
    );
    return this.savedDoc(j, "/accurate/api/bank-transfer/detail.do", ctx);
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
