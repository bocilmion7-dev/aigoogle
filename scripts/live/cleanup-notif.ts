import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const t = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!t) process.exit(0);
  const r = await prisma.appSetting.deleteMany({ where: { key: { in: [`wa:webhook_events:${t.id}`, `wa:owner_phone:${t.id}`, `wa:webhook_rate:${t.id}`] } } });
  console.log("config uji webhook-notif dihapus:", r.count);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
