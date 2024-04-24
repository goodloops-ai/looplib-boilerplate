import { assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { walk } from "https://deno.land/std/fs/mod.ts";

Deno.test("Run all DSPL examples sequentially", async () => {
    const examplesDir = "./dspl/examples";
    const outputDir = "./dspl/test_outputs";

    // Ensure the output directory exists
    await Deno.mkdir(outputDir, { recursive: true });

    // Find all .mjs files in the examples directory
    const exampleFiles = [];
    for await (const entry of walk(examplesDir, {
        exts: ["mjs"],
        includeDirs: false,
    })) {
        exampleFiles.push(entry.path);
    }

    // Run each example file sequentially
    for (const file of exampleFiles) {
        const outputFile = `${outputDir}/${file
            .split("/")
            .pop()
            .replace(".mjs", ".json")}`;
        const cmd = ["deno", "run", "-A", "dspl/runner.mjs", file, outputFile];

        const process = Deno.run({
            cmd,
            stdout: "piped",
            stderr: "piped",
        });

        const { code } = await process.status();
        const output = await process.output();
        const error = await process.stderrOutput();

        // Log the stdout for each file as it runs
        console.log(`Output for ${file}:`);
        console.log(new TextDecoder().decode(output));

        process.close();

        // Assert that the process exited with code 0
        assertEquals(code, 0, `Test failed for ${file}: ${error}`);
    }
});
