import type {
  AccountingProvider,
  OpenDbResult,
  ProviderDb,
  ProviderTokenSet,
  ProviderUser,
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
    const j = await this.getEnvelope<{ id: string; email: string; name: string }>(
      "/api/userinfo.do",
      accessToken
    );
    return { providerUserId: j.d.id, email: j.d.email, name: j.d.name };
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
}
