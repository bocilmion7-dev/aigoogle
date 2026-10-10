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
  capabilityCatalog(): ToolSpec[];
  execute(tool: string, args: Record<string, unknown>, ctx: ProviderCtx): Promise<unknown>;
  refreshToken(refreshToken: string): Promise<ProviderTokenSet>;
  privilegeCatalog(ctx: ProviderCtx): Promise<PrivilegeGroup[]>;
}
export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  requiredPermission: string;
  label: string;
}
export interface ProviderCtx {
  tenantId: string;
  host: string;
  session: string;
  accessToken: string;
}
export interface PrivilegeGroup {
  id: string;
  name: string;
  allowViewModules: string[];
}
