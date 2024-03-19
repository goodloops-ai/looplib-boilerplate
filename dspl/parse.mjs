import { mergeMap } from "rxjs";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";
import { messageSchema } from "./message.mjs";

export function parse({ filter }) {
    if (filter instanceof RegExp) {
        const regex = filter;
        filter = ({ messages }) => {
            const match = regex.exec(messages.slice(-1)[0].content);
            if (match && match[1]) {
                return match[1];
            } else {
                console.log("no match", messages.slice(-1)[0].content, regex);
                throw new Error(`Message does not match filter ${regex}`);
            }
        };
    } else if (typeof filter === "string") {
        const regex = new RegExp(filter);
        filter = ({ messages }) => {
            const match = regex.exec(messages.slice(-1)[0].content);
            if (match && match[1]) {
                return match[1];
            } else {
                console.log("no match", messages.slice(-1)[0].content, regex);
                throw new Error(`Message does not match filter ${regex}`);
            }
        };
    } else {
        const computation = filter;
        filter = ({ messages, input }) => {
            return computation({ messages, input });
        };
    }

    return mergeMap(async ({ messages, env, input }) => {
        const value = await filter({ messages, input, env });
        return { messages, output: { value } };
    });
}

function get(obj, path) {
    return path.reduce((acc, key) => acc[key], obj);
}

export const schema = base.extend({
    config: z.object({
        parse: z
            .union([
                z.string(),
                z.instanceof(RegExp),
                z.function().args(z.string()).returns(z.any()),
            ])
            .transform((parse) =>
                typeof parse === "string" ? new RegExp(parse) : parse
            ),
        filter: z
            .union([
                z.string(),
                z.instanceof(RegExp),
                z.function().args(z.any()).returns(z.any()),
            ])
            .transform((filter) =>
                typeof filter === "string" ? new RegExp(filter) : filter
            ),
        computation: z
            .function()
            .args(z.any())
            .returns(z.any())
            .optional()
            .describe("The computation to run"),
    }),
    input: z.object({
        value: z.string().describe("The value to check the invariant against."),
    }),
    output: z
        .object({
            value: z.any().describe("The value extracted from the message."),
        })
        .optional(),
});

export default wrap({ operator: checkInvariant, schema });
