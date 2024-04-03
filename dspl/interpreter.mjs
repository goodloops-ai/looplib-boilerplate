import _ from "https://esm.sh/lodash";
import { OpenAI } from "https://esm.sh/openai";
import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { mem } from "./mem.mjs";
import Handlebars from "https://esm.sh/handlebars";
Handlebars.registerHelper("eq", function (arg1, arg2, options) {
    return arg1 === arg2;
});
await load({ export: true });

const llm = async (history, config, file) => {
    const { apiKey, model, temperature, max_tokens, response_format } = config;

    const messages = history
        .filter((item) => item.meta?.hidden !== true)
        .map(({ role, content }) => ({ role, content }));

    const openai = new OpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: Deno.env.get("OPENAI_API_KEY"),
    });

    try {
        console.log("Messages:", messages);
        const response = await openai.chat.completions.create({
            model,
            temperature,
            max_tokens,
            response_format,
            messages,
        });

        console.log("Response:", response);
        const assistantMessage = response.choices[0].message;
        const newHistory = [...history, assistantMessage];
        console.log("New history:", newHistory);
        return newHistory;
    } catch (error) {
        console.error("Error in llm function:", error);
        return history;
    }
};

// Element modules
const elementModules = {
    init: {
        async execute({ content }, context) {
            context.blackboard = mem(content);
            return context;
        },
    },
    prompt: {
        async execute({ content }, context) {
            const blackboardProps = extractPropertiesFromTemplate(content);
            const resolvedBlackboard = {};

            for (const prop of blackboardProps) {
                resolvedBlackboard[prop] = await context.blackboard[prop];
            }
            console.log(
                "Prompt content:",
                content,
                blackboardProps,
                resolvedBlackboard
            );

            const processedContent =
                Handlebars.compile(content)(resolvedBlackboard);
            context.history.push({ role: "user", content: processedContent });
            context = await this.runLLM(context);
            return context;
        },
        async runLLM(context, config = {}) {
            context.history = await llm(context.history, {
                ...context.blackboard.$.prompt,
                ...config,
            });
            return context;
        },
    },
    set: {
        async execute(variableName, context) {
            const value = context.history.slice(-1).pop().content.trim();
            context.blackboard[variableName] = value;
            return context;
        },
    },
    for: {
        async execute(loopData, context, config) {
            const { each, in: arrayName, do: loopElements } = loopData;
            const array = await context.blackboard[arrayName];

            const processedArray = await makeList(array, context, config);
            context.blackboard[arrayName] = processedArray;

            for (const item of processedArray) {
                item.$ = context.blackboard.$;
                let loopContext = {
                    history: JSON.parse(JSON.stringify(context.history)),
                    blackboard: item,
                };

                for (const element of loopElements) {
                    loopContext = await executeStep(
                        element,
                        loopContext,
                        config
                    );
                }
            }

            return context;
        },
    },
    if: {
        async execute(conditionData, context, config) {
            const { condition, do: conditionElements } = conditionData;
            const blackboardProps = extractPropertiesFromTemplate(condition);
            const resolvedBlackboard = {};

            for (const prop of blackboardProps) {
                resolvedBlackboard[prop] = await context.blackboard[prop];
            }

            const evaluatedCondition = evalCondition(
                condition,
                resolvedBlackboard
            );

            if (evaluatedCondition) {
                for (const element of conditionElements) {
                    context = await executeStep(element, context, config);
                }
            }

            return context;
        },
    },
    message: {
        async execute({ role, content }, context) {
            const blackboardProps = extractPropertiesFromTemplate(content);
            const resolvedBlackboard = {};

            for (const prop of blackboardProps) {
                resolvedBlackboard[prop] = await context.blackboard[prop];
            }

            console.log(
                "Message content:",
                content,
                blackboardProps,
                resolvedBlackboard
            );

            const processedContent =
                Handlebars.compile(content)(resolvedBlackboard);
            context.history.push({ role, content: processedContent });
            return context;
        },
    },
    import: {
        async execute({ import: importMap }, context) {
            for (const [key, value] of Object.entries(importMap)) {
                const importedModule = await import(value);
                globalThis[key] = context.blackboard[key] = importedModule[key];
            }
            return context;
        },
    },
};

// Guard modules
const guardModules = {
    llm: async (context, guard) => {
        const ratingPrompt = {
            role: "user",
            content: `${guard.filter}\n respond with a json object with two keys, reasoning (a string explaining yourself) and pass: (true or false)`,
        };
        const ratingContext = await elementModules.prompt.runLLM(
            {
                history: [...context.history, ratingPrompt],
                blackboard: context.blackboard,
            },
            { response_format: { type: "json_object" } }
        );

        const { reasoning, pass } = JSON.parse(
            ratingContext.history.slice(-1).pop().content.trim()
        );

        console.log("Rating:", reasoning, pass);

        return {
            success: pass,
            message: reasoning,
        };
    },
    filter: async (context, guard) => {
        console.log("Filter guard:", guard.filter);
        const pass = await context.blackboard[guard.filter];

        return {
            success: pass,
            message: pass ? "Guard condition met!" : "Guard condition failed.",
        };
    },
};

