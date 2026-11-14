import { readFile } from "node:fs/promises";
import LegacyApp from "./legacy-app";

export default async function Home() {
  const source = await readFile("index.html", "utf8");
  const shell = source.match(/<body>([\s\S]*?)<script type="module" src="\.\/src\/app\.js"><\/script>/)?.[1];
  if (!shell) throw new Error("LegacyShellMissing");

  return <LegacyApp shell={shell} />;
}
