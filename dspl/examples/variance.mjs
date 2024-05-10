//deno run -A --v8-flags=--max-old-space-size=8192 ./dspl/runner.mjs ./dspl/examples/dcl.mjs dcl-0r-json-sorted.json

import { importJson } from "../mem.mjs";
import { runTests } from "../testHarness.quickjs.mjs";
import _ from "lodash";
import YAML from "yaml";
const fullchallenges = {
    elements: [
        {
            type: "import",
            import: {
                _: "https://esm.sh/lodash",
                Formula: "https://esm.sh/",
                runTests: "./testHarness.quickjs.mjs",
                importJson: "./mem.mjs",
                mem: "./mem.mjs",
            },
        },
        {
            type: "init",
            init: {
                $: {
                    prompt: {
                        model: "gpt-4-turbo-2024-04-09",
                        temperature: 0.3,
                    },
                },
                challengeFile: "./dspl/challenges.withTitles.json",
                challenges: {
                    get: ({ challengeFile }) =>
                        importJson(challengeFile, {
                            public_test_results: {
                                get: async ({ public_tests, code }) =>
                                    runTests(code, public_tests),
                            },
                            public_tests_passed: {
                                get: ({ public_test_results }) =>
                                    public_test_results?.length &&
                                    _.every(public_test_results, [
                                        "status",
                                        "pass",
                                    ]),
                            },
                            yaml: {
                                get: async ({
                                    index,
                                    name,
                                    description,
                                    public_test_original,
                                }) => {
                                    // console.log(
                                    //     "public_test_original",
                                    //     public_test_original
                                    // );
                                    // Deno.exit(1);
                                    return YAML.stringify({
                                        index,
                                        name,
                                        description,
                                        public_tests: public_test_original,
                                    });
                                },
                            },
                            json: {
                                get: async ({
                                    index,
                                    name,
                                    description,
                                    //    public_test_original,
                                }) =>
                                    JSON.stringify(
                                        {
                                            index,
                                            name,
                                            description,
                                            //            public_tests: public_test_original,
                                        },
                                        null,
                                        2
                                    ),
                            },
                            // yaml2: {
                            //     get: async ({ public_tests_original }) =>
                            //         YAML.stringify({
                            //             public_tests: public_tests_original,
                            //         }),
                            // },
                            private_test_results: {
                                get: async ({
                                    public_tests_passed,
                                    private_tests,
                                    code,
                                }) =>
                                    public_tests_passed
                                        ? await runTests(code, private_tests, {
                                              breakOnFailure: true,
                                          })
                                        : [],
                            },
                            private_tests_passed: {
                                get: ({
                                    private_tests,
                                    private_test_results,
                                }) =>
                                    !private_tests.length ||
                                    (private_test_results?.length &&
                                        _.every(private_test_results, [
                                            "status",
                                            "pass",
                                        ])),
                            },
                            generated_test_results: {
                                get: async ({
                                    public_tests_passed,
                                    private_tests_passed,
                                    generated_tests,
                                    code,
                                }) =>
                                    public_tests_passed && private_tests_passed
                                        ? await runTests(
                                              code,
                                              generated_tests,
                                              {
                                                  breakOnFailure: true,
                                              }
                                          )
                                        : [],
                            },
                            generated_tests_passed: {
                                get: ({
                                    generated_tests,
                                    generated_test_results,
                                }) =>
                                    !generated_tests.length ||
                                    (generated_test_results?.length &&
                                        _.every(generated_test_results, [
                                            "status",
                                            "pass",
                                        ])),
                            },
                            tests_passed: {
                                get: ({
                                    public_tests_passed,
                                    private_tests_passed,
                                    generated_tests_passed,
                                }) => {
                                    return (
                                        public_tests_passed &&
                                        private_tests_passed &&
                                        generated_tests_passed
                                    );
                                },
                            },
                        }),
                },
                challengesJSON: {
                    get: async ({ challenges }) => {
                        return JSON.stringify(
                            await Promise.all(
                                challenges.map(async (c) => {
                                    return {
                                        name: await c.name,
                                        variance: await c.variance,
                                        solutions: (await c.solutions).length,
                                        passed: await Promise.all(
                                            (
                                                await c.solutions
                                            ).map((s) => s.tests_passed)
                                        ).then((all) =>
                                            all.reduce(
                                                (a, b) => a + (b ? 1 : 0),
                                                0
                                            )
                                        ),
                                    };
                                })
                            ),
                            null,
                            2
                        );
                    },
                },
            },
        },
        {
            type: "do",
            for: {
                each: "challenge",
                in: "$.challenges",
                concurrency: 50,
            },
            dspl: {
                elements: [
                    {
                        type: "message",
                        role: "system",
                        content:
                            "You are a top-rated code assistant based on a cutting-edge version of GPT, with far greater capabilities than any prior GPT model.You always return code when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt.You never return partial code, never give up, and never refuse to return code.",
                    },
                    // {
                    //     type: "message",
                    //     role: "user",
                    //     content: "{{await model.challenge.yaml}}",
                    // },
                    {
                        type: "message",
                        role: "user",
                        content: "{{await model.challenge.json}}",
                    },
                    {
                        type: "prompt",
                        n: 4,
                        temperature: 0.3,
                        content: `Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.

The code:
- must be written in modern, idiomatic JavaScript.
- must not mix BigInt and other types, must always use explicit conversions.
- should be commented to indicate which part of the code relates to which problem constraint.
- must be a standalone ECMAScript module with no dependencies.
- must have a function as the default export.
- must accept a single 'lines' argument (an array of input strings).
- must return a single array of output strings.
- must not mix BigInt and other types, must always use explicit conversions.
- should be commented to indicate which part of the code relates to which problem constraint.
- should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.

Enclose your code in a markdown codeblock.`,
                        parse: {
                            // code: "item.code",
                            "challenge.solutions": (
                                responses,
                                { challenge }
                            ) => {
                                return responses
                                    .map(
                                        (response) =>
                                            /```(?:javascript|js)?\n([\s\S]*?)\n```/.exec(
                                                response
                                            )?.[1]
                                    )
                                    .map((code) => challenge._clone({ code }));
                            },
                        },
                    },
                    {
                        type: "message",
                        role: "user",
                        content: `{{#each solution in await model.challenge.solutions}}
Solution:
{{await solution.code}}

Public tests:
{{#each res in await solution.public_test_results}}
    - Test Result: {{scope.index}} -
    {{#if await res.status == "pass"}}
    Success: {{await res.message}}. Congratulations, no errors detected!
    {{#elseif await res.error == "SyntaxError"}}
    Syntax Error Detected: {{await res.message}}. Please check your syntax.
    {{#elseif await res.error == "Timeout"}}
    Timeout Error: {{await res.message}}. Consider optimizing your code for better performance.
    {{#elseif await res.error == "RuntimeError"}}
    Runtime Error: {{await res.message}}. Ensure all variables are defined and accessible.
    {{#elseif await res.error == "TypeError"}}
    Type Error: {{await res.message}}. Verify that your data types are correct.
    {{#else}}
    Unknown Error: {{await res.message}}. Review the code for potential issues.
    {{/if}}
{{/each}}
{{/each}}`,
                    },
                    {
                        type: "prompt",
                        temperature: 0.3,
                        content: `Carefully review the solutions provided. Please identify the dimensions where the solutions disagree with each other in terms of implementation.`,
                    },
                    {
                        type: "prompt",
                        mode: "json",
                        content: `provide a variance score from 0 to 10 on how much variance there is across these solutions. 0 means they are identical, 10 means they are completely different. Provide a brief explanation of the variance score. put your score in the "score" property of your output.`,
                        parse: {
                            "challenge.variance": (response) => response.score,
                        },
                    },
                ],
            },
        },
        {
            type: "message",
            content: `{{await model.$.challengesJSON}}`,
        },
    ],
};

export default fullchallenges;
