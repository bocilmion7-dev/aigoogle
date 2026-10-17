import { describe, expect, it } from "vitest";
import {
  listDbs, getDb, listUsers, getUser,
  issueCode, exchangeCode, issueAccess, issueRefresh, useRefresh, userFromBearer,
  createSession, resolveSession,
} from "../src/store.js";

describe("store", () => {
  it("menyediakan 2 db & 3 user fixture", () => {
    expect(listDbs()).toHaveLength(2);
    expect(listUsers().map((u) => u.id)).toEqual(["user-admin", "user-staff", "user-platform"]);
    expect(getDb("1001")?.name).toBe("PT Maju Jaya");
  });

  it("siklus kode OAuth: issue → exchange", () => {
    const code = issueCode("user-admin");
    expect(exchangeCode(code)).toBe("user-admin");
    expect(exchangeCode(code)).toBeNull();
  });

  it("siklus access & refresh token", () => {
    const at = issueAccess("user-admin");
    expect(userFromBearer(`Bearer ${at}`)).toBe("user-admin");
    const rt = issueRefresh("user-admin");
    expect(useRefresh(rt)).toBe("user-admin");
    expect(useRefresh(rt)).toBeNull();
  });

  it("siklus session: create → resolve → expired", () => {
    const sid = createSession("1001", "user-admin");
    expect(resolveSession(sid)).toMatchObject({ dbId: "1001", userId: "user-admin" });
    expect(resolveSession("sess-nihil")).toBeNull();
  });
});
