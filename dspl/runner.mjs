import executeDSPL from "./interpreter.mjs";
const codefile = new URL(Deno.args[0], `file://${Deno.cwd()}/`).href;

const code = await import(codefile);

const result = await executeDSPL(code.default);

console.log(JSON.stringify(await result.blackboard._obj, null, 2));
console.log(JSON.stringify(result.history, null, 2));
Deno.exit();
