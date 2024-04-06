import _ from "https://esm.sh/lodash";
import { OpenAI } from "https://esm.sh/openai";
import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { mem } from "./mem.mjs";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { dirname } from "https://deno.land/std/path/mod.ts";
import epub from "https://deno.land/x/epubgen/mod.ts";
import moe from "https://esm.sh/@toptensoftware/moe-js";
import pLimit from "https://esm.sh/p-limit";

// import EpubGenerator from "https://esm.sh/epub-gen";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";
await load({ export: true });

const JSON_INSTRUCT = (md) =>
    `Your response must be in JSON format ${
        md ? "inside a markdown code block" : ""
    }, with no additional text.`;

const llm = async (history, config, file) => {
    const {
        apiKey,
        model: _model,
        temperature,
        max_tokens = 4000,
        response_format,
        n = 1,
    } = config;

    // console.log(JSON.stringify(history, null, 2));
    // console.log("...running llm function...", JSON.stringify(config, null, 2));

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
            console.log(
                "LATEST:",
                JSON.stringify(newHistory.slice(-2), null, 2)
            );
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
            });
        // .concat({
        //     role: "system",
        //     content: JSON_INSTRUCT(),
        // });

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
                response_format,
                // response_format: {
                //     type: "json_object",
                // },
                messages,
                n,
            });

            // console.log("Response:", response);

            const assistantMessages = response.choices.map(({ message }) => {
                // message.content = JSON.parse(message.content);
                return message;
            });

            const newHistory = [...history, ...assistantMessages];
            // console.log("New history:", newHistory);
            console.log(
                "LATEST:",
                JSON.stringify(newHistory.slice(-2), null, 2)
            );
            return newHistory;
        } catch (error) {
            console.error("Error in llm function:", error);
            // Deno.exit();
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

            const executeFlow = async (item) => {
                const childContext = {
                    history: [...context.history],
                    blackboard: context.blackboard,
                    item,
                };

                const historyStartingLength = context.history.length;

                try {
                    await executeDSPL(clonedDspl, childContext);
                } catch (error) {
                    console.error("Error in child flow:", error);
                    // Deno.exit();
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

                if (history === "none" || forConfig?.concurrency > 1) {
                    const hiddenHistory = childContext.history
                        .slice(historyStartingLength)
                        .map((message) => ({
                            ...message,
                            meta: { hidden: true },
                        }));
                    context.history.push(...hiddenHistory);
                } else if (history === "hidden") {
                    const hiddenHistory = childContext.history
                        .slice(historyStartingLength, -1)
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
                        ...childContext.history.slice(historyStartingLength)
                    );
                } else {
                    context.history.push(
                        childContext.history.slice(historyStartingLength)
                    );
                }
            };

            if (forConfig) {
                //TODO: we need to fix array schemas

                const { each, in: arrayName } = forConfig;

                const limit = pLimit(forConfig.concurrency || 1);
                const array = await context.blackboard[arrayName];
                const processedArray = await makeList(array, context, config);

                const promises = processedArray.map((item) =>
                    limit(() => executeFlow(item))
                );
                await Promise.all(promises);
            } else if (whileConfig) {
                const { type, filter, max = 5 } = whileConfig;
                const guardModule = guardModules[type];

                if (!guardModule) {
                    throw new Error(`Unsupported guard type: ${type}`);
                }
                let i = 0;

                while (i <= max) {
                    i++;
                    const { success } = await guardModule(context, { filter });

                    if (!success) {
                        // console.log("Guard failed, breaking out of loop");
                        break;
                    }
                    if (i < max) {
                        await executeFlow();
                    }
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

        const { success, message, ...rest } = ratingContext.history
            .slice(-1)
            .pop().content;

        return {
            success,
            message: message || JSON.stringify(rest),
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
            return value(
                await blackboard._obj,
                (await item?._obj) || item || {}
            );
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

            context.history.push({
                role: "system",
                content: functionResponse
                    ? JSON.stringify(functionResponse, null, 2)
                    : "no response from function",
            });
        }
    }

    context.response = response?.response || response;

    if (parse) {
        for (const [variableName, path] of Object.entries(parse)) {
            if (typeof path === "function") {
                context.blackboard[variableName] = await path(
                    context.response,
                    context.blackboard
                );
                if (context.item) {
                    context.item[variableName] = await path(
                        context.response,
                        context.blackboard
                    );
                }
                continue;
            }
            const [bucket, key] = path.split(".");
            const _b = bucket === "$" ? "blackboard" : bucket;
            const oldValue = await context[_b][key];
            const newValue = context.response[variableName] || oldValue;
            context[_b][key] = newValue;
        }
    }

    if (set) {
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

        if (!message) {
            console.error("Guard failed to provide message:", guard, success);
            Deno.exit();
        }

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

    // console.log("makeList prompt", prompt, context, config, file);

    const res = await llm(
        [...context.history, prompt],
        {
            ...context.blackboard.$.prompt,
            response_format: { type: "json_object" },
        },
        file
    );
    const response = res.slice(-1).pop().content.response;

    try {
        return makeList(response.data || [], context, config);
    } catch (error) {
        console.error("Error parsing JSON response:", error);
        Deno.exit();
        return [];
    }
};

export default executeDSPL;
