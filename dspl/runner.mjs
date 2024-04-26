import executeDSPL from "./interpreter.mjs";
const codefile = new URL(Deno.args[0], `file://${Deno.cwd()}/`).href;
const outputfile = Deno.args[1];
const runs = Deno.args[2] || 1;

const code = await import(codefile);
const start = performance.now();

for (let i = 0; i < runs; i++) {
    const thisstart = performance.now();
    const { steps, context } = await executeDSPL(code.default);
    const thistime = Math.round((performance.now() - thisstart) / 60000);
    if (Deno.args[1]) {
        await Deno.writeTextFile(
            runs === 1 ? outputfile : `${outputfile}.${i + 1}.of.${runs}`,
            JSON.stringify(
                {
                    time: thistime,
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

console.log(
    "Execution time:",
    Math.round((performance.now() - start) / 60000) + "mins"
);
Deno.exit();
