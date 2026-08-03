// Worker izvori koriste bezekstenzijske importe (`./db`, `./api`) jer ih
// bundler (esbuild/wrangler) razrješava sam. Node ih po ESM pravilima NE
// razrješava, pa ovaj hook mapira `./x` → `./x.ts` kad takav fajl postoji.
// Time testovi učitavaju PRAVI produkcijski kod bez ijedne izmjene u worker/.
// Obrazac: rodjendaonice/apps/marketplace/worker-tests/loader.mjs
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const candidate = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: pathToFileURL(fileURLToPath(candidate)).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
