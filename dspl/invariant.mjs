import { mergeMap } from "rxjs";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";
import { messageSchema } from "./message.mjs";

export function checkInvariant({ parse, type, compute, filter }) {
    // if (type === "parse") {
    //     return parse({ filter });
    if (parse instanceof RegExp) {
        const regex = parse;
        parse = ({ messages }) => {
            const match = regex.exec(messages.slice(-1)[0].content);
            if (match && match[1]) {
                return match[1];
            } else {
                console.log("no match", messages.slice(-1)[0].content, regex);
                throw new Error(`Message does not match filter ${regex}`);
            }
        };
    }

    return mergeMap(async ({ messages, env, input }) => {
        if (type === "parse") {
            const value = await parse({ messages });
            return { messages, output: { value } };
        } else if (type === "compute") {
            console.log("compute", input, compute);
            const value = await compute(input.value);
            return { messages, output: { value } };
        } else if (type === "filter") {
            const value = await filter(input.value);
            return { messages, output: { value } };
        }
    });
}

function get(obj, path) {
    return path.reduce((acc, key) => acc[key], obj);
}

export const schema = base.extend({
    config: z.object({
        type: z.enum(["parse", "compute", "filter"]),
        parse: z
            .union([
                z.string(),
                z.instanceof(RegExp),
                z.function().args(z.string()).returns(z.any()),
            ])
            .optional()
            .transform((parse) =>
                typeof parse === "string" ? new RegExp(parse) : parse
            ),
        filter: z
            .union([
                z.string(),
                z.instanceof(RegExp),
                z.function().args(z.any()).returns(z.any()),
            ])
            .default(() => () => true)
            .transform((filter) =>
                typeof filter === "string" ? new RegExp(filter) : filter
            ),
        compute: z
            .function()
            .args(z.any())
            .returns(z.any())
            .optional()
            .describe("The computation to run"),
    }),
    input: z.object({
        value: z
            .array(z.any())
            .optional()
            .describe("The value to check the invariant against."),
    }),
    output: z
        .object({
            value: z
                .any()
                .optional()
                .describe("The value extracted from the message."),
        })
        .optional(),
});

export default wrap({ operator: checkInvariant, schema });
