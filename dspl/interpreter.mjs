import _ from "https://esm.sh/lodash";
import { OpenAI } from "https://esm.sh/openai";
import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { mem } from "./mem.mjs";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { dirname } from "https://deno.land/std/path/mod.ts";
import epub from "https://deno.land/x/epubgen/mod.ts";
import moe from "https://esm.sh/@toptensoftware/moe-js";
import pLimit from "https://esm.sh/p-limit";
import he from "https://esm.sh/he";

// import EpubGenerator from "https://esm.sh/epub-gen";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";
await load({ export: true });

const JSON_INSTRUCT = (md) =>
    `Your response must be in JSON format ${
        md ? "inside a markdown code block" : ""
    }, with no additional text.`;

const llm = async (history, config, file) => {
    const META_OMIT_HISTORY = Deno.env.get("META_OMIT_HISTORY") === "true";
    const {
        apiKey,
        model: _model,
        temperature,
        max_tokens = 4000,
        response_format,
        showHidden,
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
            .filter((item) => showHidden || item.meta?.hidden !== true)
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
        let messages = history
            .filter((item) => !Array.isArray(item))
            .filter((item) => item.content)
            .filter((item) => showHidden || item.meta?.hidden !== true)
            .map(({ role, content }) => ({ role, content }))
            .map(({ role, content }) => {
                content = !(typeof content === "string")
                    ? JSON.stringify(content, null, 2)
                    : content;

                role = role || "system";

                return { role, content };
            });
        // .concat({
        //     role: "system",
        //     content: JSON_INSTRUCT(),
        // });

        if (showHidden) {
            console.log("Show hidden messages enabled!");
            console.log(JSON.stringify(messages, null, 2));
            console.log(JSON.stringify(history, null, 2));
            // Deno.exit();
        }
        const openai = new OpenAI({
            dangerouslyAllowBrowser: true,
            apiKey: Deno.env.get("OPENAI_API_KEY"),
        });

        try {
            let rf = response_format;
            if (config.mode === "json") {
                rf = { type: "json_object" };
                messages = messages.concat({
                    role: "system",
                    content: JSON_INSTRUCT(),
                });
            }
            console.log("Messages:", messages);
            const response = await openai.chat.completions.create({
                model,
                temperature,
                max_tokens,
                response_format: rf,
                messages,
                n,
            });

            const assistantMessages = response.choices.map(({ message }) => {
                // message.content = JSON.parse(message.content);

                if (!META_OMIT_HISTORY) {
                    message.meta = {
                        history: messages
                            .slice(0)
                            .map(({ content, role }) => ({ content, role })),
                    };
                }

                if (config.mode === "json") {
                    message.content = JSON.parse(message.content);
                }

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
            return [
                {
                    role: "system",
                    content: "Blackboard initialized successfully!",
                    meta: {
                        hidden: true,
                    },
                },
            ];
        },
    },
    prompt: {
        async execute({ content, ...config }, context) {
            const processedContent = he.decode(
                await moe.compile(content, {
                    asyncTemplate: true,
                })(context.blackboard)
            );
            const newContext = {
                ...context,
                history: [
                    ...context.history,
                    { role: "user", content: processedContent },
                ],
            };
            const messages = await this.runLLM(newContext, config);
            return messages;
        },
        async runLLM(context, config = {}) {
            const originalHistory = context.history.slice(0).length;
            const newMessages = await llm(context.history, {
                ...context.blackboard.$.prompt,
                ...config,
            });
            return newMessages.slice(originalHistory);
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
                console.log("Executing flow for item:", item);
                const childContext = {
                    history: [...context.history],
                    blackboard: context.blackboard,
                    item,
                };

                // const beginSnapshot = await context.blackboard._obj;

                const cacheHistory = context.history.slice(0);
                const historyStartingLength = context.history.length;

                try {
                    const { steps, context } = await executeDSPL(
                        clonedDspl,
                        childContext
                    );
                    const newBlackboard = await context.blackboard._obj;
                    return {
                        blackboard: newBlackboard,
                        item: await context.item?._obj,
                        steps,
                    };
                } catch (error) {
                    console.error("Error in child flow:", error);
                    return {
                        context: childContext,
                        steps: [
                            {
                                history: cacheHistory,
                                step: {
                                    type: "error",
                                },
                                messages: [
                                    {
                                        role: "system",
                                        content: `Error in child flow: ${error.message}, ${error.stack}`,
                                    },
                                ],
                            },
                        ],
                    };
                }
            };

            let runs = [];

            if (forConfig) {
                const { each, in: arrayName } = forConfig;

                const limit = pLimit(forConfig.concurrency || 1);
                const array = await context.blackboard[arrayName];
                const processedArray = await makeList(array, context, config);
                console.log("Processed array:", processedArray);
                const promises = processedArray.map((item) =>
                    limit(async () => {
                        const res = await executeFlow(item);
                        console.log("Processed item:", res);
                        return res;
                    })
                );
                runs = await Promise.all(promises);
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
                        break;
                    }
                    if (i < max) {
                        runs.push(await executeFlow());
                    }
                }
            } else {
                runs.push(await executeFlow());
            }

            return runs;
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

            return [
                {
                    role: "system",
                    content: `Image generated successfully. Saved to ${imagePath}`,
                    meta: {
                        hidden: true,
                    },
                },
            ];
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

            return [
                {
                    role: "system",
                    content: `EPUB file generated successfully! Saved to ${epubPath}`,
                    meta: {
                        hidden: true,
                    },
                },
            ];
        },
    },
    message: {
        async execute({ role, content }, context) {
            return [{ role, content }];
        },
    },
    import: {
        async execute({ import: importMap }, context) {
            for (const [key, value] of Object.entries(importMap)) {
                const importedModule = await import(value);
                globalThis[key] = context.blackboard[key] = importedModule[key];
            }
            return [
                {
                    role: "system",
                    content: "Modules imported successfully!",
                    meta: {
                        hidden: true,
                    },
                },
            ];
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
        const ratingMessages = await elementModules.prompt.runLLM(
            {
                history: [...context.history, ratingPrompt],
                blackboard: context.blackboard,
            },
            { response_format: { type: "json_object" } }
        );

        const { success, message, ...rest } = ratingMessages
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
    let steps = [];

    for (const element of dsplObject.elements) {
        const history = context.history.slice(0);
        const newContext = {
            history,
        };
        newContext.blackboard = context.blackboard;
        const elementMessages = await executeStep(element, context);
        console.log("Element messages:", elementMessages);
        context.history.push(...elementMessages);
        steps.push({
            blackboard: await context.blackboard._obj,
            step: element,
            trace: elementMessages,
        });
    }

    console.log("DSPL execution completed successfully!", context.blackboard);
    return { steps, context };
}

async function executeStep(
    element,
    context,
    config = {},
    retries = element.retries || 0
) {
    console.log("Executing element:", element.type);
    const { type, parse, set, ...elementData } = element;
    const elementModule = elementModules[type];

    let messages = context.history.slice(0);

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
            return await he.decode(
                await template({ $: blackboard, item: item })
            );
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
    const originalHistoryLength = messages.length;
    const newMessages = await elementModule.execute(
        resolvedElementData,
        context,
        {
            ...config,
            ...resolvedElementData,
        }
    );

    messages.push(...newMessages);

    const response = messages.slice(-1).pop()?.content;
    // console.log("Element response:", JSON.stringify(response, null, 2));

    if (typeof response === "object") {
        if (response.function) {
            const functionResponse = await new Function(
                `return ${response.function}`
            )();

            messages.push({
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
                if (context.item) {
                    context.item[variableName] = await path(
                        context.response,
                        context.blackboard
                    );
                } else {
                    context.blackboard[variableName] = await path(
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
        if (context.item) {
            context.item[set] = response?.response || response;
        } else {
            context.blackboard[set] = response?.response || response;
        }
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
            messages.push({
                role: "user",
                content: message,
            });

            if (retries > 0) {
                if (guard.policy === "retry") {
                    messages = messages.slice(0, originalHistoryLength).concat(
                        messages.slice(originalHistoryLength).map((message) => {
                            if (!message.meta) {
                                message.meta = { hidden: true };
                            } else if (!message.meta.hidden) {
                                message.meta.hidden = true;
                            }
                            return message;
                        })
                    );
                    const newContext = {
                        ...context,
                        history: messages,
                    };
                    const newMessages = await executeStep(
                        {
                            type,
                            parse,
                            set,
                            ...elementData,
                            retries: retries - 1,
                        },
                        newContext,
                        config,
                        retries - 1
                    );

                    messages.push(...newMessages);
                    return messages.slice(originalHistoryLength);
                } else if (guard.policy === "append") {
                    const newContext = {
                        ...context,
                        history: messages,
                    };
                    const newMessages = await executeStep(
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
                        newContext,
                        config,
                        retries - 1
                    );
                    messages.push(...newMessages);
                    return messages.slice(originalHistoryLength);
                }
            } else {
                guardFailed = true;
                if (elementData.onFail) {
                    for (const failElement of elementData.onFail) {
                        const newContext = {
                            ...context,
                            history: messages,
                        };
                        const newMessages = await executeStep(
                            failElement,
                            newContext,
                            config
                        );

                        messages.push(...newMessages);
                    }
                }
            }
            break;
        }
    }

    if (!guardFailed && elementData.onSuccess) {
        for (const successElement of elementData.onSuccess) {
            const newContext = {
                ...context,
                history: messages,
            };
            const newMessages = await executeStep(
                successElement,
                context,
                config
            );
            messages.push(...newMessages);
        }
    }

    if (elementData.finally) {
        for (const finallyElement of elementData.finally) {
            const newContext = {
                ...context,
                history: messages,
            };
            const newMessages = await executeStep(
                finallyElement,
                newContext,
                config
            );
            messages.push(...newMessages);
        }
    }

    return messages.slice(originalHistoryLength);
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

    console.log(res);
    const response = res.slice(-1).pop().content;

    try {
        return makeList(response.data || [], context, config);
    } catch (error) {
        console.error("Error parsing JSON response:", error);
        Deno.exit();
        return [];
    }
};

export default executeDSPL;
