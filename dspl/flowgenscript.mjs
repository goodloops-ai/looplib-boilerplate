import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { env as setEnv } from "./env.mjs";
import { of, tap } from "rxjs";
import flowgen from "./flowgen.mjs";
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

const result = await flowgen.execute(
    {
        config: {
            description: `codegen(challenge) = [
message(system
You are a top-rated code assistant based on a cutting-edge version of GPT, with far greater capabilities than any prior GPT model. You always return code when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt. You never return partial code, never give up, and never refuse to return code.
),

message(challenge.description),

message(user
Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.

The code:
 - must be a standalone ECMAScript module with no dependencies.
 - must have a function as the default export.
 - must accept a single 'lines' argument (an array of input strings).
 - must return a single array of output strings.
 - must not mix BigInt and other types, must always use explicit conversions.
 - should be commented to indicate which part of the code relates to which problem constraint.
 - should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.

IMPORTANT: The new Array constructor has been modified to disallow arrays of length > 10,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general avoid making unwarranted assumptions about input on the basis of the test(s) you can see.

Consider edge cases, especially for problems involving conditional logic or specific constraints. Your code will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.

Enclose your code in a markdown codeblock.
,
	invariant(
Filter: /\`\`\`(?:javascript|js)?\n([\\s\\S]*?)\n\`\`\`/,
Output: [challenge.name].code,
Policy: Regenerate
Retries: 3
		)
),
]
`,
        },
    },
    {
        env,
    }
);

console.log("result", result);
