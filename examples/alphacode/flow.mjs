import { Workflow } from "looplib/sdk.mjs";

const workflow = new Workflow("test-flow");

const challengesFn = async () => {
    const { tableFromIPC } = await import("https://esm.sh/apache-arrow");
    let table;
    try {
        const data = await Deno.readFile(
            "./examples/alphacode/codechallenge_valid.arrow"
        );
        table = tableFromIPC(data);
    } catch (e) {
        table = await tableFromIPC(
            fetch("./examples/alphacode/codechallenge_valid.arrow")
        );
    }
    const rows = table.batches[0].toArray();
    const valids = rows
        .filter(({ is_valid_problem }) => is_valid_problem)
        .map(
            ({
                name,
                description,
                public_tests,
                private_tests,
                generated_tests,
            }) =>
                JSON.parse(
                    JSON.stringify({
                        name,
                        description,
                        public_tests,
                        private_tests,
                        generated_tests,
                    })
                )
        );

    return valids.map((data) => [
        {
            type: "challenge",
            data,
        },
        {
            type: "message",
            data: {
                role: "user",
                content: data.description,
            },
        },
    ]);
};

const parseFn = async (trigger) => {
    const context = await trigger.getContext();
    const codeMessage = _.get(
        _.findLast(context, { node: "solve" }).packets,
        "[1].data.content"
    );
    const codeBlockRegex = /```(?:javascript)?\n([\s\S]*?)\n```/;
    const codeBlockMatch = codeMessage.match(codeBlockRegex);
    const codeBlock = codeBlockMatch ? codeBlockMatch[1].trim() : null;
    return { type: "code", data: codeBlock };
};

window.total = 0;
const testCodeFn = async (trigger) => {
    const context = await trigger.getContext();
    // console.log("TEST CONTEXT", context);
    const challengeNode = _.find(
        context,
        ({ node, packets }) => node === "challenges" && packets.length
    );
    const challenge = challengeNode
        ? _.get(challengeNode, "packets").find(
              ({ type }) => type === "challenge"
          ).data
        : null;

    // console.log("CHALLENGE", challenge, context);
    const code = _.get(
        _.find(
            context,
            ({ node, packets }) => node === "parse" && packets.length
        ),
        "packets"
    ).find(({ type }) => type === "code").data;

    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    console.log("DO CHALLENGE IN WORKER", challenge.name);
    let res;
    let worker;
    try {
        worker = new Worker(
            import.meta.resolve("@local/examples/alphacode/testworker.mjs"),
            {
                type: "module",
            }
        );

        res = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => resolve({ timeout: true }), 60);

            worker.onerror = (e) => {
                clearTimeout(timeout);
                resolve({ error: e });
                worker.terminate();
            };

            worker.postMessage({
                challenge,
                src: url,
                types: ["public_tests", "private_tests", "generated_tests"],
            });

            worker.onmessage = (event) => {
                clearTimeout(timeout);
                resolve(event.data);
                worker.terminate();
            };
        });
    } catch (e) {
        if (worker) worker.terminate();
        res = {
            error: e.toString(),
            stack: e.stack,
        };
    }

    console.log("DONE", ++total, res);
    return {
        type: "eval_results",
        data: { name: challenge.name, results: res, code },
    };
};

const aggregateFn = async (trigger) => {
    console.log("GOT ALL RESULTS");
    const context = await trigger.parents_;
    const data = context
        .map((c) => c.toJSON())
        .map(({ packets: [{ data }] }) => data);

    return { type: "aggregate_results", data };
};

await workflow
    .addNode("challenges", challengesFn)
    .addNode(
        "solve",
        "provide a single javascript function that takes a single 'lines' argument (an array of input lines), and returns an array of output lines. Let's take this step by step to make sure we get the right answer. provide your result as an esm module with the function as the default export"
    )
    .connect("challenges", "solve")
    .addNode("parse", parseFn)
    .connect(
        "solve",
        "parse",
        "is the program free of obvious memory leaks or hazardous memory allocations?"
    )
    .addNode("test", testCodeFn)
    .connect("parse", "test")
    .addNode("aggregate", aggregateFn, "challenges")
    .connect("test", "aggregate")
    .output("./sdk-results")
    .log()
    .execute();
