import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { env as setEnv } from "./env.mjs";
import { of, tap, catchError } from "rxjs";
import runChallenges from "./runallchallenges.mjs";
import { start } from "./env.mjs";
import { runTests } from "./testHarness.mjs";

await load({ export: true });

const env = {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
    model: "gpt-3.5-turbo",
    temperature: 0.3,
};

const challenges = JSON.parse(
    Deno.readTextFileSync("./dspl/challenges.json")
).slice(0, 1);

// const challenges = [
//     {
//         description: "Write a function that reverses a string.",
//         name: "ReverseString",
//         public_tests: [
//             {
//                 input: ["hello"],
//                 output: ["olleh"],
//             },
//             {
//                 input: ["world"],
//                 output: ["dlrow"],
//             },
//         ],
//     },
//     {
//         description:
//             "Write a function that computes the factorial of a number.",
//         name: "Factorial",
//         public_tests: [
//             {
//                 input: ["5"],
//                 output: ["120"],
//             },
//             {
//                 input: ["3"],
//                 output: ["6"],
//             },
//         ],
//     },
// ];

const runTest = async (code, test) => {
    try {
        console.log("code", code);
        console.log("test", test);
        const blob = new Blob([code], {
            type: "application/javascript",
        });
        const url = URL.createObjectURL(blob);
        console.log("code url", code);
        const module = await import(url);
        const { input, output } = test;
        const result = module.default(input);
        return {
            status: result.join("\n") === output.join("\n") ? "pass" : "fail",
            message: `Expected ${output}, got ${result}`,
        };
    } catch (error) {
        return {
            status: "error",
            error: error.name,
            message: error.message,
        };
    }
};

runChallenges
    .start(
        {
            config: {
                challenges,
                runTests,
                model: env.model,
                temperature: env.temperature,
            },
        },
        {
            env,
        }
    )
    .pipe(
        catchError((e) => {
            console.error("error", e);
            Deno.exit(1);
        })
    )
    .subscribe((res) => {
        console.log("res", res);
    });
