import { z } from "zod";
import OpenAI from "openai";
import { mergeMap, Observable } from "rxjs";
import { wrap, schema as base } from "./operator.mjs";

export function gpt(config) {
    const concurrency = get("concurrency", 10, config);

    return mergeMap(({ messages, blackboard, env }) => {
        const apiKey = get("OPENAI_API_KEY", "", config, env);
        const onContent = get("onContent", (chunk) => chunk, config, env);
        const streamOptions = {
            model: get("model", "gpt-3.5-turbo", config, env),
            temperature: get("temperature", 0.3, config, env),
            max_tokens: get("max_tokens", 4000, config, env),
            response_format: get("response_format", undefined, config, env),
            messages: messages.map((item) =>
                item.role
                    ? item
                    : {
                          role: "system",
                          content: JSON.stringify(item),
                      }
            ),
        };
        const openai = new OpenAI({
            dangerouslyAllowBrowser: true,
            apiKey,
        });
        const stream = openai.beta.chat.completions.stream({
            ...streamOptions,
            stream: true,
        });

        return new Observable((subscriber) => {
            stream.on("content", (chunk, snapshot) =>
                onContent({ chunk, snapshot })
            );
            stream.on("error", (error) => subscriber.error(error));
            stream.on("abort", () => subscriber.complete());
            stream.on("end", () => {
                subscriber.next({
                    env,
                    messages: stream.messages,
                    blackboard,
                });
                subscriber.complete();
            });

            return () => {
                stream.abort();
            };
        });
    }, concurrency);
}

function get(key, _default, ...rest) {
    return rest.find((obj) => obj?.[key])?.[key] || _default;
}

export const schema = base
    .extend({
        config: z.object({
            OPENAI_API_KEY: z
                .string()
                .optional()
                .describe(
                    `The OpenAI API key. can be ommited if the OPENAI_API_KEY environment variable is set.`
                ),
            model: z
                .string()
                .optional()
                .describe('The model to use. Defaults to "gpt-3.5-turbo"'),
            temperature: z
                .number()
                .optional()
                .describe("The temperature to use. Defaults to 0.3"),
            max_tokens: z
                .number()
                .optional()
                .describe(
                    "The maximum number of tokens to generate. Defaults to 4000"
                ),
            response_format: z
                .object({
                    type: z.literal("json_object"),
                })
                .or(z.undefined())
                .optional()
                .describe("The response format to use. Defaults to undefined"),
            onContent: z
                .any()
                .optional()
                .describe(
                    "The onContent function, called when a chunk of content is received: ({ chunk, snapshot }) => {}"
                ),
        }),
        input: z.object({}).optional(),
        output: z.object({}).optional(),
    })
    .describe(`GPT: issue a request to an OpenAI chat completion model.`);

export default wrap({ operator: gpt, schema });
