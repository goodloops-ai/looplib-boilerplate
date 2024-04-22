import { z } from "zod";

const BaseStep = z.object({
    parse: z
        .record(z.string(), z.string().or(z.function()))
        .optional()
        .describe(
            "An object specifying how to parse the response from the step. The keys represent the variable names to be parsed, and the values are either dot-notated paths to the response data or functions that return the parsed value."
        ),
    set: z
        .string()
        .optional()
        .describe(
            "The name of the variable to set the response of the step to on the blackboard."
        ),
    retries: z
        .number()
        .optional()
        .describe("The number of times to retry the step if it fails."),
    guards: z
        .array(
            z.object({
                type: z
                    .enum(["filter", "llm"])
                    .describe(
                        'The type of the guard. It can be "filter" for evaluating a condition or "llm" for using an LLM to answer a yes/no question.'
                    ),
                filter: z
                    .string()
                    .describe(
                        'The condition to evaluate for the guard. For "filter" type, it is a dot-notated path to a boolean value on the blackboard. For "llm" type, it is a yes/no question to ask the LLM.'
                    ),
                policy: z
                    .enum(["retry", "append"])
                    .describe(
                        'The policy to follow if the guard fails. "retry" will retry the step, while "append" will append the failure to the history and continue.'
                    ),
                overrides: z
                    .record(z.string(), z.any())
                    .optional()
                    .describe(
                        'An object specifying the properties to override in the step if the "append" policy is used and the guard fails.'
                    ),
            })
        )
        .optional()
        .describe(
            "An array of guards to apply to the step. Guards are used to conditionally execute or retry the step based on certain conditions."
        ),
    onFail: z
        .array(z.lazy(() => Step))
        .optional()
        .describe("An array of steps to execute if the step fails."),
    onSuccess: z
        .array(z.lazy(() => Step))
        .optional()
        .describe("An array of steps to execute if the step succeeds."),
    finally: z
        .array(z.lazy(() => Step))
        .optional()
        .describe(
            "An array of steps to execute regardless of whether the step succeeds or fails."
        ),
});

const InitStep = BaseStep.extend({
    type: z
        .literal("init")
        .describe('The type of the step, which is "init" for initialization.'),
    init: z
        .record(z.string(), z.any())
        .describe(
            'An object containing initialization values for the blackboard. The keys represent the blackboard paths, and the values can be of any type. It can also include default values for other steps under the "$" key. For example, { "$": { "prompt": { "model": "gpt-4", "temperature": 0.7 } } } sets default values for the "prompt" step.'
        ),
});

const PromptStep = BaseStep.extend({
    type: z
        .literal("prompt")
        .describe(
            'The type of the step, which is "prompt" for generating a prompt and calling an LLM (Language Model).'
        ),
    content: z
        .string()
        .or(z.function())
        .describe(
            "The content of the prompt to be sent to the LLM. It can be a string or a function that returns a string."
        ),
    mode: z
        .enum(["json"])
        .optional()
        .describe(
            'The mode of the prompt. If set to "json", the response from the LLM will be parsed as JSON.'
        ),
    role: z
        .enum(["user", "assistant", "system"])
        .default("user")
        .describe(
            'The role associated with the prompt. It can be "user", "assistant", or "system". Defaults to "user".'
        ),
    n: z
        .number()
        .optional()
        .describe(
            "The number of responses to generate from the LLM for the prompt."
        ),
});

const DoStep = BaseStep.extend({
    type: z
        .literal("do")
        .describe(
            'The type of the step, which is "do" for invoking a nested DSPL either once or in a loop.'
        ),
    for: z
        .object({
            each: z
                .string()
                .describe("The name of the variable to iterate over."),
            in: z.string().describe("The name of the array to iterate over."),
            concurrency: z
                .number()
                .optional()
                .describe("The number of concurrent iterations to perform."),
        })
        .optional()
        .describe(
            'The "for" configuration for iteration. It allows iterating over an array and executing the nested DSPL for each element.'
        ),
    while: z
        .object({
            type: z.string().describe("The type of the while condition."),
            filter: z
                .string()
                .describe("The filter to evaluate for the while condition."),
            max: z
                .number()
                .optional()
                .describe("The maximum number of iterations to perform."),
        })
        .optional()
        .describe(
            'The "while" configuration for conditional iteration. It allows repeating the execution of the nested DSPL until a specified condition is met.'
        ),
    history: z
        .enum(["append"])
        .optional()
        .describe(
            'The history behavior for the step. If set to "append", the step will append its results to the existing history.'
        ),
    dspl: z
        .lazy(() => DSPL)
        .describe(
            'The nested DSPL object to execute within the "do" step. It can be executed once or multiple times based on the iteration configuration.'
        ),
});

