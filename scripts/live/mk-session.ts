import { prisma } from "../../apps/api/src/db.js";
import { randomBytes } from "node:crypto";
async function main() {
  const t = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!t) throw new Error("tidak ada tenant");
  const u = await prisma.user.findFirst({ where: { tenantId: t.id } });
  if (!u) throw new Error("tidak ada user di tenant pertama");
  const sid = randomBytes(24).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
  console.log("SID=" + sid);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
