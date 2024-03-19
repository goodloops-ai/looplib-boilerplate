import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { env as setEnv } from "./env.mjs";
import { of, tap } from "rxjs";
import codegenFlow from "./codium.mjs"; // Assuming the previously defined flow is saved as codegenFlow.mjs
import { start } from "./env.mjs";

await load({ export: true });

const env = {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
    model: "gpt-3.5-turbo", // Default model, can be overridden in the flow config if needed
    temperature: 0.7, // Default temperature, can be overridden in the flow config if needed
};

const challengeDescription = "Write a function that reverses a string.";
const challengeName = "reverseString";
const tests = [
    { input: ["hello"], expected: ["olleh"] },
    { input: ["world"], expected: ["dlrow"] },
];

const result = await codegenFlow.execute(
    {
        config: {
            challenge: {
                name: challengeName,
                description: challengeDescription,
                public_tests: tests,
            },
            runTest: async (code, test) => {
                try {
                    const blob = new Blob([code], {
                        type: "application/javascript",
                    });
                    const url = URL.createObjectURL(blob);
                    console.log("code url", code);
                    const module = await import(url);
                    const { input, expected } = test;
                    const result = module.default(input);
                    return {
                        status:
                            result.join("\n") === expected.join("\n")
                                ? "pass"
                                : "fail",
                        message: `Expected ${expected}, got ${result}`,
                    };
                } catch (error) {
                    return {
                        status: "error",
                        error: error.name,
                        message: error.message,
                    };
                }
            },
        },
    },
    {
        env,
    }
);

console.log("result", result);
