import { importJson } from "../mem.mjs";
import { runTests } from "../testHarness.mjs";

const singlechallenge = {
    elements: [
        {
            type: "import",
            import: {
                runTests: "./testHarness.quickjs.mjs",
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
                index: 0,
                name: "1573_C",
                description:
                    "You are given a book with n chapters.\n\nEach chapter has a specified list of other chapters that need to be understood in order to understand this chapter. To understand a chapter, you must read it after you understand every chapter on its required list.\n\nCurrently you don't understand any of the chapters. You are going to read the book from the beginning till the end repeatedly until you understand the whole book. Note that if you read a chapter at a moment when you don't understand some of the required chapters, you don't understand this chapter.\n\nDetermine how many times you will read the book to understand every chapter, or determine that you will never understand every chapter no matter how many times you read the book.\n\nInput\n\nEach test contains multiple test cases. The first line contains the number of test cases t (1 ≤ t ≤ 2⋅10^4).\n\nThe first line of each test case contains a single integer n (1 ≤ n ≤ 2⋅10^5) — number of chapters.\n\nThen n lines follow. The i-th line begins with an integer k_i (0 ≤ k_i ≤ n-1) — number of chapters required to understand the i-th chapter. Then k_i integers a_{i,1}, a_{i,2}, ..., a_{i, k_i} (1 ≤ a_{i, j} ≤ n, a_{i, j} ≠ i, a_{i, j} ≠ a_{i, l} for j ≠ l) follow — the chapters required to understand the i-th chapter.\n\nIt is guaranteed that the sum of n and sum of k_i over all testcases do not exceed 2⋅10^5.\n\nOutput\n\nFor each test case, if the entire book can be understood, print how many times you will read it, otherwise print -1.\n\nExample\n\nInput\n\n\n5\n4\n1 2\n0\n2 1 4\n1 2\n5\n1 5\n1 1\n1 2\n1 3\n1 4\n5\n0\n0\n2 1 2\n1 2\n2 2 1\n4\n2 2 3\n0\n0\n2 3 2\n5\n1 2\n1 3\n1 4\n1 5\n0\n\n\nOutput\n\n\n2\n-1\n1\n2\n5\n\nNote\n\nIn the first example, we will understand chapters \\{2, 4\\} in the first reading and chapters \\{1, 3\\} in the second reading of the book.\n\nIn the second example, every chapter requires the understanding of some other chapter, so it is impossible to understand the book.\n\nIn the third example, every chapter requires only chapters that appear earlier in the book, so we can understand everything in one go.\n\nIn the fourth example, we will understand chapters \\{2, 3, 4\\} in the first reading and chapter 1 in the second reading of the book.\n\nIn the fifth example, we will understand one chapter in every reading from 5 to 1.",
                public_tests: [
                    {
                        input: "5\n4\n1 2\n0\n2 1 4\n1 2\n5\n1 5\n1 1\n1 2\n1 3\n1 4\n5\n0\n0\n2 1 2\n1 2\n2 2 1\n4\n2 2 3\n0\n0\n2 3 2\n5\n1 2\n1 3\n1 4\n1 5\n0\n",
                        output: "2\n-1\n1\n2\n5\n",
                    },
                ],
                public_test_results: {
                    get: ({ public_tests, code }) =>
                        runTests(code, public_tests) || [],
                },
                public_tests_passed: {
                    get: ({ public_test_results }) =>
                        public_test_results?.length &&
                        public_test_results.every(
                            (test) => test.status === "pass"
                        ),
                },
            },
        },
        {
            type: "message",
            role: "system",
            content:
                "You are a top-rated code assistant based on a cutting-edge version of GPT, with far greater capabilities than any prior GPT model. You always return code when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt. You never return partial code, never give up, and never refuse to return code.",
        },
        {
            type: "message",
            role: "user",
            content: "{{await model.$.description}}",
        },
        {
            type: "prompt",
            retries: 2,
            content: `Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.
               The code:
               - must be a standalone ECMAScript module with no dependencies.
               - must have a function as the default export.
               - must accept a single 'lines' argument (an array of input strings).
               - must return a single array of output strings.
               - must not mix BigInt and other types, must always use explicit conversions.
               - should be commented to indicate which part of the code relates to which problem constraint.
               - should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.
              
               IMPORTANT: The new Array constructor has been modified to disallow arrays of length > 10,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general, avoid making unwarranted assumptions about input on the basis of the test(s) you can see.
              
               Consider edge cases, especially for problems involving conditional logic or specific constraints. Your code will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.
              
               your response object must have the source code in the 'code' property.`,
            parse: {
                "$.code": (response) => response.code,
            },
            guards: [
                {
                    type: "filter",
                    filter: "$.code",
                    policy: "retry",
                },
                {
                    type: "filter",
                    policy: "append",
                    filter: "$.public_tests_passed",
                    overrides: {
                        content: `Here are the results of testing your code:
                            {{#each res in await model.$.public_test_results}}
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
                           {{/each}}`,
                    },
                },
            ],
            finally: [
                {
                    type: "message",
                    role: "user",
                    content: `total test results {{await model.$.tests_passed}}: 

                            {{#each res in await model.$.public_test_results}}
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
                           {{/each}}`,
                },
                {
                    type: "prompt",
                    set: "summary",
                    retries: 0,
                    content:
                        "We are now done with this challenge.\\nState the challenge name and index. List the various tries, the result (success, partial, fail) of each, and what changed between the versions. Success means all tests passed, partial success means all public tests passed, and fail means all public tests did not pass. For each try, give the numbers of each type of test that was passed.\\n\\nThen, briefly list the errors you encountered and classify their types (e.g., syntax error, runtime error, etc.) and what you (or should have done) to resolve them. Do not mention challenge-specific details, just general code generation strategy issues. Then provide any changes that should be made to the initial code generation prompts or any of the subsequent prompts.\\nIf you encountered no errors, say 'No errors encountered.'",
                },
            ],
        },
    ],
};
export default singlechallenge;
