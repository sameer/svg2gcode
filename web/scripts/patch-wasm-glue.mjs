import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const targetPath = path.resolve("src/wasm/pkg/svg2gcode_wasm.js");
const source = await readFile(targetPath, "utf8");

const original = `__wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },`;

const replacement = `__wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            let offset;
            try {
                offset = table.grow(4);
            } catch (error) {
                if (table.length < 4) {
                    throw error;
                }
                offset = table.length - 4;
                console.warn("Falling back to Safari-compatible externref table initialization.", error);
            }
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },`;

if (!source.includes(original)) {
  if (source.includes("__wbindgen_init_externref_table")) {
    throw new Error(`Expected externref initializer block not found in ${targetPath}`);
  }
  process.exit(0);
}

await writeFile(targetPath, source.replace(original, replacement), "utf8");
