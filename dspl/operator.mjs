import { mergeMap, map, pipe, of } from "https://esm.sh/rxjs@7.8.1";
import { z } from "zod";
import Mustache from "mustache";
import { zodToJsonSchema } from "https://esm.sh/zod-to-json-schema@3.22.3";
import { fromZodError } from "zod-validation-error";

export function wrap({ operator, schema }) {
    console.log("wrap", schema);
    const factory = function (config, { input = {}, output = {} } = {}) {
        const op = pipe(
            mergeMap(({ blackboard = {}, messages, env }) => {
                messages = messages || [];

                const wrapValueWithTemplate = (key, value) => {
                    if (typeof value === "object" && value !== null) {
                        return Object.entries(value).reduce(
                            (acc, [nestedKey, nestedValue]) => {
                                acc[nestedKey] = wrapValueWithTemplate(
                                    `${key}.${nestedKey}`,
                                    nestedValue
                                );
                                return acc;
                            },
                            {}
                        );
                    } else {
                        return `
\`\`\`{{${key}}} - you may use this mustache template in your configs or inputs to reference this value.
${typeof value === "string" ? value : JSON.stringify(value, null, 2)}
\`\`\`
`;
                    }
                };

                console.log("wrap", blackboard, schema.shape.config);
                const wrappedBlackboard = Object.entries(blackboard).reduce(
                    (acc, [key, value]) => {
                        acc[key] = wrapValueWithTemplate(key, value);
                        return acc;
                    },
                    {}
                );

                messages = messages.map((message) => {
                    message.content = Mustache.render(
                        message.content,
                        wrappedBlackboard
                    );
                    return message;
                });

                // console.log(
                //     "wrap",
                //     zodToJsonSchema(schema),
                //     config,
                //     input,
                //     output,
                //     blackboard
                // );
                const recursiveRender = (obj) => {
                    if (typeof obj === "function" || obj instanceof RegExp) {
                        return obj;
                    } else if (Array.isArray(obj)) {
                        return obj.map(recursiveRender);
                    } else if (typeof obj === "object" && obj !== null) {
                        const renderedObj = {};
                        for (const [key, value] of Object.entries(obj)) {
                            renderedObj[key] = recursiveRender(value);
                        }
                        return renderedObj;
                    } else if (typeof obj === "string") {
                        return Mustache.render(obj, { blackboard, env });
                    }
                    return obj;
                };

                try {
                    config = schema.shape.config
                        .transform((config) => recursiveRender(config))
                        .parse(config);
                } catch (e) {
                    const err = fromZodError(e);
                    err.message += schema.shape.config.description;
                    console.error(err);
                    throw err;
                }

                try {
                    input = schema.shape.input
                        .transform((input) => recursiveRender(input))
                        .parse(input);
                } catch (e) {
                    const err = fromZodError(e);
                    err.message += schema.shape.input.description;
                    console.error(err);
                    throw err;
                }

                // HERE IS WHERE YOU CAN DO BLACKBOARD SCOPING
                return of({ blackboard, messages, input, env }).pipe(
                    operator(config, env),
                    map(
                        ({
                            messages: _messages,
                            output: _output,
                            env: _env,
                        }) => {
                            env = {
                                ...env,
                                ..._env,
                            };

                            _output = schema.shape.output.parse(_output);

                            messages = _messages || messages;

                            console.log(
                                "add output to blackboard",
                                output,
                                _output
                            );
                            const recursiveAssignOutput = (
                                outputMap,
                                outputValues
                            ) => {
                                Object.entries(outputMap).forEach(
                                    ([key, valuePath]) => {
                                        if (
                                            typeof valuePath === "object" &&
                                            valuePath !== null
                                        ) {
                                            return recursiveAssignOutput(
                                                valuePath,
                                                outputValues
                                            );
                                        }

                                        const value = valuePath
                                            .split(".")
                                            .reduce(
                                                (acc, key) => acc[key],
                                                outputValues
                                            );
                                        const pathParts = key.split(".");
                                        const lastKey = pathParts.pop();
                                        const targetObject = pathParts.reduce(
                                            (acc, key) => {
                                                if (!(key in acc))
                                                    acc[key] = {};
                                                return acc[key];
                                            },
                                            blackboard
                                        );
                                        targetObject[lastKey] = value;
                                    }
                                );
                            };
                            recursiveAssignOutput(output, _output);
                            console.log("output", output, _output, blackboard);

                            return { blackboard, messages, env };
                        }
                    )
                );
            })
        );

        // console.log("wrapped", schema);
        return addExtras(op, schema, "operator");
    };

    return addExtras(factory, schema, "factory");
}

function addExtras(opOrFactory, schema, type) {
    opOrFactory.schema =
        type === "operator"
            ? schema.input || z.undefined().describe(": No input schema")
            : schema;
    // console.log("addExtras", schema, opOrFactory.schema);
    opOrFactory.start = (
        inputOrConfigAndIO = {},
        { blackboard = {}, messages = [], env = {} } = {}
    ) => {
        const input =
            type === "operator" ? inputOrConfigAndIO : inputOrConfigAndIO.input;

        return of({ input, messages, blackboard, env }).pipe(
            type === "operator"
                ? opOrFactory
                : opOrFactory(inputOrConfigAndIO.config, {
                      input: inputOrConfigAndIO.input,
                      output: inputOrConfigAndIO.output,
                  })
        );
    };

    opOrFactory._name = opOrFactory.schema.description.split(":")[0].trim();
    opOrFactory.description = opOrFactory.schema.description
        .split(":")[1]
        .trim();
    // console.log("make jsonSchema", opOrFactory.schema, new Error().stack);
    opOrFactory.properties = zodToJsonSchema(opOrFactory.schema);

    return opOrFactory;
}

export const schema = z
    .object({
        input: z.object({}).default({}).describe("Extend with input schema"),
        output: z.object({}).default({}).describe("Extend with output schema"),
        config: z.object({}).default({}).describe("Extend with config schema"),
    })
    .describe("Override this description with [name]: description");
