import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const cons = await prisma.connection.findMany({ select: { tenantId: true, host: true } });
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, alias: true, createdAt: true } });
  const real = new Map<string, string>();
  for (const c of cons) if (/accurate\.id/.test(c.host)) real.set(c.tenantId, c.host);
  console.log("TENANT NYATA (koneksi Accurate asli):");
  for (const t of tenants) if (real.has(t.id)) console.log(" -", t.name, `(${t.alias})`, real.get(t.id));
  console.log("TENANT LAIN (test/mock):", tenants.filter((t) => !real.has(t.id)).length, "buah");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
