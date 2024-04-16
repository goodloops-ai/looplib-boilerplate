import executeDSPL from "./interpreter.mjs";
const codefile = new URL(Deno.args[0], `file://${Deno.cwd()}/`).href;
const outputfile = Deno.args[1];

const code = await import(codefile);

const { steps, context } = await executeDSPL(code.default);

if (Deno.args[1]) {
    await Deno.writeTextFile(
        outputfile,
        JSON.stringify(
            {
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
Deno.exit();
