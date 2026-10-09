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

  it("authorize ?user=staff → userinfo.do sebut staff", async () => {
    const tok = await login("staff");
    const info = await request(app).get("/api/userinfo.do").set("Authorization", `Bearer ${tok.access_token}`);
    expect(info.status).toBe(200);
    expect(info.body.s).toBe(true);
    expect(info.body.d).toMatchObject({ id: "user-staff", email: "staff@demo.local" });
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

  it("userinfo.do tanpa token → 401", async () => {
    const res = await request(app).get("/api/userinfo.do");
    expect(res.status).toBe(401);
  });
});
