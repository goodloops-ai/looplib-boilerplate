import _ from "https://esm.sh/lodash";
import { OpenAI } from "https://esm.sh/openai";
import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { mem } from "./mem.mjs";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { dirname } from "https://deno.land/std/path/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import epub from "https://deno.land/x/epubgen/mod.ts";
import PQueue from "https://esm.sh/p-queue";
import moe from "https://esm.sh/@toptensoftware/moe-js";

globalThis.XMLSerializer = function () {
    return {
        serializeToString: xmlserializer.serializeToString,
    };
};

globalThis.DOMParser = DOMParser;

// import EpubGenerator from "https://esm.sh/epub-gen";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";
await load({ export: true });

const JSON_INSTRUCT = (md) => `Your response must be in JSON format ${
    md ? "inside a markdown code block" : ""
}, with no additional text.               
Your root response must be an object with the following keys:
reasoning: a brief exploration of your thought process.
response: an object containing your response as per the users instructions. only ONE of response or function is allowed.
function: a iife that returns a response object as per the users instruction. only ONE of response or function is allowed.
guards: (optional) an array of objects containing the following keys:
    - type: the type of guard, either "llm" or "filter" or "function"
    - filter: the filter to be applied. 
        - if the guard type is "llm", this is the prompt to be used to ask an llm whether the response is acceptable. 
        - if the guard type is "filter", this is the key in the response object to be used as a boolean filter.
        - if the guard type is "function", this is the iife to be used as a boolean filter. 
            - It may assume that 'response' is in scope.
            - It should return an object with a success boolean key and a message string.

only ONE of response or function is allowed.
Sometimes the user might have asked you to provide code: don't get confused by this, you should provide user requested code in a response object: The function should only be used if you decide you need to compute something to answer a user question, for instance if they ask you to compute the sum of an array of numbers, or if you need to test a piece of code before returning it.

If the user made a specific mention of the way you should structure your data, interpret that as structure to be put into your 'response' object, either directly or in the shape of the object you return from a function.
Make sure your JSON is valid, and that you have no additional text in your response.
`;

