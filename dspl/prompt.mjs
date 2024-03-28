import {
    catchError,
    throwError,
    of,
    mergeMap,
    pipe,
    filter,
    firstValueFrom,
    tap,
} from "rxjs";
import Handlebars from "handlebars";
import gpt from "./gpt.mjs"; // Assuming gpt is an operator
import message, { messageSchema } from "./message.mjs";
import { wrap, schema as base } from "./operator.mjs";
import { z } from "zod";
import _ from "lodash";
Handlebars.registerHelper("eq", function (arg1, arg2, options) {
    return arg1 === arg2;
});

function transformPathForLodashGet(path) {
    // Remove the initial $ if present
    let transformedPath = path.startsWith("$") ? path.slice(1) : path;
    // Replace [" with '. and "] with ' to fit lodash _.get format
    transformedPath = transformedPath
        .replace(/\["/g, "['")
        .replace(/"]/g, "']");
    return transformedPath;
}

// Example usage
function proxyToPojo(proxy) {
    const obj = {};
    for (const key of Object.keys(proxy)) {
        if (
            [Symbol.toStringTag, "constructor", "length", "then"].includes(key)
        ) {
            continue; // Skip internal properties
        }
        const value = proxy[key];
        if (value && typeof value === "object") {
            obj[key] = proxyToPojo(value); // Recursively convert nested objects/proxies
        } else {
            obj[key] = value;
        }
    }
    return obj;
}

async function checkInvariant(invariant, context) {
    function createDeepProxy(obj) {
        return new Proxy(obj, {
            get(target, property, receiver) {
                if (
                    [
                        Symbol.toStringTag,
                        "constructor",
                        "length",
                        "then",
                    ].includes(property)
                ) {
                    return target[property]; // Skip internal properties
                }
                console.log("get", property);
                if (!(property in target)) {
                    target[property] = createDeepProxy({}); // Create a new proxy if the property doesn't exist
                }
                return Reflect.get(target, property, receiver);
            },
        });
    }

    // Wrap the blackboard in a deep proxy
    const proxyBlackboard = createDeepProxy(context.blackboard);

    switch (invariant.type) {
        case "parse": {
            const expression = invariant.parse;
            console.log("parse", expression);
            const fn = new Function(
                "$",
                "response",
                "_",
                `${expression};\nreturn $`
            );

            console.log("proxyToPojo");
            const $ = proxyToPojo(
                await fn(
                    proxyBlackboard,
                    context.messages.slice(-1)[0].content,
                    _
                )
            );
            console.log("proxyToPojo done");

            const set = transformPathForLodashGet(
                expression.split("=")[0].trim()
            );
            console.log("set", set, $);

            // check to see if the path of set has a value
            if (_.get($, set) === undefined) {
                console.log("Invariant parse failed:", expression, set, $);
                throw new Error(`Invariant parse failed: ${expression}`);
            }

            console.log("Invariant parse success:", expression, set, $);

            return {
                blackboard: _.merge({}, context.blackboard, $),
                messages: context.messages,
            };
        }
        case "compute": {
            const expression = invariant.compute;
            const fn = new Function(
                "$",
                "_",
                `return (async () => { ${expression}; return $; })()`
            );
            const $ = await fn(proxyBlackboard, _);
            return {
                blackboard: _.merge({}, context.blackboard, $),
                messages: context.messages,
            };
        }
        case "filter": {
            const expression = invariant.filter;
            const fn = new Function(
                "$",
                "_",
                `return (async () => { return ${expression}; })()`
            );
            const val = await fn(proxyBlackboard, _);
            if (!val) {
                throw new Error(`Invariant filter failed: ${expression}`);
            }
            return {
                blackboard: context.blackboard,
                messages: context.messages,
            };
        }
    }
}

async function prompt({ content, context, role = "user", invariants = [] }) {
    console.log("Initial context:", context, content, role, invariants);

    // Initial message and GPT call
    context = await firstValueFrom(
        of(context).pipe(
            gpt({
                model: context.blackboard.prompt?.model,
                temperature: context.blackboard.prompt?.temperature,
            })
        )
    );

    // Map to keep track of retries for each invariant
    const retryCounts = new Map();

    let i = 0;
    while (i < invariants.length) {
        const invariant = invariants[i];
        // Initialize retry count for the current invariant if not already done
        if (!retryCounts.has(invariant)) {
            retryCounts.set(invariant, 0);
        }

        try {
            const result = await checkInvariant(invariant, context);
            context = _.merge({}, context, result);
            console.log("Invariant check success:", invariant, context);
            i++; // Move to the next invariant only on success
        } catch (error) {
            console.error("Invariant check error:", error, invariant);

            const currentRetryCount = retryCounts.get(invariant);
            retryCounts.set(invariant, currentRetryCount + 1);

            if (currentRetryCount + 1 > invariant.maxRetries) {
                console.error(
                    `Max retries exceeded for invariant: ${invariant}`
                );
                break; // Exit the loop if an invariant fails after max retries
            }

            if (invariant.recovery_prompt) {
                const recoveryContent = Handlebars.compile(
                    invariant.recovery_prompt
                )(context.blackboard);
                console.log(
                    "Recovery prompt:",
                    recoveryContent,
                    JSON.stringify(context, null, 2)
                );
                context = await firstValueFrom(
                    of(context).pipe(
                        message({
                            role,
                            content: recoveryContent,
                        }),
                        gpt({
                            model: context.blackboard.prompt?.model,
                            temperature: context.blackboard.prompt?.temperature,
                        })
                    )
                );
            } else {
                // Remove the last AI response and retry
                context.messages.pop();
                console.log("Retrying with the previous context:", context);
                context = await firstValueFrom(
                    of(context).pipe(
                        gpt({
                            model: context.blackboard.prompt?.model,
                            temperature: context.blackboard.prompt?.temperature,
                        })
                    )
                );
            }

            // Reset to start from the first invariant again after a retry
            i = 0;
        }
    }

    console.log("Final context:", context);
    return context;
}

function promptOperator({ content, role = "user", invariants = [] }) {
    return pipe(
        message({ role, content }),
        mergeMap((context) =>
            prompt({ invariants, content, context, role, context })
        )
    );
}

export const schema = base
    .extend({
        config: z.object({
            content: z
                .string()
                .describe("The message content to send to the GPT model."),
            role: z
                .enum(["user", "system"])
                .default("user")
                .describe("The role of the message sender."),
            invariants: z
                .array(
                    z.object({
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
                        type: z.enum(["parse", "compute", "filter"]),
                        parse: z
                            .string()
                            .optional()
                            .describe("The parse expression."),
                        compute: z
                            .string()
                            .optional()
                            .describe("The compute invariant."),
                        filter: z
                            .string()
                            .optional()
                            .describe("The filter invariant."),
                    })
                )
                .default([])
                .describe("A list of invariants to check against the context."),
        }),
    })
    .describe(
        "Prompt: process a message with invariants and send it to the GPT model."
    );

export default promptOperator;
