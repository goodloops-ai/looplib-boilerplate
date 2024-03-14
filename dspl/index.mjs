import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { env as setEnv } from "./env.mjs";
import { of, tap } from "rxjs";
import { codegen } from "./codegen.mjs";
import { start } from "./env.mjs";
import { testSolution1 } from "../examples/alphacode/codium.mjs";
import * as gpt from "./gpt.mjs";
import * as prompt from "./prompt.mjs";
import * as message from "./message.mjs";

await load({ export: true });

const env = {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
    model: "gpt-4-0125-preview",
    temperature: 0.3,
    max_tokens: 4000,
    onContent: ({ chunk }) =>
        Deno.stdout.write(new TextEncoder().encode(chunk)),
};

start({
    env,
})
    .pipe(
        codegen({
            challenge: {
                name: "three little pigs",
                description:
                    "Three little pigs from all over the world are meeting for a convention! Every minute, a triple of 3 new pigs arrives on the convention floor. After the n-th minute, the convention ends.\n\nThe big bad wolf has learned about this convention, and he has an attack plan. At some minute in the convention, he will arrive and eat exactly x pigs. Then he will get away.\n\nThe wolf wants Gregor to help him figure out the number of possible attack plans that involve eating exactly x pigs for various values of x (1 ≤ x ≤ 3n). Two attack plans are considered different, if they occur at different times or if the sets of little pigs to eat are different.\n\nNote that all queries are independent, that is, the wolf does not eat the little pigs, he only makes plans!\n\nInput\n\nThe first line of input contains two integers n and q (1 ≤ n ≤ 10^6, 1 ≤ q ≤ 2⋅ 10^5), the number of minutes the convention lasts and the number of queries the wolf asks.\n\nEach of the next q lines contains a single integer x_i (1 ≤ x_i ≤ 3n), the number of pigs the wolf will eat in the i-th query.\n\nOutput\n\nYou should print q lines, with line i representing the number of attack plans if the wolf wants to eat x_i pigs. Since each query answer can be large, output each answer modulo 10^9+7.\n\nExamples\n\nInput\n\n\n2 3\n1\n5\n6\n\n\nOutput\n\n\n9\n6\n1\n\n\nInput\n\n\n5 4\n2\n4\n6\n8\n\n\nOutput\n\n\n225\n2001\n6014\n6939\n\nNote\n\nIn the example test, n=2. Thus, there are 3 pigs at minute 1, and 6 pigs at minute 2. There are three queries: x=1, x=5, and x=6.\n\nIf the wolf wants to eat 1 pig, he can do so in 3+6=9 possible attack plans, depending on whether he arrives at minute 1 or 2.\n\nIf the wolf wants to eat 5 pigs, the wolf cannot arrive at minute 1, since there aren't enough pigs at that time. Therefore, the wolf has to arrive at minute 2, and there are 6 possible attack plans.\n\nIf the wolf wants to eat 6 pigs, his only plan is to arrive at the end of the convention and devour everybody.\n\nRemember to output your answers modulo 10^9+7!",
            },
        }),
        tap((result) => console.log("codegen result", result))
    )
    .subscribe({
        next: (value) => console.log(value),
        error: (error) => console.error(error),
        complete: () => console.log("Complete"),
    });
