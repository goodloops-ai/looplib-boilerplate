import message from "./message.mjs";
import prompt from "./prompt.mjs";
import { pipe } from "rxjs";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";
import { schema as gptSchema } from "./gpt.mjs";

export const flowgen = ({ description, gptOptions }) =>
    pipe(
        message({
            role: "system",
            content: `You are an expert rxjs developer working with a strict rxjs based DSL.
The user will provide you with a pseudocode implementation of a flow they wish you to generate. You will be responsible for converting the pseudocode into a working rxjs flow. You will always return a working flow when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt. You never return partial code, never give up, and never refuse to return code.

Notes about the DSL:
- The DSL is based on rxjs and uses a custom operator library.
- The DSL is strict and will only accept valid rxjs code.

Notes about DSL operators:
- each operator is a factory function that returns an rxjs operator.
- the factory function takes two arguments: the config and the IO map.
- the config is an object that contains the configuration for the operator.
- the IO map is an object that contains mappings for the input and output of the to and from a shared blackboard.
    - example:
        - operator({ key: "value" }, {input: { operatorInputValue: "path.to.blackboard.value" }, output: { operatorOutput: "path.to.operator.output.value" } })
        - this will construct the operator with the config.
        - when the operator executes, it's input will be { operatorInputValue: blackboard.path.to.blackboard.value }
        - when the operator completes, it will set blackboard.operatorOutput to the value of output.path.to.output.value.
- In addition to blackboard IO, each operator recieves and can manipulate an array of message objects, known as the message stream.

Operators available:
- message: add a message to the message stream.
- import message from "./message.mjs";
\`\`\`schema
${JSON.stringify(message.properties, null, 4)}
\`\`\`
- prompt: add a message to the message stream and use the message stream to prompt an AI for a response.
- import prompt from "./prompt.mjs";
\`\`\`schema
${JSON.stringify(prompt.properties, null, 4)}
\`\`\`

When building the flow, it should be in the form of a new rxjs operator:
- the operator should take a single config object as an argument (don't include the IO map, it is handled by the DSL).
- the operator should expect as input a single object with the following properties:
    - input: an object containing input variables matching the operators provided input schema
    - messages: an array of message objects.
    - env: an object containing environment variables.
- the operator should return a single object with the following properties:
    - output: an object containing output variables matching the operators provided output schema
    - messages: an array of message objects.

- the operator must be a standalone ECMAScript module with the following exports:
    - schema: a zod schema that describes the configuration, input, and output for the operator.
    - operator: the factory function that returns the rxjs operator.
    - default: the wrap of the operator and schema for use in the DSL.

here is an example of a simple operator:
\`\`\`javascript
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
    .describe(\`Message: add a message to the message stream.\`);

export default wrap({ operator: message, schema });
\`\`\`

Here is an example of a simple flow that provides a name for the AI and then asks the AI for its name and sets it to the blackboard:
\`\`\`javascript
import { map } from "rxjs";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";

export const operator = ({name}) => {
    pipe(
        message({ role: "system", content: \\\`your name is \${name}!\\\` }),
        prompt({ 
            content: "what is your name? give me the answer in a markdown code block",
            invariants: [
                {
                    filter: /\`\`\`(?:markdown|js)?\n([\s\S]*?)\n\`\`\`/,
                    output: "name",
                    maxRetries: 6,
                    recovery: "regenerate",
                },
            ]
        })
    )

export const schema = base.extend({
    config: z.object({
        name: z.string().describe("The name for the AI"),
    }),
});
`,
        }),
        message(description),
        prompt({
            content: `We will now generate a flow or operator based on the provided pseudocode.
if the provided description is an operator, you should generate the operator.
if the provided description is a flow, you should generate the flow.
First, create your imports. If you need to import any operators, you should do so here. 
You should start my defining the schema for how the flow or operator will be configured, and then implement the operator that will generate the flow.
You may respond with partial code blocks while you work on those steps, but they must NOT have labels. The final code block must be the complete ECMAScript module with the schema, operator, and default exports.
Ensure that all operators you use in the flow are given all required configuration
Ensure that the user is able to override the model string and temperature in the configuration if any prompts are made, but you must provide sensible defaults for each prompt call.
If the psuedocode makes reference to an operator that does not exist, you should act as if the operator exists and use it as you would any other operator, providing it with the configuration and IO map as you would any other operator.
Ensure that your provided schema is complete and accurate.`,
            gptOptions,
            invariants: [
                {
                    type: "parse",
                    parse: /```(?:javascript|js)?\n([\s\S]*?)\n```/,
                    output: `flow`,
                    maxRetries: 6,
                },
            ],
        }),
        prompt({
            content: `now provide an example of how the flow will be used.
            {{flowFile}}
            here is an example of how the another flow is used:
            \`\`\`javascript
            ${Deno.readTextFileSync("./dspl/flowgenscript.mjs")}
            \`\`\`

            make sure you provide an env object to the flow that includes OPENAI_API_KEY sourced by dotenv and the Deno.env object.
            `,
            gptOptions,
            invariants: [
                {
                    filter: /```(?:javascript|js)?\n([\s\S]*?)\n```/,
                    output: `example`,
                    maxRetries: 6,
                    recovery: "regenerate",
                },
            ],
        })
    );

export const schema = base.extend({
    config: z.object({
        gptOptions: gptSchema.shape.config.default({}),
        flowFile: z
            .string()
            .default(
                "The user did not specify an output file path, just make one up"
            )
            .describe("The file path to the flow file."),
        description: z
            .string()
            .describe("The description of the flow to generate."),
    }),
});

export default wrap({ operator: flowgen, schema });
