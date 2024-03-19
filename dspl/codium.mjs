import { pipe, of } from "rxjs";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";
import message from "./message.mjs";
import prompt from "./prompt.mjs";

const codegenSchema = z.object({
    challenge: z.object({
        description: z.string(),
        name: z.string(),
        public_tests: z.array(z.any()), // Simplified for example purposes
    }),
    runTest: z.function().args(z.any(), z.any()).returns(z.any()),
});

const operator = ({ challenge, runTest }) =>
    pipe(
        message({
            role: "system",
            content:
                "You are a top-rated code assistant based on a cutting-edge version of GPT, with far greater capabilities than any prior GPT model. You always return code when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt. You never return partial code, never give up, and never refuse to return code.",
        }),
        message({
            role: "user",
            content: challenge.description,
        }),
        message({
            role: "user",
            content: `Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.

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
      
      Enclose your code in a markdown codeblock.`,
        }),
        prompt({
            role: "user",
            content: "Please generate the solution code.",
            gptOptions: {
                model: "gpt-3.5-turbo",
                temperature: 0.7,
                OPENAI_API_KEY: "", // Assume the environment variable is set
            },
            invariants: [
                {
                    type: "parse",
                    parse: /\`\`\`(?:javascript|js)?\n([\s\S]*?)\n\`\`\`/,
                    output: `${challenge.name}.code`,
                    maxRetries: 3,
                },
                {
                    type: "compute",
                    inputs: [`${challenge.name}.code`],
                    compute: ([code]) =>
                        Promise.all(
                            challenge.public_tests.map((test) =>
                                runTest(code, test)
                            )
                        ),
                    output: `${challenge.name}.publicTestResults`,
                },
                {
                    type: "filter",
                    filter: ([testResults]) =>
                        testResults.every((result) => result.status === "pass"),
                    inputs: [`${challenge.name}.publicTestResults`],
                    description: "The code must pass the public tests",
                    recovery_prompt: `
            Here are the results of testing your code:
            {{#each ${challenge.name}.publicTestResults}}
                - Test Result: {{@index}} - 
                {{#if this.status}}
                Success: {{this.message}}. Congratulations, no errors detected!
                {{else if (eq this.error "SyntaxError")}}
                Syntax Error Detected: {{this.message}}. Please check your syntax.
                {{else if (eq this.error "Timeout")}}
                Timeout Error: {{this.message}}. Consider optimizing your code for better performance.
                {{else if (eq this.error "RuntimeError")}}
                Runtime Error: {{this.message}}. Ensure all variables are defined and accessible.
                {{else if (eq this.error "TypeError")}}
                Type Error: {{this.message}}. Verify that your data types are correct.
                {{else}}
                Unknown Error: {{this.message}}. Review the code for potential issues.
                {{/if}}
            {{/each}}
            `,
                    maxRetries: 6,
                    output: `${challenge.name}.public_tests`,
                },
            ],
        })
    );

export const schema = base.extend({
    config: codegenSchema,
    input: z.object({}),
    output: z.object({}),
});

export default wrap({ operator, schema });
