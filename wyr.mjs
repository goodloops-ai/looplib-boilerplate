import { Workflow, db } from "looplib";
import { filter } from "npm:rxjs@^7.8.1";
import { take } from "npm:rxjs@^7.8.1";

const workflow = new Workflow("program-1", {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
});

workflow
    .addNode(
        "would you rather",
        'You are going to come up with questions for the user, playing "would you rather", You will provide the user with 4 options each round: 1, the other, neither or both. Your goal is to discover enough about the user to consistently provide them with a variety of options for which they coose "both"',
        { role: "system" }
    )
    .connect("would you rather", "would you rather")
    .log()
    .output("./wyr-test");

const inquire = async ({ description, properties }) => {
    const schinquirer = await import("schinquirer");
    return await new Promise((resolve, reject) =>
        schinquirer.prompt(properties, (err, res) =>
            err ? reject(err) : resolve(res)
        )
    );
};

const tool = {
    type: "tool",
    data: {
        type: "function",
        function: {
            name: "json-schema-form",
            function: inquire.toString(),
            parse: `JSON.parse(args)`,
            description:
                "invoke this function to ask the user questions via automated json schema form. You can make use of json schema rules to provide a clean interface to ensure that the user will give you the information you need, rather than relying on freform text back and forth.",
            parameters: {
                type: "object",
                description:
                    "a valid json schema that provides questions you would like to ask the user. Must be type object at the root, and use the root description field to provide an introduction and any additional context to the user.",
                properties: {
                    type: {
                        type: "string",
                        description: "should always be 'object'",
                    },
                    description: {
                        type: "string",
                        description:
                            "an introduction to the questions you'll be asking",
                    },
                    properties: {
                        type: "object",
                    },
                },
                additionalProperties: true,
            },
        },
    },
};

db.nodes
    .findOne({ selector: { id: "would you rather" } })
    .$.pipe(filter(Boolean), take(1))
    .subscribe((doc) => {
        doc.incrementalPatch({ input: [tool] });
    });
