import { map } from "rxjs";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";

function messageFromObject({ role = "user", content }) {
    return map(({ blackboard, messages, env }) => ({
        blackboard,
        messages: [
            ...messages,
            {
                role,
                content,
            },
        ],
        env,
    }));
}

export function message(strOrObj) {
    if (typeof strOrObj === "string") {
        return messageFromObject({ role: "user", content: strOrObj });
    }
    return messageFromObject(strOrObj);
}

export const messageSchema = z.object({
    role: z
        .string()
        .default("user")
        .optional()
        .describe('The role of the message sender. Defaults to "user"'),
    content: z.string().describe("The content of the message."),
});

export const schema = base
    .extend({
        config: messageSchema.or(
            z
                .string()
                .describe(
                    "The content of the message. role will default to 'user'."
                )
        ),
        input: z.object({}).optional(),
        output: z.object({}).optional(),
    })
    .describe(`Message: add a message to the message stream.`);

export default wrap({ operator: message, schema });
