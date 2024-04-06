import executeDSPL from "./interpreter.mjs";
const codefile = new URL(Deno.args[0], `file://${Deno.cwd()}/`).href;
const outputfile = Deno.args[1];

const code = await import(codefile);

const result = await executeDSPL(code.default);

console.log(JSON.stringify(await result.blackboard._obj, null, 2));
console.log(JSON.stringify(result.history, null, 2));
console.log(result.history.slice(-1)[0].content);

if (Deno.args[1]) {
    await Deno.writeTextFile(
        outputfile,
        JSON.stringify({
            blackboard: await result.blackboard._obj,
            history: result.history,
        })
    );
}
Deno.exit();
