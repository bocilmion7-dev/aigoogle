import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveClient } from "../src/drive/google-client.js";

afterEach(() => vi.unstubAllGlobals());

const calls: Array<{ url: string; init?: RequestInit }> = [];
function stub(fetchImpl?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (fetchImpl) return fetchImpl(url, init);
      return new Response(JSON.stringify({ files: [], folders: [] }), { status: 200 });
    })
  );
}

describe("GoogleDriveClient", () => {
  it("list → query files API dengan parents + fields", async () => {
    calls.length = 0;
    stub(
      () =>
        new Response(
          JSON.stringify({ files: [{ id: "a", name: "x.pdf", parents: ["r"], mimeType: "application/pdf" }] }),
          { status: 200 }
        )
    );
    const c = new GoogleDriveClient("tok");
    const r = await c.list("r");
    expect(calls[0].url).toContain("https://www.googleapis.com/drive/v3/files");
    expect(decodeURIComponent(calls[0].url)).toContain("'r' in parents");
    expect(calls[0].init?.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(r.files[0].mimeType).toBe("application/pdf");
  });

  it("createFolder → files POST body folder", async () => {
    calls.length = 0;
    stub((_u, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "n1", name: body.name }), { status: 200 });
    });
    const c = new GoogleDriveClient("tok");
    const f = await c.createFolder("Faktur", "r");
    expect(f.id).toBe("n1");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.mimeType).toBe("application/vnd.google-apps.folder");
    expect(JSON.stringify(body.parents)).toContain("r");
  });

  it("rename → PATCH name", async () => {
    calls.length = 0;
    stub(() => new Response("{}", { status: 200 }));
    const c = new GoogleDriveClient("tok");
    await c.rename("f1", "baru.pdf");
    expect(calls[0].url).toContain("/files/f1");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init?.body)).name).toBe("baru.pdf");
  });

  it("move → PATCH addParents via query param", async () => {
    calls.length = 0;
    stub(() => new Response("{}", { status: 200 }));
    const c = new GoogleDriveClient("tok");
    await c.move("f1", "p2");
    expect(calls[0].url).toContain("/files/f1");
    expect(calls[0].url).toContain("addParents=p2");
    expect(calls[0].init?.method).toBe("PATCH");
  });

  it("getText pdf → alt=media (non-google-doc)", async () => {
    calls.length = 0;
    stub((url) => {
      if (url.includes("alt=media")) return new Response("isi faktur", { status: 200 });
      return new Response(JSON.stringify({ mimeType: "application/pdf" }), { status: 200 });
    });
    const c = new GoogleDriveClient("tok");
    const t = await c.getText("f1");
    expect(t).toContain("isi faktur");
  });

  it("getText google-doc → export text/plain", async () => {
    calls.length = 0;
    stub((url) => {
      if (url.includes("export")) return new Response("isi doc", { status: 200 });
      return new Response(JSON.stringify({ mimeType: "application/vnd.google-apps.document" }), {
        status: 200,
      });
    });
    const c = new GoogleDriveClient("tok");
    expect(await c.getText("g1")).toContain("isi doc");
  });

  it("isDescendant: alias root diresolusi ke ID asli My Drive root", async () => {
    calls.length = 0;
    stub((url) => {
      if (url.includes("/files/root?")) return new Response(JSON.stringify({ id: "REAL-ROOT" }), { status: 200 });
      const id = /\/files\/([^?]+)/.exec(url)?.[1] ?? "";
      const parents: Record<string, string[]> = {
        f1: ["F2"],
        F2: ["REAL-ROOT"],
        luar: ["ID-LUAR-DRIVE"],
      };
      return new Response(JSON.stringify({ parents: parents[id] ?? [] }), { status: 200 });
    });
    const c = new GoogleDriveClient("tok");
    expect(await c.isDescendant("F2", "root")).toBe(true);
    expect(await c.isDescendant("f1", "root")).toBe(true);
    expect(await c.isDescendant("luar", "root")).toBe(false);
    // root id di-cache: resolusi alias cukup sekali
    expect(calls.filter((x) => x.url.includes("/files/root?")).length).toBe(1);
  });
});
