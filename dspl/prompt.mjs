import { catchError, throwError, of, mergeMap, pipe, filter } from "rxjs";
import Handlebars from "handlebars";
import gpt from "./gpt.mjs"; // Assuming gpt is an operator
import checkInvariant, { schema as invariantSchema } from "./invariant.mjs";
import message, { messageSchema } from "./message.mjs";
import { wrap, schema as base } from "./operator.mjs";
import { z } from "zod";
import _ from "lodash";
import { tap } from "https://esm.sh/rxjs@7.8.1";
Handlebars.registerHelper("eq", function (arg1, arg2, options) {
    return arg1 === arg2;
});
export function prompt({
    content,
    role = "user",
    gptOptions = {},
    invariants = [],
}) {
    const processInvariants = (context, retryMap = new Map(), index = 0) => {
        if (index >= invariants.length) {
            return of(context);
        }

        const invariant = invariants[index];

        console.log("Processing invariant", invariant, context.messages);

        const makeOutputSkeleton = (output) => {
            const keys = output.split(".");
            return keys.reduceRight((acc, key) => {
                return { [key]: acc };
            }, "value");
        };

        const getFromBlackboard = (key) => {
            console.log("getFromBlackboard", key, context.blackboard);
            return _.get(context.blackboard, key);
        };

        return of(context).pipe(
            checkInvariant(invariant, {
                input: {
                    value: invariant.inputs?.map(getFromBlackboard),
                },
                output: makeOutputSkeleton(invariant.output),
            }),
            mergeMap((updatedContext) =>
                processInvariants(
                    _.merge({}, context, updatedContext),
                    retryMap,
                    index + 1
                )
            ),
            catchError((error) => {
                console.log(
                    "checkInvariant error",
                    error,
                    invariant,
                    JSON.stringify(context, null, 2)
                );
                if (retryMap.has(invariant)) {
                    const count = retryMap.get(invariant);
                    if (count >= invariant.maxRetries) {
                        console.error(invariant);
                        return of(context);
                    }
                    retryMap.set(invariant, count + 1);
                } else {
                    retryMap.set(invariant, 1);
                }

                if (invariant.recovery_prompt) {
                    // Append the error message and rerun
                    let content;
                    try {
                        content = Handlebars.compile(invariant.recovery_prompt)(
                            context.blackboard
                        );
                    } catch (e) {
                        console.error(e);
                        Deno.exit(1);
                    }
                    console.log(
                        "recovery_prompt",
                        invariant.recovery_prompt,
                        context.messages,
                        content
                    );
                    // Deno.exit(1);
                    return of(context).pipe(
                        message({
                            role,
                            content,
                        }),
                        gpt(gptOptions),
                        mergeMap((updatedContext) => {
                            console.log(
                                "POST RECOVERY",
                                updatedContext.messages.slice(-1).content
                            );
                            // Deno.exit(1);
                            return processInvariants(
                                _.merge({}, context, updatedContext),
                                retryMap,
                                index + 1
                            );
                        })
                    );
                } else {
                    return of({
                        ...context,
                        messages: context.messages,
                    }).pipe(
                        gpt(gptOptions),
                        mergeMap((newContext) => {
                            console.log(
                                "POST RETRY",
                                newContext.messages.slice(-1)[0].content
                            );
                            return processInvariants(newContext, retryMap);
                        })
                    );
                }
            })
        );
    };
    // Start the process with an initial gpt call
    return pipe(
        message({ role, content }),
        gpt(gptOptions),
        mergeMap((context) => processInvariants(context)),
        tap((result) => {
            console.log("prompt result", result);
        })
    );
}

export const schema = base
    .extend({
        config: messageSchema.extend({
            content: z
                .string()
                .describe("The message content to send to the GPT model."),
            role: z
                .enum(["user", "system"])
                .default("user")
                .describe("The role of the message sender."),
            gptOptions: gpt.schema.shape.config.describe(
                "REQUIRED: The configuration object for the GPT call."
            ),
            invariants: z
                .array(
                    invariantSchema.shape.config.extend({
                        maxRetries: z
                            .number()
                            .int()
                            .nonnegative()
                            .default(3)
                            .describe("The maximum number of retries allowed."),
                        recovery_prompt: z
                            .string()
                            .optional()
                            .describe(
                                `The prompt to use for the recovery strategy. If not provided, the original request will be rerun. If provided, the last assistant message and the recovery prompt will be sent to the assistant.`
                            ),
                        output: z
                            .string()
                            .optional()
                            .describe("The blockboard output path."),
                        inputs: z
                            .array(z.string())
                            .optional()
                            .describe("The blockboard input paths."),
                    })
                )
                .default([])
                .describe("A list of invariants to check against the context."),
        }),
    })
    .describe(
        "Prompt: process a message with invariants and send it to the GPT model."
    );

export default wrap({ operator: prompt, schema });
