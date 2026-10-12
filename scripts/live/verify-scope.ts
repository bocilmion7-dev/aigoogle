import { prisma } from "../../apps/api/src/db.js";
import { decryptToken } from "../../apps/api/src/crypto.js";

async function main() {
  const cons = await prisma.connection.findMany({
    where: { provider: "accurate", host: { contains: "accurate.id" }, accessTokenEnc: { not: "x.y.z" } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, host: true, tenantId: true, updatedAt: true, accessTokenEnc: true },
  });
  console.log("koneksi:", cons.map((c) => ({ id: c.id, host: c.host, tenantId: c.tenantId, updatedAt: c.updatedAt })));
  for (const c of cons.slice(0, 3)) {
    try {
      const tok = decryptToken(c.accessTokenEnc);
      const r = await fetch("https://account.accurate.id/api/approved-scope.do", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const txt = await r.text();
      let j: any;
      try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 200) }; }
      const list = j?.d ?? j;
      console.log(
        c.tenantId, "→", r.status,
        "scopes:", Array.isArray(list) ? list.length : typeof list,
        "contoh:", Array.isArray(list) ? list.slice(0, 8) : JSON.stringify(j).slice(0, 200)
      );
    } catch (e) {
      console.log(c.tenantId, "ERROR", String(e).slice(0, 150));
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
