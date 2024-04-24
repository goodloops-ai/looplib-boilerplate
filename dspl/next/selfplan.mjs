import { runTests } from "../testHarness.mjs";

const singleChallengeWithPlan = {
    elements: [
        {
            type: "import",
            import: {
                runTests: "./testHarness.mjs",
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
                index: 67,
                name: "1561_C",
                description:
                    "In a certain video game, the player controls a hero characterized by a single integer value: power. The hero will have to beat monsters that are also characterized by a single integer value: armor.\n\nOn the current level, the hero is facing n caves. To pass the level, the hero must enter all the caves in some order, each cave exactly once, and exit every cave safe and sound. When the hero enters cave i, he will have to fight k_i monsters in a row: first a monster with armor a_{i, 1}, then a monster with armor a_{i, 2} and so on, finally, a monster with armor a_{i, k_i}.\n\nThe hero can beat a monster if and only if the hero's power is strictly greater than the monster's armor. If the hero can't beat the monster he's fighting, the game ends and the player loses. Note that once the hero enters a cave, he can't exit it before he fights all the monsters in it, strictly in the given order.\n\nEach time the hero beats a monster, the hero's power increases by 1.\n\nFind the smallest possible power the hero must start the level with to be able to enter all the caves in some order and beat all the monsters.\n\nInput\n\nEach test contains multiple test cases. The first line contains the number of test cases t (1 ≤ t ≤ 10^5). Description of the test cases follows.\n\nThe first line of each test case contains a single integer n (1 ≤ n ≤ 10^5) — the number of caves.\n\nThe i-th of the next n lines contains an integer k_i (1 ≤ k_i ≤ 10^5) — the number of monsters in the i-th cave, followed by k_i integers a_{i, 1}, a_{i, 2}, …, a_{i, k_i} (1 ≤ a_{i, j} ≤ 10^9) — armor levels of the monsters in cave i in order the hero has to fight them.\n\nIt is guaranteed that the sum of k_i over all test cases does not exceed 10^5.\n\nOutput\n\nFor each test case print a single integer — the smallest possible power the hero must start the level with to be able to enter all the caves in some order and beat all the monsters.\n\nExample\n\nInput\n\n\n2\n1\n1 42\n2\n3 10 15 8\n2 12 11\n\n\nOutput\n\n\n43\n13\n\nNote\n\nIn the first test case, the hero has to beat a single monster with armor 42, it's enough to have power 43 to achieve that.\n\nIn the second test case, the hero can pass the level with initial power 13 as follows: \n\n  * enter cave 2: \n    * beat a monster with armor 12, power increases to 14; \n    * beat a monster with armor 11, power increases to 15; \n  * enter cave 1: \n    * beat a monster with armor 10, power increases to 16; \n    * beat a monster with armor 15, power increases to 17; \n    * beat a monster with armor 8, power increases to 18. ",
                public_tests: [
                    {
                        input: "2\n1\n1 42\n2\n3 10 15 8\n2 12 11\n",
                        output: "43\n13\n",
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
            content: "{{model.$.description}}",
        },
        {
            type: "message",
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
              
               IMPORTANT: The new Array constructor has been modified to disallow arrays of length > 10,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general, avoid making unwarranted assumptions about input on the basis of the test(s) you can see.
              
               Consider edge cases, especially for problems involving conditional logic or specific constraints. Your code will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.
        `,
        },
        {
            type: "prompt",
            content:
                "Given the programming challenge and instructions, provide a clear, step-by-step plan to solve it. Break down the problem into smaller, manageable tasks. Ensure that your plan covers all the necessary aspects, including input parsing, problem-specific logic, edge case handling, and output formatting. Be as detailed and specific as possible in your planning.",
            set: "plan",
        },
        {
            type: "prompt",
            content:
                "Execute the first step of the plan you created to solve the programming challenge. If you need to test any code snippets, provide them as an immediately invoked function expression (IIFE) that demonstrates the specific functionality you want to test. The IIFE should include sample input data and return the expected output. IMPORTANT: do not log anything, you won't get any information back unless you return it. If you have a complete solution, respond with it in the 'code' property of your response object and don't use the function property. Remember to adhere to the rules and constraints specified earlier.",
            parse: {
                code: "$.code",
            },
        },
        {
            type: "do",
            while: {
                type: "function",
                filter: "{ success: !(await $.public_tests_passed) }",
                max: 20,
            },
            history: "flat",
            dspl: {
                elements: [
                    {
                        type: "message",
                        role: "user",
                        content: `
                            {{#if !(await model.$.public_tests_passed)}}
                                Public test results:
                                {{#each res in await model.$.public_test_results}}
                                    - Test Result: {{scope.index}} -
                                    {{#if await res.status == "pass"}}
                                        Success: {{res.message}}. Congratulations, no errors detected!
                                    {{#elseif await res.error == "SyntaxError"}}
                                        Syntax Error Detected: {{res.message}}. Please check your syntax.
                                    {{#elseif await res.error == "Timeout"}}
                                        Timeout Error: {{res.message}}. Consider optimizing your code for better performance.
                                    {{#elseif await res.error == "RuntimeError"}}
                                        Runtime Error: {{res.message}}. Ensure all variables are defined and accessible.
                                    {{#elseif await res.error == "TypeError"}}
                                        Type Error: {{res.message}}. Verify that your data types are correct.
                                    {{#else}}
                                        Unknown Error: {{res.message}}. Review the code for potential issues.
                                    {{/if}}
                                {{/each}}
                            {{#else}}
                                Public tests not yet run. Continue working on the solution.
                            {{/if}}
                        `,
                    },
                    {
                        type: "prompt",
                        content:
                            "If you got back what you expected from your last function, or you havent run a function yet, continue working on the solution. If you would like to test a specific part of your code, provide an IIFE that demonstrates the functionality you want to verify and returns a value that will indicate to you if the test passed or failed. Make sure to declare what values you are expecting to get back from the function. Include sample input data and log or return the expected output to ensure your approach is working correctly. All testing logic and sample data must be contained within the IIFE. If you would like to provide a complete solution, you must set it to the 'code' property in an object response, and it must be an ECMAScript 2017 module with the challenge solving function as the default export.",
                        parse: {
                            code: "$.code",
                        },
                    },
                ],
            },
        },
        // ... (remaining elements remain the same)
    ],
};

export default singleChallengeWithPlan;
