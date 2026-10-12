import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, alias: true, createdAt: true } });
  console.log("tenants:", tenants.map((t) => `${t.id.slice(-6)} ${t.name} (${t.createdAt.toISOString()})`));
  const users = await prisma.user.findMany({ select: { id: true, email: true, tenantId: true }, take: 6 });
  console.log("users:", users.map((u) => `${u.email}→${u.tenantId.slice(-6)}`));
  const evs = await prisma.accurateWebhookEvent.groupBy({ by: ["tenantId"], _count: true });
  console.log("events per tenant:", evs.map((e) => `${e.tenantId.slice(-6)}:${e._count}`));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
