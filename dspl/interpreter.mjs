import _ from "https://esm.sh/lodash";
import { OpenAI } from "https://esm.sh/openai";
import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { mem } from "./mem.mjs";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { dirname } from "https://deno.land/std/path/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import epub from "https://deno.land/x/epubgen/mod.ts";
import xmlserializer from "https://esm.sh/xmlserializer";

globalThis.XMLSerializer = function () {
    return {
        serializeToString: xmlserializer.serializeToString,
    };
};

globalThis.DOMParser = DOMParser;

// import EpubGenerator from "https://esm.sh/epub-gen";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";
import Handlebars from "https://esm.sh/handlebars";
Handlebars.registerHelper("eq", function (arg1, arg2, options) {
    return arg1 === arg2;
});
await load({ export: true });

const llm = async (history, config, file) => {
    const {
        apiKey,
        model: _model,
        temperature,
        max_tokens = 500,
        response_format,
        n = 1,
    } = config;

    const model = response_format ? "gpt-4-0125-preview" : _model;
    if (model.startsWith("claude")) {
        let systemMessage = "";
        const userMessages = history
            .filter((item) => !Array.isArray(item))
            .filter((item) => item.meta?.hidden !== true)
            .map(({ role, content }) => {
                if (role === "system") {
                    systemMessage += content + "\n";
                    return null;
                }
                return { role, content };
            })
            .filter(Boolean);

        const anthropic = new Anthropic({
            apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
        });

        try {
            console.log("Messages:", userMessages);
            const response = await anthropic.messages.create({
                model,
                temperature,
                max_tokens,
                messages: userMessages,
                system: systemMessage.trim(),
            });

            console.log("Response:", response);
            const assistantMessages = [
                { role: "assistant", content: response.content[0].text },
            ];

            const newHistory = [...history, ...assistantMessages];
            console.log("New history:", JSON.stringify(newHistory, null, 2));
            return newHistory;
        } catch (error) {
            console.error("Error in llm function:", error);
            return history;
        }
    } else {
        const messages = history
            .filter((item) => !Array.isArray(item))
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
                n,
            });

            console.log("Response:", response);
            const assistantMessages = response.choices.map(
                ({ message }) => message
            );

            const newHistory = [...history, ...assistantMessages];
            console.log("New history:", newHistory);
            return newHistory;
        } catch (error) {
            console.error("Error in llm function:", error);
            return history;
        }
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
        async execute({ content, ...config }, context) {
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
            context = await this.runLLM(context, config);
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
    image: {
        async execute(elementData, context) {
            const {
                prompt,
                outputFormat = "webp",
                imagePath = "./generated_image.png",
                ...requestBody
            } = elementData;

            try {
                const formData = new FormData();
                formData.append("prompt", prompt);
                formData.append("output_format", outputFormat);

                for (const [key, value] of Object.entries(requestBody)) {
                    formData.append(key, value.toString());
                }

                const response = await fetch(
                    "https://api.stability.ai/v2beta/stable-image/generate/core",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${Deno.env.get(
                                "STABILITY_API_KEY"
                            )}`,
                            Accept: "image/*",
                        },
                        body: formData,
                    }
                );

                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    await ensureDir(dirname(imagePath));
                    await Deno.writeFile(imagePath, new Uint8Array(buffer));
                    console.log(
                        `Image generated successfully. Saved to ${imagePath}`
                    );
                } else {
                    const errorText = await response.text();
                    throw new Error(`${response.status}: ${errorText}`);
                }
            } catch (error) {
                console.error("Error generating image:", error);
            }

            return context;
        },
    },
    epub: {
        async execute(elementData, context) {
            const {
                title,
                author,
                language,
                identifier,
                cover,
                chapters,
                epubPath,
            } = elementData;

            const coverFile = await Deno.readFile(cover);
            const coverBlob = new Blob([coverFile.buffer]);
            const coverUrl = URL.createObjectURL(coverBlob);

            const options = {
                title,
                author,
                lang: language,
                identifier,
                cover: coverUrl,
                appendChapterTitles: false,
                css: `
          @namespace epub "http://www.idpf.org/2007/ops";
          body {
            font-family: Cambria, Liberation Serif, serif;
          }
          h1 {
            text-align: left;
            text-transform: uppercase;
            font-weight: 200;
          }
        `,
            };

            try {
                const epubData = await epub(options, chapters);
                await Deno.writeFile(epubPath, epubData);

                console.log("EPUB file generated successfully!");
            } catch (error) {
                console.error("Error generating EPUB file:", error, chapters);
            }

            return context;
        },
    },
    for: {
        async execute(loopData, context, config) {
            const {
                each,
                in: arrayName,
                do: loopElements,
                history = "parallel",
            } = loopData;
            const array = await context.blackboard[arrayName];

            const processedArray = await makeList(array, context, config);
            context.blackboard[arrayName] = processedArray;

            let lastContext = context;

            for (const item of processedArray) {
                item.$ = context.blackboard.$;
                let loopContext = {
                    history: JSON.parse(JSON.stringify(lastContext.history)),
                    blackboard: item,
                };

                console.log(
                    "Loop item:",
                    item,
                    loopContext,
                    loopElements,
                    processedArray
                );

                for (const element of loopElements) {
                    loopContext = await executeStep(
                        element,
                        loopContext,
                        config
                    );
                }

                if (history === "sequential") {
                    lastContext = loopContext;
                }
            }

            return context;
        },
    },
    invoke: {
        async execute(invokeData, context, config) {
            const { dspl: childDspl, map, extract, history } = invokeData;

            // Deep clone the child DSPL object without serializing properties
            const clonedChildDspl = _.cloneDeepWith(childDspl, (value) => {
                if (typeof value === "function") {
                    return value;
                }
            });

            // Find the init step in the child DSPL
            const initStep = clonedChildDspl.elements.find(
                (step) => step.type === "init"
            );

            const resolvedValues = await Promise.all(
                Object.entries(map).map(async ([key, parentKey]) => ({
                    [key]: await context.blackboard[parentKey],
                }))
            );

            const mergedValues = Object.assign({}, ...resolvedValues);

            if (initStep) {
                // If an init step exists, merge the mapped parent blackboard values into its content
                initStep.content = {
                    ...initStep.content,
                    ...mergedValues,
                };
            } else {
                // If no init step exists, create a new one with the mapped parent blackboard values
                clonedChildDspl.elements.unshift({
                    type: "init",
                    content: mergedValues,
                });
            }

            // Execute the modified child DSPL flow
            let childContext = {
                history: [], // Start with an empty history for the child
                blackboard: {},
            };
            try {
                childContext = await executeDSPL(clonedChildDspl, childContext);
            } catch (error) {
                // If an error occurs in the child flow, bubble it up to the parent
                childContext.history.push({
                    role: "system",
                    content: `Error in child flow: ${error.message}`,
                });
            }

            // Extract values from child blackboard to parent blackboard
            if (extract) {
                for (const [parentKey, childKey] of Object.entries(extract)) {
                    context.blackboard[parentKey] = await childContext
                        .blackboard[childKey];
                }
            }

            // Merge child history into parent history based on the specified strategy
            if (history === "hidden") {
                // Add the child history to the parent history, but mark all but the last message as hidden
                const hiddenHistory = childContext.history
                    .slice(0, -1)
                    .map((message) => ({
                        ...message,
                        meta: { hidden: true },
                    }));
                context.history.push(
                    ...hiddenHistory,
                    childContext.history[childContext.history.length - 1]
                );
            } else if (history === "flat") {
                // Add the child history to the parent history as a flat array
                context.history.push(...childContext.history);
            } else {
                // Default: Add the child history as a nested array in the parent history
                context.history.push(childContext.history);
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
        history: [],
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
    config = {},
    retries = element.retries || 0
) {
    const { type, parse, set, ...elementData } = element;
    const elementModule = elementModules[type];

    if (!elementModule) {
        throw new Error(`Unsupported element type: ${type}`);
    }

    // Resolve blackboard references in element configurations deeply
    const extractPropertiesFromBlackboard = async (blackboard, template) => {
        const props = extractPropertiesFromTemplate(template);
        const resolvedProps = {};
        for (const prop of props) {
            resolvedProps[prop] = await blackboard[prop];
        }
        resolvedProps.$ = await blackboard.$;
        return resolvedProps;
    };

    const resolveBlackboardReferences = async (value, blackboard) => {
        if (typeof value === "function") {
            return value(await blackboard._obj);
        }
        const reservedKeys = [
            "overrides",
            "onSuccess",
            "onFail",
            "finally",
            "do",
        ];
        const properties = await extractPropertiesFromBlackboard(
            blackboard,
            value
        );

        if (typeof value === "string") {
            const template = Handlebars.compile(value);
            return template(properties);
        } else if (Array.isArray(value)) {
            return Promise.all(
                value.map((item) =>
                    resolveBlackboardReferences(item, blackboard)
                )
            );
        } else if (value !== null && typeof value === "object") {
            const resolvedObject = {};
            for (const [key, val] of Object.entries(value)) {
                if (!reservedKeys.includes(key)) {
                    resolvedObject[key] = await resolveBlackboardReferences(
                        val,
                        blackboard
                    );
                } else {
                    resolvedObject[key] = val;
                }
            }
            return resolvedObject;
        } else {
            return value;
        }
    };

    const resolvedElementData = await resolveBlackboardReferences(
        elementData,
        context.blackboard
    );
    const originalHistoryLength = context.history.length;
    context = await elementModule.execute(resolvedElementData, context, {
        ...config,
        ...resolvedElementData,
    });

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
        const $ = await context.blackboard._obj;
        return input.map((item) => {
            return {
                $,
                ...item,
            };
        });
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
        return makeList(parsedResponse.data || [], context, config);
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

const codium = {
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
            content: {
                $: {
                    prompt: {
                        model: "gpt-3.5-turbo",
                        temperature: 0.3,
                    },
                },
                challengeFile: "./dspl/challenges.valid.json",
                challenges: {
                    get: ({ challengeFile }) =>
                        importJson(challengeFile, {
                            public_test_results: {
                                get: ({ public_tests, code }) =>
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
                            private_test_results: {
                                get: ({
                                    public_tests_passed,
                                    private_tests,
                                    code,
                                }) =>
                                    public_tests_passed
                                        ? runTests(code, private_tests, {
                                              breakOnFailure: true,
                                          })
                                        : [],
                            },
                            private_tests_passed: {
                                get: ({ private_test_results }) =>
                                    private_test_results?.length &&
                                    _.every(private_test_results, [
                                        "status",
                                        "pass",
                                    ]),
                            },
                            generated_test_results: {
                                get: ({
                                    public_tests_passed,
                                    private_tests_passed,
                                    generated_tests,
                                    code,
                                }) =>
                                    public_tests_passed && private_tests_passed
                                        ? runTests(code, generated_tests, {
                                              breakOnFailure: true,
                                          })
                                        : [],
                            },
                            generated_tests_passed: {
                                get: ({ generated_test_results }) =>
                                    generated_test_results?.length &&
                                    _.every(generated_test_results, [
                                        "status",
                                        "pass",
                                    ]),
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
            },
        },
        {
            type: "for",
            each: "challenge",
            in: "challenges",
            do: [
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
              
               Enclose your code in a markdown code block.`,
                    parse: {
                        code: (response) => {
                            const match = response.match(
                                /```(?:javascript|)?\s*\n([\s\S]*?)\n```/
                            );
                            return match;
                        },
                    },
                    retries: 6,
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
                                content: `
                           Here are the results of testing your code:
                           {{#each public_test_results}}
                               - Test Result: {{@index}} -
                               {{#if (eq this.status "pass")}}
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
                            },
                        },
                    ],
                    onSuccess: [
                        {
                            type: "message",
                            role: "user",
                            content: `
                            Total test results:
                            {{#each public_test_results}}
                               - Test Result: {{@index}} -
                               {{#if (eq this.status "pass")}}
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
                            {{#each private_test_results}}
                               - Test Result: {{@index}} -
                               {{#if (eq this.status "pass")}}
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
                           {{#each generated_test_results}}
                               {{#if (eq this.status "pass")}}
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
        //we run a prompt on all the summaries, asking to give us the overall results (computed from the $ object) and any patterns emerging from the summaries as a whole.
    ],
};

const smartgpt = {
    elements: [
        {
            type: "init",
            content: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.5,
                    },
                },
                userPrompt:
                    "What are the potential long-term impacts of artificial intelligence on society and the economy?",
            },
        },
        {
            type: "prompt",
            n: 3,
            content:
                "You are a researcher tasked with providing a comprehensive response to the following user prompt: {{userPrompt}}. Please break down your response into key points, considering various aspects such as technological advancements, societal implications, ethical considerations, and economic consequences. Provide a well-structured, in-depth analysis.",
        },
        {
            type: "prompt",
            content:
                "Acting as an impartial reviewer, carefully examine the {{history.length}} responses provided. Analyze the strengths and weaknesses of each response, considering factors such as thoroughness, clarity, objectivity, and relevance to the original question. Provide a comparative assessment and rank the responses from best to worst, explaining your reasoning.",
        },
        {
            type: "prompt",
            content:
                "Based on the reviewer's feedback, select the most comprehensive and insightful response from the options provided. Refine and expand upon this chosen response, addressing any shortcomings identified by the reviewer and incorporating the best elements from the other responses as appropriate. The goal is to produce a definitive, well-rounded answer to the original question: {{userQuestion}}",
            set: "aiAnswer",
        },
    ],
};

const shaiku = {
    elements: [
        {
            type: "init",
            content: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.7,
                    },
                },
                topic: "Please write me a haiku about summer rain",
            },
        },
        {
            type: "invoke",
            dspl: smartgpt,
            map: {
                userPrompt: "topic",
            },
            extract: {
                haiku: "aiAnswer",
            },
            history: "hidden",
        },
    ],
};

const haikuEpubFlow = {
    elements: [
        {
            type: "init",
            content: {
                $: {
                    prompt: {
                        model: "claude-3-opus-20240229",
                        temperature: 0.7,
                    },
                },
            },
        },
        {
            type: "prompt",
            content: "Write a haiku about a beautiful sunset.",
            set: "haiku",
            parse: {
                haiku: (response) => response.trim(),
            },
        },
        {
            type: "image",
            prompt: "{{haiku}}",
            imagePath: "./dspl/test/sunset_haiku.png",
            width: 512,
            height: 512,
            samples: 1,
            steps: 50,
        },
        {
            type: "epub",
            title: "Sunset Haiku",
            author: "AI Poet",
            language: "en",
            identifier: "sunset-haiku-1",
            cover: "./dspl/test/sunset_haiku.png",
            chapters: [
                {
                    title: "Sunset Haiku",
                    content: "<p>{{haiku}}</p>",
                },
            ],
            epubPath: "./dspl/test/sunset_haiku.epub",
        },
    ],
};

const bookWritingFlow = {
    elements: [
        {
            type: "init",
            content: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.7,
                        max_tokens: 4000,
                    },
                },
                writingStyle: "In the style of Christopher Hitchens",
                bookDescription: "The heretics guide to AI safety",
                numChapters: 5,
                chapters: "5 object with an index number",
                bookTitle: "",
                coverImagePath: "./dspl/test/cover.png",
                bookFilePath: "./dspl/test/book.txt",
                epubFilePath: "./dspl/test/book.epub",
            },
        },
        {
            type: "prompt",
            content:
                "Create a detailed plot outline for a {{numChapters}}-chapter book in the {{writingStyle}} style, based on the following description:\n\n{{bookDescription}}\n\nEach chapter should be at least 10 pages long.",
            set: "plotOutline",
        },
        {
            type: "for",
            each: "chapter",
            in: "chapters",
            do: [
                {
                    type: "prompt",
                    content:
                        "Write chapter {{index}} of the book, ensuring it follows the plot outline and builds upon the previous chapters (if any).",
                    max_tokens: 4000,
                    set: "chapter",
                    parse: {
                        chapter: (response) => {
                            const chapter = response
                                .replace(/^Here.*:\n/, "")
                                .trim();
                            return `<p>${chapter.replace(
                                /\n/g,
                                "</p><p>"
                            )}</p>`;
                        },
                    },
                },
                {
                    type: "prompt",
                    content:
                        "Chapter Content:\n\n{{chapter}}\n\n--\n\nGenerate a concise and engaging title for this chapter based on its content. Respond with the title only, nothing else.",
                    set: "chapterTitle",
                    parse: {
                        chapterTitle: (response) => response.trim(),
                    },
                },
            ],
        },
        {
            type: "prompt",
            content:
                "Here is the plot for the book: {{plotOutline}}\n\n--\n\nRespond with a great title for this book. Only respond with the title, nothing else is allowed.",
            set: "bookTitle",
            parse: {
                bookTitle: (response) => response.trim(),
            },
        },
        {
            type: "prompt",
            content:
                "Plot: {{plotOutline}}\n\n--\n\nDescribe the cover we should create, based on the plot. This should be two sentences long, maximum.",
            set: "coverPrompt",
        },
        {
            type: "image",
            prompt: "{{coverPrompt}}",
            imagePath: "{{coverImagePath}}",
            width: 512,
            height: 768,
            samples: 1,
            steps: 30,
        },
        {
            type: "epub",
            title: "{{bookTitle}}",
            author: "AI",
            language: "en",
            identifier: "ai-generated-book-1",
            cover: "{{coverImagePath}}",
            chapters: ({ chapters }) =>
                chapters.map((chapter, index) => ({
                    title: chapter.chapterTitle,
                    content: `<p>${chapter.chapter}</p>`,
                })),
            epubPath: "{{epubFilePath}}",
        },
        {
            type: "message",
            role: "assistant",
            content:
                "Book generated successfully!\nBook Title: {{bookTitle}}\nBook saved as: {{bookFilePath}}\nEPUB file generated: {{epubFilePath}}",
        },
    ],
};

// Execute the DSPL flow
executeDSPL(bookWritingFlow)
    .then((context) => {
        console.log("Book writing flow executed successfully!");
    })
    .catch((error) => {
        console.error("Error executing book writing flow:", error);
    });
// Execute the DSPL flow
// executeDSPL(haikuEpubFlow)
//     .then((context) => {
//         console.log("DSPL flow executed successfully!");
//         console.log("Generated haiku:", context.blackboard.haiku);
//         console.log("Generated image: ./sunset_haiku.png");
//         console.log("Generated EPUB: ./sunset_haiku.epub");
//     })
//     .catch((error) => {
//         console.error("Error executing DSPL flow:", error);
//     });

// const result = await executeDSPL(poemdspl);
// console.log(await result.blackboard.animals);

// const sres = await executeDSPL(sonnet);
// console.log(await sres.blackboard.sonnet);
// const cres = await executeDSPL(singlechallenge);
// console.log(await cres.blackboard.summary);

// const codiumres = await executeDSPL(codium);
// const summaries = await codiumres.blackboard.challenges.then((c) =>
//     Promise.all(c.map((ch) => ch.summary))
// );
// console.log(summaries);

// Deno.writeTextFile(
//     "./dspl/test/results.json",
//     JSON.stringify(summaries, null, 2)
// );

// const sgptres = await executeDSPL(smartgpt);
// console.log(await sgptres.blackboard.aiAnswer);

// const shaikures = await executeDSPL(shaiku);
// console.log(await shaikures.blackboard.haiku);

/**
 * 
 * !pip install EbookLib

import time
import re
import os
from ebooklib import epub
import base64
import requests
import json

ANTHROPIC_API_KEY = "YOUR KEY HERE"
stability_api_key = "YOUR KEY HERE" # get it at https://beta.dreamstudio.ai/

def remove_first_line(test_string):
    if test_string.startswith("Here") and test_string.split("\n")[0].strip().endswith(":"):
        return re.sub(r'^.*\n', '', test_string, count=1)
    return test_string

def generate_text(prompt, model="claude-3-haiku-20240307", max_tokens=2000, temperature=0.7):
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    data = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": "You are a world-class author. Write the requested content with great skill and attention to detail.",
        "messages": [{"role": "user", "content": prompt}],
    }
    response = requests.post("https://api.anthropic.com/v1/messages", headers=headers, json=data)
    response_text = response.json()['content'][0]['text']
    return response_text.strip()

def generate_cover_prompt(plot):
    response = generate_text(f"Plot: {plot}\n\n--\n\nDescribe the cover we should create, based on the plot. This should be two sentences long, maximum.")
    return response

def generate_title(plot):
    response = generate_text(f"Here is the plot for the book: {plot}\n\n--\n\nRespond with a great title for this book. Only respond with the title, nothing else is allowed.")
    return remove_first_line(response)

def create_cover_image(plot):

  plot = str(generate_cover_prompt(plot))

  engine_id = "stable-diffusion-xl-beta-v2-2-2"
  api_host = os.getenv('API_HOST', 'https://api.stability.ai')
  api_key = stability_api_key

  if api_key is None:
      raise Exception("Missing Stability API key.")

  response = requests.post(
      f"{api_host}/v1/generation/{engine_id}/text-to-image",
      headers={
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": f"Bearer {api_key}"
      },
      json={
          "text_prompts": [
              {
                  "text": plot
              }
          ],
          "cfg_scale": 7,
          "clip_guidance_preset": "FAST_BLUE",
          "height": 768,
          "width": 512,
          "samples": 1,
          "steps": 30,
      },
  )

  if response.status_code != 200:
      raise Exception("Non-200 response: " + str(response.text))

  data = response.json()

  for i, image in enumerate(data["artifacts"]):
      with open(f"/content/cover.png", "wb") as f: # replace this if running locally, to where you store the cover file
          f.write(base64.b64decode(image["base64"]))

def generate_chapter_title(chapter_content):
    response = generate_text(f"Chapter Content:\n\n{chapter_content}\n\n--\n\nGenerate a concise and engaging title for this chapter based on its content. Respond with the title only, nothing else.")
    return remove_first_line(response)

def create_epub(title, author, chapters, cover_image_path='cover.png'):
    book = epub.EpubBook()
    # Set metadata
    book.set_identifier('id123456')
    book.set_title(title)
    book.set_language('en')
    book.add_author(author)
    # Add cover image
    with open(cover_image_path, 'rb') as cover_file:
        cover_image = cover_file.read()
    book.set_cover('cover.png', cover_image)
    # Create chapters and add them to the book
    epub_chapters = []
    for i, chapter_content in enumerate(chapters):
        chapter_title = generate_chapter_title(chapter_content)
        chapter_file_name = f'chapter_{i+1}.xhtml'
        epub_chapter = epub.EpubHtml(title=chapter_title, file_name=chapter_file_name, lang='en')
        # Add paragraph breaks
        formatted_content = ''.join(f'<p>{paragraph.strip()}</p>' for paragraph in chapter_content.split('\n') if paragraph.strip())
        epub_chapter.content = f'<h1>{chapter_title}</h1>{formatted_content}'
        book.add_item(epub_chapter)
        epub_chapters.append(epub_chapter)


    # Define Table of Contents
    book.toc = (epub_chapters)

    # Add default NCX and Nav files
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())

    # Define CSS style
    style = '''
    @namespace epub "http://www.idpf.org/2007/ops";
    body {
        font-family: Cambria, Liberation Serif, serif;
    }
    h1 {
        text-align: left;
        text-transform: uppercase;
        font-weight: 200;
    }
    '''

    # Add CSS file
    nav_css = epub.EpubItem(uid="style_nav", file_name="style/nav.css", media_type="text/css", content=style)
    book.add_item(nav_css)

    # Create spine
    book.spine = ['nav'] + epub_chapters

    # Save the EPUB file
    epub.write_epub(f'{title}.epub', book)


def generate_book(writing_style, book_description, num_chapters):
    print("Generating plot outline...")
    plot_prompt = f"Create a detailed plot outline for a {num_chapters}-chapter book in the {writing_style} style, based on the following description:\n\n{book_description}\n\nEach chapter should be at least 10 pages long."
    plot_outline = generate_text(plot_prompt)
    print("Plot outline generated.")

    chapters = []
    for i in range(num_chapters):
        print(f"Generating chapter {i+1}...")
        chapter_prompt = f"Previous Chapters:\n\n{' '.join(chapters)}\n\nWriting style: `{writing_style}`\n\nPlot Outline:\n\n{plot_outline}\n\nWrite chapter {i+1} of the book, ensuring it follows the plot outline and builds upon the previous chapters. The chapter should be at least 256 paragraphs long... we're going for lengthy yet exciting chapters here."
        chapter = generate_text(chapter_prompt, max_tokens=4000)
        chapters.append(remove_first_line(chapter))
        print(f"Chapter {i+1} generated.")
        time.sleep(1)  # Add a short delay to avoid hitting rate limits

    print("Compiling the book...")
    book = "\n\n".join(chapters)
    print("Book generated!")

    return plot_outline, book, chapters

# User input
writing_style = input("Enter the desired writing style: ")
book_description = input("Enter a high-level description of the book: ")
num_chapters = int(input("Enter the number of chapters: "))

# Generate the book
plot_outline, book, chapters = generate_book(writing_style, book_description, num_chapters)

title = generate_title(plot_outline)

# Save the book to a file
with open(f"{title}.txt", "w") as file:
    file.write(book)

create_cover_image(plot_outline)

# Create the EPUB file
create_epub(title, 'AI', chapters, '/content/cover.png')

print(f"Book saved as '{title}.txt'.")

**/
