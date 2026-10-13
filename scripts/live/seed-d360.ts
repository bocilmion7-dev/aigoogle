import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const sets: Array<[string, string]> = [
    ["waProvider", "d360"],
    ["waD360ApiKey", "5EZAFKK9L9LGUZ29WS4FTW9BWUQQ18J2"],
    ["waD360BaseUrl", "https://waba-sandbox.360dialog.io"],
  ];
  for (const [key, value] of sets) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  const check = await prisma.appSetting.findMany({ where: { key: { in: sets.map((s) => s[0]) } } });
  console.log("verifikasi:", check.map((c) => `${c.key}=${c.value.slice(0, 20)}`));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
