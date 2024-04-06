import { importJson } from "../mem.mjs";
import { runTests } from "../testHarness.mjs";
import _ from "lodash";
import YAML from "yaml";
const fullchallenges = {
    elements: [
        {
            type: "import",
            import: {
                _: "https://esm.sh/lodash",
                Formula: "https://esm.sh/",
                runTests: "./testHarness.mjs",
                importJson: "./mem.mjs",
                mem: "./mem.mjs",
            },
        },
        {
            type: "init",
            init: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.3,
                    },
                },
                challengeFile: "./dspl/challenges.valid.orig.json",
                challenges: {
                    get: ({ challengeFile }) =>
                        importJson(challengeFile, {
                            public_test_results: {
                                get: async ({ public_tests, code }) =>
                                    await runTests(code, public_tests),
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
                        }), //.then((challenges) => challenges.slice(0, 1)),
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
                in: "challenges",
                concurrency: 10,
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
                    //     content: "{{await model.item.yaml}}",
                    // },
                    // {
                    //     type: "message",
                    //     role: "user",
                    //     content: "{{await model.item.yaml2}}",
                    // },
                    //                     {
                    //                         type: "message",
                    //                         role: "user",
                    //                         content: `Challenge:
                    // {{await model.item.name}}
                    // Description:
                    // {{await model.item.description}}
                    // Public Tests:
                    // inputs:
                    // {{#each i in (await model.item.public_test_original).input}}
                    // {{i}}
                    // {{/each}}
                    // outputs:
                    // {{#each o in (await model.item.public_test_original).output}}
                    // {{o}}
                    // {{/each}}
                    // `,
                    //                     },
                    {
                        type: "message",
                        role: "user",
                        content: `Challenge:
                    {{await model.item.name}}
                    Description:
                    {{await model.item.description}}
                    Public Tests:
                    {{#each test in await model.item.public_tests}}
                    inputs:
                    test {{scope.index}}:
                    input:
                    {{test.input}}
                    output:
                    {{test.output}}
                    {{/each}}`,
                    },
                    // {
                    //     type: "message",
                    //     role: "user",
                    //     content: `Public Test Data: {{#each test in await model.item.public_tests}}

                    // },
                    {
                        type: "prompt",
                        content: `Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.

The code:
- must be a standalone ECMAScript module with no dependencies.
- must have a function as the default export.
- must accept a single 'lines' argument (an array of input strings).
- must return a single array of output strings.
- must not mix BigInt and other types, must always use explicit conversions.
- should be commented to indicate which part of the code relates to which problem constraint.
- should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.

IMPORTANT: The new Array constructor has been modified to disallow arrays of length > 5,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general avoid making unwarranted assumptions about input on the basis of the test(s) you can see.

Try to consider edge cases, especially for problems involving conditional logic or specific constraints. Your code, will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.

Enclose your code in a markdown codeblock.`,
                        parse: {
                            // code: "item.code",
                            code: (response) =>
                                /```(?:javascript|js)?\n([\s\S]*?)\n```/.exec(
                                    response
                                )[1],
                        },
                        retries: 0,
                        guards: [
                            {
                                type: "filter",
                                filter: "item.code",
                                policy: "retry",
                            },
                            {
                                type: "filter",
                                filter: "item.public_tests_passed",
                                policy: "retry",
                            },
                        ],
                        onSuccess: [
                            {
                                type: "message",
                                role: "user",
                                content: `
                            Total test results:
                            {{await model.item.tests_passed}}

                            {{#each res in await model.item.public_test_results}}
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
                            {{#each res in await model.item.private_test_results}}
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
                           {{#each res in await model.item.generated_test_results}}
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
                           `,
                            },
                        ],
                        onFail: [
                            // omitted in this case
                        ],
                        finally: [
                            {
                                type: "prompt",
                                set: "summary",
                                content: `We are now done with this challenge.
State the challenge name and index. List the various tries, the result (success, partial, fail) of each, and what changed between the versions. Success means all tests passed, partial success means all public tests passed, and fail means all public tests did not pass. For each try, give the numbers of each type of test that was passed.


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
