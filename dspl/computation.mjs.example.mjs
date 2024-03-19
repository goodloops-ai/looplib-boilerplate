import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { env as setEnv } from "./env.mjs";
import { of, tap } from "rxjs";
import flowgen from "./flowgen.mjs";
import { start } from "./env.mjs";
import * as computation from "./computation.mjs";

await load({ export: true });

const env = {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
};

// Define a simple computation function
function addNumbers(input) {
    const { num1, num2 } = input;
    return { sum: num1 + num2 };
}

const result = await flowgen.execute(
    {
        config: {
            description: `computation = [
                return addNumbers(input: { num1: 5, num2: 10 }) : { sum: 15 }
            ]`,
            computation: {
                fn: addNumbers,
            },
        },
    },
    {
        env,
    }
);

console.log("result", result);