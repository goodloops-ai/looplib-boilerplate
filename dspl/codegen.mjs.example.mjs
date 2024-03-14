import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { env as setEnv } from "./env.mjs";
import { of, tap } from "rxjs";
import codegenFlow from "./codegenFlow.mjs"; // Assuming the flow we created is named codegenFlow.mjs
import { start } from "./env.mjs";

await load({ export: true });

const env = {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
    model: "gpt-3.5-turbo",
    temperature: 0.3,
    max_tokens: 4000,
};

const challenge = {
    description: "Write a function that reverses a string.",
    name: "reverseString",
};

const result = await codegenFlow.execute(
    {
        config: {
            challenge,
            model: env.model, // This can be overridden here if needed
            temperature: env.temperature, // This can be overridden here if needed
        },
    },
    {
        env,
    }
);

console.log("result", result);