import { OpenAI } from "https://esm.sh/openai";
import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";

await load({ export: true });

const llm = async (history, config, file) => {
    const { apiKey, model, temperature, max_tokens, response_format } = config;

    const messages = history
        .filter((item) => item.meta?.hidden !== true)
        .map(({ role, content }) => ({ role, content }));

    const openai = new OpenAI({
        dangerouslyAllowBrowser: true,
        apiKey,
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
    prompt: {
        async execute(content, context, config) {
            context.push({ role: "user", content });
            context = await this.runLLM(context, config);
            return context;
        },
        async runLLM(
            context,
            config = {
                apiKey: Deno.env.get("OPENAI_API_KEY"),
                model: "gpt-3.5-turbo",
                temperature: 0.3,
                max_tokens: 1000,
                response_format: undefined,
            }
        ) {
            return await llm(context, config);
        },
    },
    // Add more element modules as needed
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
            const ratingContext = await elementModules.prompt.runLLM([
                ...context,
                ratingPrompt,
            ]);

            const { reasoning, pass } = JSON.parse(
                ratingContext.slice(-1).pop().content.trim()
            );

            console.log("Rating:", reasoning, pass);

            if (pass) {
                console.log("Guard condition met!");
                return context;
            } else if (guard.recovery_prompt) {
                context = ratingContext;
                const recoveryPrompt = {
                    role: "user",
                    content: guard.recovery_prompt,
                };
                context.push(recoveryPrompt);
                context = await elementModules.prompt.runLLM(context);
                retries--;
            } else {
                context.pop();
                context = await elementModules.prompt.runLLM(context);
                retries--;
            }
        }

        throw new Error(
            `Failed to satisfy guard condition after ${guard.retries} tries.`
        );
    },
    // Add more guard modules as needed
};

// Execution engine
async function executeDSPL(dsplCode) {
    const dsplObject = JSON.parse(dsplCode);
    let context = [
        {
            role: "system",
            content: "You are a helpful assistant.",
        },
    ];

    for (const element of dsplObject.elements) {
        const { type, ...elementData } = element;
        const elementModule = elementModules[type];

        if (!elementModule) {
            throw new Error(`Unsupported element type: ${type}`);
        }

        context = await elementModule.execute(elementData.content, context);

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
}

// Example usage
const dsplCode = `{
  "elements": [
    {
      "type": "prompt",
      "content": "write a haiku about the moon",
      "guards": [
        {
          "type": "llm",
          "filter": "Is this a good Haiku?",
          "recovery_prompt": "Try writing the Haiku again",
          "retries": 3
        }
      ]
    }
  ]
}`;

executeDSPL(dsplCode);
