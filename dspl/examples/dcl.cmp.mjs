//deno run -A --v8-flags=--max-old-space-size=8192 ./dspl/runner.mjs ./dspl/examples/dclnext.mjs dclnextx20x9x4-nosys-t0.7x0.4-4o-oai-a.json

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
                        model: "gpt-4o",
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
                        }).then((c) => c.slice(0, 105)),
                },
                summary: {
                    get: async ({ challengesJSON }) => {
                        return challengesJSON.reduce(
                            (acc, c) => {
                                return {
                                    total: acc.total + 1,
                                    passed: acc.passed + c.tests_passed,
                                    public_tests_passed:
                                        acc.public_tests_passed +
                                        c.public_tests_passed,
                                    private_tests_passed:
                                        acc.private_tests_passed +
                                        c.private_tests_passed,
                                    generated_tests_passed:
                                        acc.generated_tests_passed +
                                        c.generated_tests_passed,
                                };
                            },
                            {
                                total: 0,
                                passed: 0,
                                public_tests_passed: 0,
                                private_tests_passed: 0,
                                generated_tests_passed: 0,
                            }
                        );
                    },
                },
                challengesJSON: {
                    get: async ({ challenges }) => {
                        return JSON.stringify(
                            await Promise.all(
                                challenges.map(async (c) => {
                                    return {
                                        name: await c.name,
                                        code: await c.code,
                                        tests_passed: await c.tests_passed,
                                        public_tests_passed:
                                            await c.public_tests_passed,
                                        private_tests_passed:
                                            await c.private_tests_passed,
                                        generated_tests_passed:
                                            await c.generated_tests_passed,
                                        public_test_results:
                                            await c.public_test_results,
                                        private_test_results:
                                            await c.private_test_results,
                                        generated_test_results:
                                            await c.generated_test_results,
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
                    // {
                    //     type: "message",
                    //     role: "system",
                    //     content:
                    //         "You are a top-rated code assistant based on a cutting-edge version of GPT, with far greater capabilities than any prior GPT model.You always return code when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt.You never return partial code, never give up, and never refuse to return code.",
                    // },
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
                        n: 28,
                        temperature: 0.7,
                        content: `Solve the programming challenge following the rules and constraints as closely as possible.

The code:
- must not use 'const', always use 'let'
- should be commented to indicate which part of the code relates to which problem constraint
- must be a standalone ECMAScript module with no dependencies
- must have a function as the default export
- must accept a single 'lines' argument (an array of input strings), being mindful that the last element may be an empty string.
- must return a single array of output strings
- should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right

Enclose your code in a markdown codeblock.`,
                        // parse: {
                        //     // code: "item.code",
                        //     "$.solutions": (responses, { challenge }) => {
                        //         return responses
                        //             .map(
                        //                 (response) =>
                        //                     /```(?:javascript|js)?\n([\s\S]*?)\n```/.exec(
                        //                         response
                        //                     )?.[1]
                        //             )
                        //             .map((code) => challenge._clone({ code }));
                        //     },
                        // },
                        // },
                        //                     {
                        //                         type: "message",
                        //                         role: "user",
                        //                         content: `{{#each solution in await model.$.solutions}}
                        // Solution:
                        // {{await solution.code}}

                        // Public tests:
                        // {{#each res in await solution.public_test_results}}
                        //     - Test Result: {{scope.index}} -
                        //     {{#if await res.status == "pass"}}
                        //     Success: {{await res.message}}. Congratulations, no errors detected!
                        //     {{#elseif await res.error == "SyntaxError"}}
                        //     Syntax Error Detected: {{await res.message}}. Please check your syntax.
                        //     {{#elseif await res.error == "Timeout"}}
                        //     Timeout Error: {{await res.message}}. Consider optimizing your code for better performance.
                        //     {{#elseif await res.error == "RuntimeError"}}
                        //     Runtime Error: {{await res.message}}. Ensure all variables are defined and accessible.
                        //     {{#elseif await res.error == "TypeError"}}
                        //     Type Error: {{await res.message}}. Verify that your data types are correct.
                        //     {{#else}}
                        //     Unknown Error: {{await res.message}}. Review the code for potential issues.
                        //     {{/if}}
                        // {{/each}}
                        // {{/each}}`,
                    },
                    {
                        type: "prompt",
                        content: `Carefully review and classify the solutions provided to identify clusters of solutions that are similar to each other based on their approach to solving the problem. For each cluster, count the number of solutions that are contained in it and identify any obvious flaws and note if any of them are insurmountable.`,
                    },
                    {
                        type: "prompt",
                        n: 9,
                        temperature: 0.4,
                        content: `Solve the programming challenge following the rules and constraints as closely as possible. Produce a solution on the basis of the approach taken in one of the largest clusters identified above, composing a solution out of the best ideas from the solutions in the cluster and mitigating any weaknesses identified.

The code:
- must not use 'const', always use 'let'
- should be commented to indicate which part of the code relates to which problem constraint
- must be a standalone ECMAScript module with no dependencies
- must have a function as the default export
- must accept a single 'lines' argument (an array of input strings), being mindful that the last element may be an empty string.
- must return a single array of output strings
- should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right

Enclose your code in a markdown codeblock.`,
                        parse: {
                            // parse: {
                            //     // code: "item.code",
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
                            // },
                            // code: "item.code",
                            "challenge.sortedSolutions": async (
                                response,
                                { challenge }
                            ) => {
                                const candidates = [];
                                for (const solution of await challenge.solutions) {
                                    candidates.push({
                                        solution,
                                        code: await solution.code,
                                        pass: await solution.public_tests_passed,
                                        public_test_results:
                                            await solution.public_test_results,
                                    });
                                }
                                candidates.sort((a, b) => {
                                    if (a.pass && !b.pass) {
                                        return -1;
                                    }
                                    if (b.pass && !a.pass) {
                                        return 1;
                                    }
                                    if (a.pass && b.pass) {
                                        const aTime =
                                            a.public_test_results.reduce(
                                                (acc, cur) => acc + cur.time,
                                                0
                                            );
                                        const bTime =
                                            b.public_test_results.reduce(
                                                (acc, cur) => acc + cur.time,
                                                0
                                            );
                                        return aTime - bTime;
                                    }
                                    if (!a.pass && !b.pass) {
                                        const aTime =
                                            a.public_test_results.reduce(
                                                (acc, cur) => acc + cur.time,
                                                0
                                            );
                                        const bTime =
                                            b.public_test_results.reduce(
                                                (acc, cur) => acc + cur.time,
                                                0
                                            );
                                        return aTime - bTime;
                                    }
                                    return 0;
                                });
                                return candidates;
                            },
                            "challenge.bestSolution": async (
                                _,
                                { challenge }
                            ) => {
                                return challenge.sortedSolutions[0];
                            },
                            "challenge.bestSolutionPassed": async (
                                _,
                                { challenge }
                            ) => {
                                return challenge.bestSolution.pass;
                            },
                        },
                        retries: 0,
                        guards: [
                            {
                                type: "filter",
                                filter: "challenge.bestSolutionPassed",
                                policy: "retry",
                            },
                        ],
                        onSuccess: [
                            {
                                type: "message",
                                content: " ",
                                parse: {
                                    "challenge.code": async (
                                        response,
                                        { challenge }
                                    ) => {
                                        console.log(
                                            await challenge.bestSolution
                                        );
                                        const bestSolution =
                                            await challenge.bestSolution;
                                        return bestSolution.code;
                                    },
                                },
                            },
                        ],
                        onFail: [
                            {
                                type: "prompt",
                                role: "user",
                                temperature: 0.4,
                                n: 3,
                                content: `
                                The best solution did not pass all the public tests. Please try again.
                                Best Solution:
                                {{(await model.challenge.bestSolution).code}}

                                Test Results:
                                {{#each res in await model.challenge.public_test_results}}
                                    - Test Result: {{scope.index}} - {{await res.status}} - {{await res.message}}
                                {{/each}}
                                
                                Review the progression so far, and brainstorm on what may help improve the code so that it satisfies all requirements. Carefully read and reflect on the failure(s) and identify what part of the code is at fault. Consider whether a minor change or a deep reconsideration of strategy is in order. Do not fix the code until I ask you to.`,
                            },
                            {
                                type: "prompt",
                                role: "user",
                                content: `
                                Produce a solution on the basis of the results of the brainstorm. If you notice obvious, uncontested improvements, please do make them.

                                The code:
                                - must not use 'const', always use 'let'
                                - should be commented to indicate which part of the code relates to which problem constraint
                                - must be a standalone ECMAScript module with no dependencies
                                - must have a function as the default export
                                - must accept a single 'lines' argument (an array of input strings), being mindful that the last element may be an empty string.
                                - must return a single array of output strings
                                - should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right
                                
                                Enclose your code in a markdown codeblock.
                                `,
                                retries: 5,
                                parse: {
                                    "challenge.code": (
                                        response,
                                        { challenge }
                                    ) => {
                                        return /```(?:javascript|js)?\n([\s\S]*?)\n```/.exec(
                                            response
                                        )?.[1];
                                    },
                                },
                                guards: [
                                    {
                                        type: "filter",
                                        filter: "challenge.public_tests_passed",
                                        policy: "append",
                                        overrides: {
                                            type: "prompt",
                                            content: `
                                            The best solution did not pass all the public tests. Please try again.
                                            Best Solution:
                                            {{await model.challenge.code}}

                                            Test Results:
                                            {{#each res in await model.challenge.public_test_results}}
                                                - Test Result: {{scope.index}} - {{await res.status}} - {{await res.message}}
                                            {{/each}}

                                            If you see "error": "interrupted" in the test results, that means the solution timed out and needs to be optimized. 

                                            If you see "error": "cannot read property 'Symbol.iterator' of undefined" in the test results, it means a non-iterable is attempted to be iterated.

                                            Reason about what the test results indicate about the solution's code and then provide your improved solution in a markdown codeblock.
                                            `,
                                        },
                                    },
                                ],
                            },
                        ],
                        finally: [
                            {
                                type: "prompt",
                                showHidden: true,
                                set: "summary",
                                content: `We are now done with this challenge.
                    State the challenge name and index. List the various tries, the result (success, partial, fail) of each, and what changed between the versions. Success means all tests passed, partial success means all public tests passed, and fail means all public tests did not pass. For each try, give the numbers of each type of test that was passed.
                    tests passed: {{await model.challenge.tests_passed}}
                    public tests passed: {{await model.challenge.public_tests_passed}}
                    private tests passed: {{await model.challenge.private_tests_passed}}
                    generated tests passed: {{await model.challenge.generated_tests_passed}}
                    Then, briefly list the errors you encountered and classify their types (e.g., syntax error, runtime error, etc.) and what you (or should have done) to resolve them. Do not mention challenge-specific details, just general code generation strategy issues. Then provide any changes that should be made to the initial code generation prompts or any of the subsequent prompts.
                    If you encountered no errors, say "No errors encountered."`,
                            },
                        ],
                    },
                ],
            },
        },
        {
            type: "message",
            role: "system",
            content: `{{ await model.$.challengesJSON }}`,
        },
        {
            type: "message",
            role: "system",
            content: `All challenges have been completed.
            {{#each challenge in await model.$.challenges}}
            Challenge: {{await challenge.name}}
            Passed all tests: {{await challenge.tests_passed}}
            Passed Public Tests: {{await challenge.public_tests_passed}}
            Passed Private Tests: {{await challenge.private_tests_passed}}
            Passed Generated Tests: {{await challenge.generated_tests_passed}}

            Public Test Results:
            {{#each res in await challenge.public_test_results}}
            - Test Result: {{scope.index}} - {{await res.status}} - {{await res.message}}
            {{/each}}

            Private Test Results:
            {{#each res in await challenge.private_test_results}}
            - Test Result: {{scope.index}} - {{await res.status}} - {{await res.message}}
            {{/each}}

            Generated Test Results:
            {{#each res in await challenge.generated_test_results}}
            - Test Result: {{scope.index}} - {{await res.status}} - {{await res.message}}
            {{/each}}

            Code:
            {{await challenge.code}}
            {{/each}}
            `,
        },
        //we run a prompt on all the summaries, asking to give us the overall results (computed from the $ object) and any patterns emerging from the summaries as a whole.
    ],
};

export default fullchallenges;