const ImageStep = BaseStep.extend({
    type: z
        .literal("image")
        .describe(
            'The type of the step, which is "image" for generating an image.'
        ),
    prompt: z
        .string()
        .or(z.function())
        .describe(
            "The prompt to use for generating the image. It can be a string or a function that returns a string."
        ),
    outputFormat: z
        .string()
        .default("webp")
        .describe(
            'The output format of the generated image. Defaults to "webp".'
        ),
    imagePath: z
        .string()
        .default("./generated_image.png")
        .describe(
            'The path where the generated image will be saved. Defaults to "./generated_image.png".'
        ),
    width: z
        .number()
        .optional()
        .describe("The width of the generated image in pixels."),
    height: z
        .number()
        .optional()
        .describe("The height of the generated image in pixels."),
    samples: z
        .number()
        .optional()
        .describe("The number of image samples to generate."),
    steps: z
        .number()
        .optional()
        .describe(
            "The number of steps to use in the image generation process."
        ),
});

const EpubStep = BaseStep.extend({
    type: z
        .literal("epub")
        .describe(
            'The type of the step, which is "epub" for generating an EPUB file.'
        ),
    title: z
        .string()
        .or(z.function())
        .describe(
            "The title of the EPUB. It can be a string or a function that returns a string."
        ),
    author: z
        .string()
        .or(z.function())
        .describe(
            "The author of the EPUB. It can be a string or a function that returns a string."
        ),
    language: z
        .string()
        .or(z.function())
        .describe(
            "The language of the EPUB. It can be a string or a function that returns a string."
        ),
    identifier: z
        .string()
        .or(z.function())
        .describe(
            "The unique identifier of the EPUB. It can be a string or a function that returns a string."
        ),
    cover: z
        .string()
        .or(z.function())
        .describe(
            "The path to the cover image of the EPUB. It can be a string or a function that returns a string."
        ),
    chapters: z
        .array(
            z.object({
                title: z
                    .string()
                    .or(z.function())
                    .describe(
                        "The title of the chapter. It can be a string or a function that returns a string."
                    ),
                content: z
                    .string()
                    .or(z.function())
                    .describe(
                        "The content of the chapter. It can be a string or a function that returns a string."
                    ),
            })
        )
        .or(z.function())
        .describe(
            "An array of chapter objects, each containing a title and content. It can also be a function that returns an array of chapter objects."
        ),
    epubPath: z
        .string()
        .or(z.function())
        .describe(
            "The path where the generated EPUB file will be saved. It can be a string or a function that returns a string."
        ),
});

const MessageStep = BaseStep.extend({
    type: z
        .literal("message")
        .describe(
            'The type of the step, which is "message" for adding a message to the history.'
        ),
    role: z
        .enum(["user", "assistant", "system"])
        .default("user")
        .describe(
            'The role associated with the message. It can be "user", "assistant", or "system". Defaults to "user".'
        ),
    content: z
        .string()
        .or(z.function())
        .describe(
            "The content of the message. It can be a string or a function that returns a string."
        ),
});

const ImportStep = BaseStep.extend({
    type: z
        .literal("import")
        .describe(
            'The type of the step, which is "import" for importing modules.'
        ),
    import: z
        .record(z.string(), z.string())
        .describe(
            "An object specifying the modules to import. The keys represent the names to be used for the imported modules, and the values are the paths or URLs of the modules."
        ),
});

const ReadabilityStep = BaseStep.extend({
    type: z
        .literal("readability")
        .describe(
            'The type of the step, which is "readability" for fetching and parsing web content.'
        ),
    url: z.string().describe("The URL of the web page to fetch and parse."),
    hide: z
        .boolean()
        .optional()
        .default(false)
        .describe(
            "Whether to hide the parsed content in the system's response."
        ),
});

const Step = z.discriminatedUnion("type", [
    InitStep,
    PromptStep,
    DoStep,
    ImageStep,
    EpubStep,
    MessageStep,
    ImportStep,
    ReadabilityStep, // Include the new ReadabilityStep in the union of possible steps
]);

const DSPL = z.object({
    elements: z
        .array(Step)
        .describe(
            "An array of steps that make up the DSPL. The steps will be executed sequentially in the order they are defined."
        ),
});

export default DSPL;