const llm = async (history, config, file) => {
    const {
        apiKey,
        model: _model,
        temperature,
        max_tokens = 4000,
        response_format,
        n = 1,
    } = config;

    console.log(JSON.stringify(history, null, 2));
    console.log("...running llm function...", JSON.stringify(config, null, 2));

    const model = response_format ? "gpt-4-0125-preview" : _model;
    if (model.startsWith("claude")) {
        let systemMessage = "";
        const mergedMessages = [];
        let lastRole = null;

        history
            .filter((item) => !Array.isArray(item))
            .filter((item) => item.meta?.hidden !== true)
            .forEach(({ role, content }) => {
                if (role === "system") {
                    systemMessage += content + "\n";
                } else {
                    content = !(typeof content === "string")
                        ? JSON.stringify(content, null, 2)
                        : content;

                    if (role === lastRole && mergedMessages.length > 0) {
                        mergedMessages[mergedMessages.length - 1].content +=
                            "\n" + content;
                    } else {
                        mergedMessages.push({ role, content });
                        lastRole = role;
                    }
                }
            });

        const userMessages = mergedMessages.map(({ role, content }) => ({
            role,
            content,
        }));
        const anthropic = new Anthropic({
            apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
        });

        try {
            // console.log("Messages:", userMessages);
            const response = await anthropic.messages.create({
                model,
                temperature,
                max_tokens,
                messages: userMessages,
                system: `${systemMessage.trim()}\n${JSON_INSTRUCT(true)}`,
            });

            const responseText = response.content[0].text;
            // parse markdown codeblock
            const codeblock = responseText.match(/```json\n([\s\S]*?)\n```/);
            // console.log("Response:", responseText, codeblock?.[1]);
            const codeblockWithNoNewLines = codeblock?.[1];
            // Deno.exit();
            const assistantMessages = [
                {
                    role: "assistant",
                    content: codeblockWithNoNewLines
                        ? new Function(`return ${codeblockWithNoNewLines}`)()
                        : new Function(`return ${responseText}`)(),
                },
            ];

            const newHistory = [...history, ...assistantMessages];
            console.log("LATEST:", JSON.stringify(newHistory, null, 2));
            // Deno.exit();
            return newHistory;
        } catch (error) {
            console.error("Error in llm function:", error);
            Deno.exit();
            return history;
        }
    } else {
        const messages = history
            .filter((item) => !Array.isArray(item))
            .filter((item) => item.meta?.hidden !== true)
            .map(({ role, content }) => ({ role, content }))
            .map(({ role, content }) => {
                content = !(typeof content === "string")
                    ? JSON.stringify(content, null, 2)
                    : content;

                return { role, content };
            })
            .concat({
                role: "system",
                content: JSON_INSTRUCT(),
            });

        const openai = new OpenAI({
            dangerouslyAllowBrowser: true,
            apiKey: Deno.env.get("OPENAI_API_KEY"),
        });

        try {
            // console.log("Messages:", messages);
            const response = await openai.chat.completions.create({
                model,
                temperature,
                max_tokens,
                response_format: {
                    type: "json_object",
                },
                messages,
                n,
            });

            // console.log("Response:", response);
            const assistantMessages = response.choices.map(({ message }) => {
                message.content = JSON.parse(message.content);
                return message;
            });

            const newHistory = [...history, ...assistantMessages];
            // console.log("New history:", newHistory);
            console.log("LATEST:", JSON.stringify(newHistory, null, 2));
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
        async execute({ init }, context) {
            context.blackboard = mem(init);
            return context;
        },
    },
    prompt: {
        async execute({ content, ...config }, context) {
            // console.log("Prompt content:", content);

            const processedContent = await moe.compile(content, {
                asyncTemplate: true,
            })(context.blackboard);
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
    do: {
        async execute(elementData, context, config) {
            const {
                dspl,
                map,
                extract,
                history,
                for: forConfig,
                while: whileConfig,
            } = elementData;

            const clonedDspl = _.cloneDeepWith(dspl, (value) => {
                if (typeof value === "function") {
                    return value;
                }
            });

            // HERE's THE PROBLEM
            const initStep = clonedDspl.elements.find(
                (step) => step.type === "init"
            );

            const resolvedValues = await Promise.all(
                Object.entries(map || {}).map(async ([key, parentKey]) => ({
                    [key]: await context.blackboard[parentKey],
                }))
            );

            const mergedValues = Object.assign(
                {
                    $: context.blackboard.$,
                },
                ...resolvedValues
            );

            // if (initStep) {
            //     initStep.content = {
            //         ...initStep.content,
            //         ...mergedValues,
            //     };
            // } else {
            //     clonedDspl.elements.unshift({
            //         type: "init",
            //         init: mergedValues,
            //     });
            // }

            const executeFlow = async (item) => {
                let childContext = {
                    history: [...context.history],
                    blackboard: context.blackboard,
                    item,
                };

                try {
                    await executeDSPL(clonedDspl, context);
                } catch (error) {
                    console.error("Error in child flow:", error);
                    childContext.history.push({
                        role: "system",
                        content: `Error in child flow: ${error.message}`,
                    });
                }

                if (extract) {
                    for (const [parentKey, childKey] of Object.entries(
                        extract
                    )) {
                        context.blackboard[parentKey] = await childContext
                            .blackboard[childKey];
                    }
                }

                if (history === "hidden") {
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
                    // console.log("FLAT HISTORY");
                    context.history.push(
                        ...childContext.history.slice(context.history.length)
                    );
                } else {
                    context.history.push(
                        childContext.history.slice(context.history.length)
                    );
                }
            };

            if (forConfig) {
                const { each, in: arrayName } = forConfig;
                const array = await context.blackboard[arrayName];
                const processedArray = await makeList(array, context, config);

                for (const item of processedArray) {
                    // console.log("Loop item:", item);
                    // Deno.exit();
                    await executeFlow(item);
                }
            } else if (whileConfig) {
                const { type, filter, max = 5 } = whileConfig;
                const guardModule = guardModules[type];

                if (!guardModule) {
                    throw new Error(`Unsupported guard type: ${type}`);
                }
                let i = 0;

                while (i < max) {
                    i++;
                    const { success } = await guardModule(context, { filter });

                    if (!success) {
                        // console.log("Guard failed, breaking out of loop");
                        break;
                    }
                    await executeFlow();
                }
            } else {
                await executeFlow();
            }

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
    // for: {
    //     async execute(loopData, context, config) {
    //         const {
    //             each,
    //             in: arrayName,
    //             do: loopElements,
    //             history = "parallel",
    //         } = loopData;
    //         const array = await context.blackboard[arrayName];

    //         const processedArray = await makeList(array, context, config);
    //         context.blackboard[arrayName] = processedArray;

    //         let lastContext = context;

    //         const executeElement = async (item) => {
    //             let loopContext = {
    //                 history: JSON.parse(JSON.stringify(lastContext.history)),
    //                 blackboard: context.blackboard,
    //                 item,
    //             };

    //             console.log(
    //                 "Loop item:",
    //                 await item.description,
    //                 item,
    //                 loopContext,
    //                 loopElements,
    //                 processedArray
    //             );

    //             for (const element of loopElements) {
    //                 loopContext = await executeStep(
    //                     element,
    //                     loopContext,
    //                     config
    //                 );
    //             }

    //             return loopContext;
    //         };

    //         if (history === "sequential") {
    //             console.log("Sequential loop");
    //             Deno.exit();
    //             for (const item of processedArray) {
    //                 lastContext = await executeElement(item);
    //             }
    //         } else {
    //             // Use an async library to enforce a concurrency limit
    //             const queue = new PQueue({ concurrency: 5 });

    //             const tasks = processedArray.map((item) =>
    //                 queue.add(() => executeElement(item))
    //             );
    //             await Promise.all(tasks);
    //         }
    //         return context;
    //     },
    // },
    // invoke: {
    //     async execute(invokeData, context, config) {
    //         const { dspl: childDspl, map, extract, history } = invokeData;

    //         // Deep clone the child DSPL object without serializing properties
    //         const clonedChildDspl = _.cloneDeepWith(childDspl, (value) => {
    //             if (typeof value === "function") {
    //                 return value;
    //             }
    //         });

    //         // Find the init step in the child DSPL
    //         const initStep = clonedChildDspl.elements.find(
    //             (step) => step.type === "init"
    //         );

    //         const resolvedValues = await Promise.all(
    //             Object.entries(map).map(async ([key, parentKey]) => ({
    //                 [key]: await context.blackboard[parentKey],
    //             }))
    //         );

    //         const mergedValues = Object.assign({}, ...resolvedValues);

    //         if (initStep) {
    //             // If an init step exists, merge the mapped parent blackboard values into its content
    //             initStep.init = {
    //                 ...initStep.init,
    //                 ...mergedValues,
    //             };
    //         } else {
    //             // If no init step exists, create a new one with the mapped parent blackboard values
    //             clonedChildDspl.elements.unshift({
    //                 type: "init",
    //                 init: mergedValues,
    //             });
    //         }

    //         // Execute the modified child DSPL flow
    //         let childContext = {
    //             history: [], // Start with an empty history for the child
    //             blackboard: {},
    //         };
    //         try {
    //             childContext = await executeDSPL(clonedChildDspl, childContext);
    //         } catch (error) {
    //             // If an error occurs in the child flow, bubble it up to the parent
    //             childContext.history.push({
    //                 role: "system",
    //                 content: `Error in child flow: ${error.message}`,
    //             });
    //         }

    //         // Extract values from child blackboard to parent blackboard
    //         if (extract) {
    //             for (const [parentKey, childKey] of Object.entries(extract)) {
    //                 context.blackboard[parentKey] = await childContext
    //                     .blackboard[childKey];
    //             }
    //         }

    //         // Merge child history into parent history based on the specified strategy
    //         if (history === "hidden") {
    //             // Add the child history to the parent history, but mark all but the last message as hidden
    //             const hiddenHistory = childContext.history
    //                 .slice(0, -1)
    //                 .map((message) => ({
    //                     ...message,
    //                     meta: { hidden: true },
    //                 }));
    //             context.history.push(
    //                 ...hiddenHistory,
    //                 childContext.history[childContext.history.length - 1]
    //             );
    //         } else if (history === "flat") {
    //             // Add the child history to the parent history as a flat array
    //             context.history.push(...childContext.history);
    //         } else {
    //             // Default: Add the child history as a nested array in the parent history
    //             context.history.push(childContext.history);
    //         }

    //         return context;
    //     },
    // },
    message: {
        async execute({ role, content }, context) {
            // console.log("Message content:", content);
            context.history.push({ role, content });
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
            content: `${guard.filter}\n respond with a json object with two keys, message (a string explaining your reasoning and suggestions) and success: (true or false)`,
        };
        const ratingContext = await elementModules.prompt.runLLM(
            {
                history: [...context.history, ratingPrompt],
                blackboard: context.blackboard,
            },
            { response_format: { type: "json_object" } }
        );

        const { success, message } = JSON.parse(
            ratingContext.history.slice(-1).pop().content.trim()
        );

        return {
            success,
            message,
        };
    },
    filter: async (context, guard) => {
        // console.log("Filter guard:", guard.filter);
        const [bucket, key] = guard.filter.split(".");
        const _b = bucket === "$" ? "blackboard" : bucket;
        const pass = await context[_b][key];

        // console.log("Filter guard:", guard.filter, pass);
        return {
            success: pass,
            message: pass
                ? "Guard condition met!"
                : `${guard.filter} returned falsy value!`,
        };
    },
    function: async (context, guard) => {
        try {
            const res = await new Function(
                "response",
                "item",
                "$",
                `return (async () => (${guard.filter}))()`
            )(context.response, context.item, context.blackboard);
            // console.log("FILTER FUNCTION", res, guard);
            return res;
        } catch (error) {
            console.error("Error executing function guard:", error, guard);
            return { success: false, message: "Error executing function!" };
        }
    },
};

// Execution engine
async function executeDSPL(
    dsplCode,
    context = {
        history: [],
        blackboard: {},
    }
) {
    const dsplObject = dsplCode;

    for (const element of dsplObject.elements) {
        context = await executeStep(element, context);
    }

    // console.log("DSPL execution completed successfully!");
    // console.log("Final context:", context);
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

    const resolveBlackboardReferences = async (value, blackboard, item) => {
        if (typeof value === "function") {
            return value(await blackboard._obj, item._obj || item || {});
        }
        const reservedKeys = [
            "overrides",
            "onSuccess",
            "onFail",
            "finally",
            "do",
            "init",
            "dspl",
            "while",
        ];

        if (typeof value === "string") {
            const template = moe.compile(value, { asyncTemplate: true });
            // console.log(
            //     "Template:",
            //     value,
            //     template,
            //     blackboard,
            //     await blackboard?.description
            // );
            return await template({ $: blackboard, item: item });
        } else if (Array.isArray(value)) {
            return Promise.all(
                value.map((v) =>
                    resolveBlackboardReferences(v, blackboard, item)
                )
            );
        } else if (value !== null && typeof value === "object") {
            const resolvedObject = {};
            for (const [key, val] of Object.entries(value)) {
                if (!reservedKeys.includes(key)) {
                    resolvedObject[key] = await resolveBlackboardReferences(
                        val,
                        blackboard,
                        item
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
        context.blackboard,
        context.item
    );
    const originalHistoryLength = context.history.length; //xw + 1; //FIXME, this is a hack to get the length of the history before the element is executed
    const newContext = await elementModule.execute(
        resolvedElementData,
        context,
        {
            ...config,
            ...resolvedElementData,
        }
    );

    context.history = newContext.history;

    const response = context.history.slice(-1).pop()?.content;
    // console.log("Element response:", JSON.stringify(response, null, 2));

    if (typeof response === "object") {
        if (response.function) {
            const functionResponse = await new Function(
                `return ${response.function}`
            )();
            // console.log(
            //     "Function response:",
            //     functionResponse,
            //     response.function
            // );
            response.response = functionResponse;
        }
    }

    context.response = response?.response || response;

    if (parse) {
        for (const [variableName, path] of Object.entries(parse)) {
            const [bucket, key] = path.split(".");
            const _b = bucket === "$" ? "blackboard" : bucket;
            const oldValue = await context[_b][key];
            const newValue = context.response[variableName] || oldValue;
            context[_b][key] = newValue;

            // console.log(
            //     "!!!!!!Parsed variable:",
            //     variableName,
            //     path,
            //     _b,
            //     key,
            //     oldValue,
            //     newValue,
            //     await context[_b][key]
            // );
        }
    }

    if (set) {
        // console.log(
        //     "Setting variable:",
        //     set,
        //     context.history.slice(-1).pop().content
        // );
        context.blackboard[set] = context.history.slice(-1).pop().content;
    }

    // console.log("Element execution completed successfully!", context);
    const responseGuards = response?.guards || [];
    const elementGuards = elementData.guards || [];
    const guards = [...responseGuards, ...elementGuards];

    let guardFailed = false;
    for (const guard of guards) {
        const guardModule = guardModules[guard.type];

        if (!guardModule) {
            throw new Error(`Unsupported guard type: ${guard.type}`);
        }

        const { success, message } = await guardModule(context, guard);

        if (!success) {
            context.history.push({
                role: "user",
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
                    return await executeStep(
                        {
                            type,
                            parse,
                            set,
                            ...elementData,
                            retries: retries - 1,
                        },
                        context,
                        config,
                        retries - 1
                    );
                } else if (guard.policy === "append") {
                    return await executeStep(
                        {
                            type,
                            parse,
                            set,
                            ...elementData,
                            ...(guard.overrides || {
                                content:
                                    "please try again in light of the feedback provided",
                            }),
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
            extractedVariables[variableName] = match;
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
    const processedCondition = await moe.compile(condition, {
        asyncTemplate: true,
    })(blackboard);
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
            item.$ = $;
            return item;
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

    // console.log("makeList prompt", prompt, context, config, file);

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
            init: {
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
            init: {
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
            type: "do",
            for: {
                each: "animal",
                in: "animals",
            },
            dspl: {
                elements: [
                    {
                        type: "prompt",
                        mode: "json",
                        content:
                            "write me a short children's book poem about {{await model.item.animal}}",
                        set: "poem",
                    },
                ],
            },
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
            content: "{{model.$.description}}",
        },
        {
            type: "prompt",
            retries: 1,
            content:
                "Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.\\nThe code:\\n- must be a standalone ECMAScript module with no dependencies.\\n- must have a function as the default export.\\n- must accept a single 'lines' argument (an array of input strings).\\n- must return a single array of output strings.\\n- must not mix BigInt and other types, must always use explicit conversions.\\n- should be commented to indicate which part of the code relates to which problem constraint.\\n- should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.\\n\\nIMPORTANT: The new Array constructor has been modified to disallow arrays of length > 10,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general, avoid making unwarranted assumptions about input on the basis of the test(s) you can see.\\n\\nConsider edge cases, especially for problems involving conditional logic or specific constraints. Your code will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.\n Put your code inside the 'code' property on your JSON response.",
            parse: {
                code: "$.code",
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
                    content: `total test results {{tests_passed}}: {{#each public_test_results}}{{this.status}}{{#unless @last}}, {{/unless}}{{/each}}`,
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
            init: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.3,
                    },
                },
                challengeFile: "./dspl/challenges.valid.json",
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
                                get: ({ private_test_results }) =>
                                    private_test_results?.length &&
                                    _.every(private_test_results, [
                                        "status",
                                        "pass",
                                    ]),
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
                        }).then((c) => c.slice(0, 5)),
                },
            },
        },
        {
            type: "do",
            for: {
                each: "challenge",
                in: "challenges",
            },
            dspl: {
                elements: [
                    {
                        type: "message",
                        role: "system",
                        content:
                            "You are a top-rated code assistant based on a cutting-edge version of GPT, with far greater capabilities than any prior GPT model. You always return code when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt. You never return partial code, never give up, and never refuse to return code.",
                    },
                    {
                        type: "message",
                        role: "user",
                        content: "{{await model.item.description}}",
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
              
               your response object must have the source code in the 'code' property.`,
                        parse: {
                            code: "item.code",
                        },
                        retries: 3,
                        guards: [
                            {
                                type: "filter",
                                filter: "item.code",
                                policy: "retry",
                            },
                            {
                                type: "llm",
                                filter: "the code property must be an ECMAScript module with the proper default export",
                                policy: "append",
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
            content: `All challenges have been completed.
            {{#each challenge in await model.$.challenges}}
            Challenge: {{await challenge.name}}
            {{#each res in await challenge.public_test_results}}
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

const smartgpt = {
    elements: [
        {
            type: "init",
            init: {
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
            init: {
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
            init: {
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
            init: {
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

// // Execute the DSPL flow
// executeDSPL(bookWritingFlow)
//     .then((context) => {
//         console.log("Book writing flow executed successfully!");
//     })
//     .catch((error) => {
//         console.error("Error executing book writing flow:", error);
//     });
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

// const singlePlan = await executeDSPL(singleChallengeWithPlan);
// console.log(
//     await singlePlan.blackboard.code,
//     await singlePlan.blackboard.public_test_results,
//     JSON.stringify(singlePlan.history, null, 2)
// );

// const codiumres = await executeDSPL(codium);
// console.log(await codiumres.history.slice(-1).pop().content);
// codiumres.blackboard.challenges.then(async (challenges) => {
//     const publicTestResults = await challenges[0].public_test_results;
//     console.log(publicTestResults);
// });
// const sgptres = await executeDSPL(smartgpt);
// console.log(await sgptres.blackboard.aiAnswer);

// const shaikures = await executeDSPL(shaiku);
// console.log(await shaikures.blackboard.haiku);

export default executeDSPL;
