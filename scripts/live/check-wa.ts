import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: ["waProvider", "waD360ApiKey", "waD360BaseUrl"] } } });
  for (const r of rows) console.log(r.key, "=", r.value.slice(0, 24));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
