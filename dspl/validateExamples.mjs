// dspl/validate.ts
import { walk } from "https://deno.land/std/fs/mod.ts";
import {
    basename,
    extname,
    resolve,
    fromFileUrl,
    dirname,
} from "https://deno.land/std/path/mod.ts";
import DSPL from "./schemas.mjs";

const examplesDir = "./dspl/examples";
const importDir = "./examples";

async function validateExamples() {
    const currentFileUrl = import.meta.url;
    const currentDir = dirname(fromFileUrl(currentFileUrl));

    for await (const entry of walk(examplesDir)) {
        if (entry.isFile && extname(entry.path) === ".mjs") {
            const fileName = basename(entry.path);
            const filePath = `${importDir}/${fileName}`;

            try {
                const module = await import(filePath);
                const dsplData = module.default;

                const validationResult = DSPL.safeParse(dsplData);

                if (validationResult.success) {
                    console.log(`✅ ${fileName} is valid`);
                } else {
                    console.error(`❌ ${fileName} has validation errors:`);
                    console.error(validationResult.error.issues);
                }
            } catch (error) {
                console.error(`❌ Error importing ${fileName}:`, error.message);
            }
        }
    }
}

validateExamples();
