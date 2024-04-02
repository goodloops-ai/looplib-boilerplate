import { OpenAI } from "https://esm.sh/openai";
import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import { mem } from "./mem.mjs";

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
        async execute({ content }, context, config) {
            const processedContent = replaceVariables(
                content,
                context.blackboard
            );
            context.history.push({ role: "user", content: processedContent });
            context = await this.runLLM(context, config);
            return context;
        },
        async runLLM(context, config) {
            context.history = await llm(
                context.history,
                context.blackboard.$.prompt
            );
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
                    const { type, set, ...elementData } = element;
                    const elementModule = elementModules[type];
                    loopContext = await elementModule.execute(
                        elementData,
                        loopContext,
                        config
                    );

                    if (set) {
                        console.log(
                            "Setting variable:",
                            set,
                            context.history.slice(-1).pop().content
                        );
                        loopContext.blackboard[set] = loopContext.history
                            .slice(-1)
                            .pop().content;
                    }
                }
            }

            return context;
        },
    },
    if: {
        async execute(conditionData, context, config) {
            const { condition, do: conditionElements } = conditionData;
            const evaluatedCondition = evalCondition(
                condition,
                context.blackboard
            );

            if (evaluatedCondition) {
                for (const element of conditionElements) {
                    const { type, ...elementData } = element;
                    const elementModule = elementModules[type];
                    context = await elementModule.execute(
                        elementData,
                        context,
                        config
                    );
                }
            }

            return context;
        },
    },
};

// Guard modules
const guardModules = {
    llm: async (context, guard) => {
        let retries = guard.retries;
        while (retries > 0) {
            const ratingPrompt = {
                role: "user",
                content: `${guard.filter}\n respond with a json object with two keys, reasoning (a string explaining yourself) and pass: (true or false)`,
            };
            const ratingContext = await elementModules.prompt.runLLM({
                history: [...context.history, ratingPrompt],
                blackboard: context.blackboard,
            });

            const { reasoning, pass } = JSON.parse(
                ratingContext.history.slice(-1).pop().content.trim()
            );

            console.log("Rating:", reasoning, pass);

            if (pass) {
                console.log("Guard condition met!");
                return context;
            } else if (guard.recovery_prompt) {
                context.history = ratingContext.history;
                const recoveryPrompt = {
                    role: "user",
                    content: guard.recovery_prompt,
                };
                context.history.push(recoveryPrompt);
                context = await elementModules.prompt.runLLM(context);
                retries--;
            } else {
                context.history.pop();
                context = await elementModules.prompt.runLLM(context);
                retries--;
            }
        }

        throw new Error(
            `Failed to satisfy guard condition after ${guard.retries} tries.`
        );
    },
};

// Execution engine
async function executeDSPL(dsplCode) {
    const dsplObject = JSON.parse(dsplCode);
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
        const { type, set, ...elementData } = element;
        const elementModule = elementModules[type];

        if (!elementModule) {
            throw new Error(`Unsupported element type: ${type}`);
        }

        context = await elementModule.execute(elementData, context);

        if (set) {
            console.log(
                "Setting variable:",
                set,
                context.history.slice(-1).pop().content
            );
            context.blackboard[set] = context.history.slice(-1).pop().content;
        }

        console.log("Element execution completed successfully!", context);
        if (elementData.guards) {
            for (const guard of elementData.guards) {
                const guardModule = guardModules[guard.type];

                if (!guardModule) {
                    throw new Error(`Unsupported guard type: ${guard.type}`);
                }

                context = await guardModule(context, guard);
            }
        }
    }

    console.log("DSPL execution completed successfully!");
    console.log("Final context:", context);
    return context;
}

// Helper functions
function replaceVariables(content, blackboard) {
    return content.replace(/{([^}]+)}/g, (_, variableName) => {
        return blackboard[variableName] || "";
    });
}

function evalCondition(condition, blackboard) {
    const processedCondition = replaceVariables(condition, blackboard);
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
const dspl = `{
  "elements": [
    {
        "type": "init",
        "content": {
            "$": {
                "prompt": {
                    "model": "gpt-3.5-turbo",
                    "temperature": 0.3
                }
            }
        }
    },
    {
      "type": "prompt",
      "content": "write a sonnet about the moon",
      "set": "sonnet",
      "guards": [
        {
          "type": "llm",
          "filter": "Is the poem a 10/10?",
          "recovery_prompt": "Improve the poem",
          "retries": 3
        }
      ]
    }
  ]
}`;
const poemdspl = `{
  "elements": [
    {
      "type": "init",
      "content": {
        "$": {
            "prompt": {
            "model": "gpt-4-0125-preview",
            "temperature": 0.3
            }
        }
      }
    },
    {
      "type": "prompt",
      "mode": "json",
      "content": "give me a list of animals, one for each letter of the alphabet, each starting with the letter of the alphabet it corresponds to.",
      "set": "animals"
    },
    {
      "type": "for",
      "each": "animal",
      "in": "animals",
      "do": [
        {
          "type": "prompt",
          "mode": "json",
          "content": "write me a short children's book poem about {animal}",
          "set": "poem"
        }
      ]
    }
  ]
}`;

const result = await executeDSPL(dspl);
console.log(await result.blackboard.sonnet);
