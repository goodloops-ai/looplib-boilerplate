import executeDSPL from "./interpreter.mjs";
const codefile = new URL(Deno.args[0], `file://${Deno.cwd()}/`).href;
const outputfile = Deno.args[1];
const runs = Deno.args[2] || 1;

const code = await import(codefile);
const start = performance.now();

for (let i = 0; i < runs; i++) {
    const { steps, context } = await executeDSPL(code.default);
    if (Deno.args[1]) {
        await Deno.writeTextFile(
            runs === 1 ? outputfile : `${outputfile}.${i + 1}.of.${runs}`,
            JSON.stringify(
                {
                    code: await Deno.readTextFile(Deno.args[0]),
                    context: {
                        blackboard: await context.blackboard._obj,
                    },
                    steps,
                },
                null,
                2
            )
        );
    }
}

console.log("Execution time:", performance.now() - start);
Deno.exit();
