import { db } from "../src/lib/db";
async function main() {
  const items = await db.menuItem.findMany({ select: { name: true, ingredients: true }, take: 40 });
  const withIng = items.filter(i => i.ingredients && i.ingredients.trim().length > 0);
  console.log("total:", items.length, "| with ingredients:", withIng.length);
  for (const i of withIng.slice(0, 12)) console.log("-", i.name, "=>", i.ingredients!.slice(0, 80));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