// Execution engine
async function executeDSPL(dsplCode) {
    const dsplObject = dsplCode;
    let context = {
        history: [
            {
                role: "system",
                content: "You are a helpful assistant.",
            },
        ],
        blackboard: {},
    };

    for (const element of dsplObject.elements) {
        context = await executeStep(element, context);
    }

    console.log("DSPL execution completed successfully!");
    console.log("Final context:", context);
    return context;
}

async function executeStep(
    element,
    context,
    config,
    retries = element.retries || 0
) {
    const { type, parse, set, ...elementData } = element;
    const elementModule = elementModules[type];

    if (!elementModule) {
        throw new Error(`Unsupported element type: ${type}`);
    }

    const originalHistoryLength = context.history.length;
    context = await elementModule.execute(elementData, context, config);

    if (parse) {
        const parsedContent = await extractVariables(
            context.history.slice(-1).pop().content,
            parse
        );
        console.log("Parsed content:", parsedContent);
        Object.assign(context.blackboard, parsedContent);
    }

    if (set) {
        console.log(
            "Setting variable:",
            set,
            context.history.slice(-1).pop().content
        );
        context.blackboard[set] = context.history.slice(-1).pop().content;
    }

    console.log("Element execution completed successfully!", context);

    let guardFailed = false;
    if (elementData.guards) {
        for (const guard of elementData.guards) {
            const guardModule = guardModules[guard.type];

            if (!guardModule) {
                throw new Error(`Unsupported guard type: ${guard.type}`);
            }

            const { success, message } = await guardModule(context, guard);

            if (!success) {
                context.history.push({
                    role: "system",
                    content: message,
                });

                if (retries > 0) {
                    if (guard.policy === "retry") {
                        context.history = context.history
                            .slice(0, originalHistoryLength)
                            .concat(
                                context.history
                                    .slice(originalHistoryLength)
                                    .map((message) => {
                                        if (!message.meta) {
                                            message.meta = { hidden: true };
                                        }
                                        return message;
                                    })
                            );
                    } else if (guard.overrides) {
                        return await executeStep(
                            {
                                type,
                                parse,
                                set,
                                ...elementData,
                                ...guard.overrides,
                                retries: retries - 1,
                            },
                            context,
                            config,
                            retries - 1
                        );
                    }
                } else {
                    guardFailed = true;
                    if (elementData.onFail) {
                        for (const failElement of elementData.onFail) {
                            context = await executeStep(
                                failElement,
                                context,
                                config
                            );
                        }
                    }
                }
                break;
            }
        }
    }

    if (!guardFailed && elementData.onSuccess) {
        for (const successElement of elementData.onSuccess) {
            context = await executeStep(successElement, context, config);
        }
    }

    if (elementData.finally) {
        for (const finallyElement of elementData.finally) {
            context = await executeStep(finallyElement, context, config);
        }
    }

    return context;
}

// Helper functions
async function extractVariables(content, parseConfig) {
    const extractedVariables = {};
    for (const [variableName, fn] of Object.entries(parseConfig)) {
        const match = await fn(content);
        if (match) {
            extractedVariables[variableName] = match[1];
        }
    }
    return extractedVariables;
}

function extractPropertiesFromTemplate(templateString) {
    const regex = /{{\s*([^{}]+)\s*}}/g;
    const properties = new Set();
    let match;

    while ((match = regex.exec(templateString)) !== null) {
        // Extract the last word from the mustache expression
        const path = match[1].trim().split(" ").pop();
        // Only add the property name if it's not a helper function
        if (!path.startsWith("#") && !path.startsWith("/")) {
            properties.add(path);
        }
    }

    return Array.from(properties);
}
async function evalCondition(condition, blackboard) {
    const blackboardProps = extractPropertiesFromTemplate(condition);
    const resolvedBlackboard = {};

    for (const prop of blackboardProps) {
        resolvedBlackboard[prop] = await blackboard[prop];
    }

    const processedCondition =
        Handlebars.compile(condition)(resolvedBlackboard);
    return eval(processedCondition);
}

const makeList = async (
    input,
    context,
    config,
    file = "./dspl/test/toss.json"
) => {
    if (Array.isArray(input)) {
        return input;
    }
    const prompt = {
        role: "user",
        content: `Please provide the following input as a valid JSON object with the array of objects stored under the "data" property:

\`\`\`
${input}
\`\`\`

Ensure that the response is a valid JSON object, and each item in the array is an object. If the input is not an array, wrap it in an array before returning the JSON object.`,
    };

    console.log("makeList prompt", prompt, context, config, file);

    const res = await llm(
        [...context.history, prompt],
        {
            ...context.blackboard.$.prompt,
            response_format: { type: "json_object" },
        },
        file
    );
    const response = res.slice(-1).pop().content.trim();

    try {
        const parsedResponse = JSON.parse(response);
        return parsedResponse.data || [];
    } catch (error) {
        console.error("Error parsing JSON response:", error);
        return [];
    }
};

