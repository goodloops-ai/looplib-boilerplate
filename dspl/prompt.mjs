import { catchError, throwError, of, mergeMap, pipe, filter } from "rxjs";
import gpt from "./gpt.mjs"; // Assuming gpt is an operator
import checkInvariant from "./invariant.mjs";
import message, { messageSchema } from "./message.mjs";
import { wrap, schema as base } from "./operator.mjs";
import { z } from "zod";
import _ from "lodash";
import { tap } from "https://esm.sh/rxjs@7.8.1";

export function prompt({
    content,
    role = "user",
    config = {},
    invariants = [],
}) {
    const processInvariants = (context, retryMap = new Map(), index = 0) => {
        if (index >= invariants.length) {
            return of(context);
        }

        const invariant = invariants[index];

        console.log(
            "Processing invariant",
            invariants,
            invariant.filter,
            context.messages
        );

        const makeOutputSkeleton = (output) => {
            const keys = output.split(".");
            return keys.reduceRight((acc, key) => {
                return { [key]: acc };
            }, "value");
        };

        return of(context).pipe(
            checkInvariant(invariant, {
                input: {
                    value: `{{${invariant.input}}}`,
                },
                output: makeOutputSkeleton(invariant.output),
            }),
            tap((result) => {
                console.log("checkInvariant result", result);
            }),
            mergeMap((updatedContext) =>
                processInvariants(
                    _.merge({}, context, updatedContext),
                    retryMap,
                    index + 1
                )
            ),

            catchError((error) => {
                if (retryMap.has(invariant)) {
                    const count = retryMap.get(invariant);
                    if (count >= invariant.maxRetries) {
                        return throwError(
                            () =>
                                new Error(
                                    `Exceeded max retries for invariant: ${invariant.filter}`
                                )
                        );
                    }
                    retryMap.set(invariant, count + 1);
                } else {
                    retryMap.set(invariant, 1);
                }

                if (invariant.recovery === "regenerate") {
                    // Rerun the original gpt() call
                    return of(context).pipe(
                        gpt(config),
                        mergeMap((newContext) => {
                            return processInvariants(newContext, retryMap);
                        })
                    );
                } else if (invariant.recovery === "append") {
                    // Append the error message and rerun
                    return of(context).pipe(
                        message({ role, content: `Error: ${error.message}` }),
                        gpt({ role, content: appendedMessage }, config),
                        mergeMap((newContext) => {
                            return processInvariants(newContext, retryMap);
                        })
                    );
                } else {
                    return throwError(
                        () =>
                            new Error(
                                `Unknown recovery strategy: ${invariant.recovery}`
                            )
                    );
                }
            })
        );
    };
    // Start the process with an initial gpt call
    return pipe(
        message({ role, content }),
        gpt(config),
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
            config: gpt.schema.shape.config
                .default({})
                .describe("The configuration object for the GPT call."),
            invariants: z
                .array(
                    z.object({
                        filter: z
                            .union([z.instanceof(RegExp)])
                            .describe(
                                "The pattern to identify the relevant part of the message."
                            ),
                        output: z
                            .string()
                            .describe(
                                "The key under which to store the first matching group content."
                            ),
                        maxRetries: z
                            .number()
                            .int()
                            .nonnegative()
                            .describe("The maximum number of retries allowed."),
                        recovery: z
                            .enum(["regenerate", "append"])
                            .describe(
                                "The strategy to use if the invariant check fails. regenerate will re-issue the same request. append will append the original response and error message to the content and re-issue the request."
                            ),
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
