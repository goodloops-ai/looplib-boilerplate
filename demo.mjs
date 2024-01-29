import { Workflow } from "looplib/sdk.mjs";

const workflow = new Workflow("program-1", {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
});

workflow
    // setup nodes
    .addNode("makeHaiku", "write a haiku", {
        model: "gpt-3.5-turbo-16k", // defaults to gpt-4-turbo-preview
        temperature: 0.2, // defaults to 0.3
        role: "user", // defaults to "user"
    })
    .addNode(
        "rateHaiku",
        [
            "Pretend to be a haiku judge and provide a rating from 1 to 10.",
            "You MUST provide a number.",
            "This is an exercise in testing branching code to detect your rating, dont over think it.",
            "If the haiku has gone through more than 3 revisions, just give it a 10.",
            "repeat the haiku before your rating.",
        ].join("\n")
    )
    .addNode("improveHaiku", "please improve the haiku")
    .addNode(
        "outputSuccess",
        "please restate the most recent haiku and its rating."
    )
    // connect our nodes
    .connect("makeHaiku", "rateHaiku")
    .connect("rateHaiku", "improveHaiku", "is the rating less than a 10?")
    .connect("improveHaiku", "rateHaiku")
    .connect("rateHaiku", "outputSuccess", "is the rating exactly 10?")
    // prefix path to output completed runs
    .output(`./testsdk`)
    // log event streams to stdout
    .log();

// execute a flow with a first prompt (optional)
const { value } = await workflow.execute("I like space");
//const { value } = await workflow.execute() <-- this would just get you a random haiku.

console.log("workflow complete", value);