// ... (example usage remains the same)
const sonnet = {
    elements: [
        {
            type: "init",
            content: {
                $: {
                    prompt: {
                        model: "gpt-3.5-turbo",
                        temperature: 0.3,
                    },
                },
            },
        },
        {
            type: "prompt",
            content: "write a sonnet about the moon",
            set: "sonnet",
            guards: [
                {
                    type: "llm",
                    filter: "Is the poem a 10/10?",
                    recovery_prompt: "Improve the poem",
                    retries: 3,
                },
            ],
        },
    ],
};
const poemdspl = {
    elements: [
        {
            type: "init",
            content: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.3,
                    },
                },
            },
        },
        {
            type: "prompt",
            mode: "json",
            content:
                "give me a list of animals, one for each letter of the alphabet, each starting with the letter of the alphabet it corresponds to.",
            set: "animals",
        },
        {
            type: "for",
            each: "animal",
            in: "animals",
            do: [
                {
                    type: "prompt",
                    mode: "json",
                    content:
                        "write me a short children's book poem about {{animal}}",
                    set: "poem",
                },
            ],
        },
    ],
};
const singlechallenge = {
    elements: [
        {
            type: "import",
            import: {
                runTests: "./testHarness.mjs",
            },
        },
        {
            type: "init",
            content: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.3,
                    },
                },
                runTests: {
                    // fix this: bug in mem.js
                    get: async ({ _ }) =>
                        import("./testHarness.mjs").then((mod) => mod.runTests),
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
                    get: ({ public_tests, code, runTests }) =>
                        runTests?.(code, public_tests) || [],
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
            content: "{{description}}",
        },
        {
            type: "prompt",
            retries: 3,
            content:
                "Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.\\nThe code:\\n- must be a standalone ECMAScript module with no dependencies.\\n- must have a function as the default export.\\n- must accept a single 'lines' argument (an array of input strings).\\n- must return a single array of output strings.\\n- must not mix BigInt and other types, must always use explicit conversions.\\n- should be commented to indicate which part of the code relates to which problem constraint.\\n- should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.\\n\\nIMPORTANT: The new Array constructor has been modified to disallow arrays of length > 10,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general, avoid making unwarranted assumptions about input on the basis of the test(s) you can see.\\n\\nConsider edge cases, especially for problems involving conditional logic or specific constraints. Your code will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.\\n\\nEnclose your code in a markdown code block.",
            parse: {
                code: (response) => {
                    const match = response.match(
                        /```(?:javascript|)?\s*\n([\s\S]*?)\n```/
                    );
                    return match;
                },
            },
            guards: [
                {
                    type: "filter",
                    filter: "code",
                    policy: "retry",
                },
                {
                    type: "filter",
                    filter: "public_tests_passed",
                    overrides: {
                        content:
                            "Here are the results of testing your code:\\n{{#each public_test_results}}\\n- Test Result: {{@index}} -\\n{{#if (eq this.status 'pass')}}\\nSuccess: {{this.message}}. Congratulations, no errors detected!\\n{{else if (eq this.error 'SyntaxError')}}\\nSyntax Error Detected: {{this.message}}. Please check your syntax.\\n{{else if (eq this.error 'Timeout')}}\\nTimeout Error: {{this.message}}. Consider optimizing your code for better performance.\\n{{else if (eq this.error 'RuntimeError')}}\\nRuntime Error: {{this.message}}. Ensure all variables are defined and accessible.\\n{{else if (eq this.error 'TypeError')}}\\nType Error: {{this.message}}. Verify that your data types are correct.\\n{{else}}\\nUnknown Error: {{this.message}}. Review the code for potential issues.\\n{{/if}}\\n{{/each}}. Provide a complete, fixed version of the code.",
                    },
                },
            ],
            finally: [
                {
                    type: "message",
                    role: "user",
                    content: `total test results: {{#each public_test_results}}{{this.status}}{{#unless @last}}, {{/unless}}{{/each}}`,
                },
                {
                    type: "prompt",
                    set: "summary",
                    content:
                        "We are now done with this challenge.\\nState the challenge name and index. List the various tries, the result (success, partial, fail) of each, and what changed between the versions. Success means all tests passed, partial success means all public tests passed, and fail means all public tests did not pass. For each try, give the numbers of each type of test that was passed.\\n\\nThen, briefly list the errors you encountered and classify their types (e.g., syntax error, runtime error, etc.) and what you (or should have done) to resolve them. Do not mention challenge-specific details, just general code generation strategy issues. Then provide any changes that should be made to the initial code generation prompts or any of the subsequent prompts.\\nIf you encountered no errors, say 'No errors encountered.'",
                },
            ],
        },
    ],
};

// const result = await executeDSPL(poemdspl);
// console.log(await result.blackboard.animals);

const sres = await executeDSPL(sonnet);
console.log(await sres.blackboard.sonnet);
