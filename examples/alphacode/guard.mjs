import { Workflow } from "looplib/sdk.mjs";

const passAt = Deno.args[0];
const passAtNum = passAt ? Number.parseInt(passAt) : 1;

const workflow = new Workflow("test-flow");

const noCode = async (trigger) => {
    const context = await trigger.getContext();
    const codePacket = context
        .filter(
            ({ packets }) =>
                packets?.some(({ type }) => type === "code") || false
        )
        .map(
            ({ packets }) =>
                packets?.filter(({ type }) => type === "code") || []
        )
        .flat()
        .pop();

    if (codePacket?.data) {
        return null;
    }

    const priorNoCode = context
        .filter(
            ({ packets }) =>
                packets?.some(({ type }) => type === "nocode") || false
        )
        .map(
            ({ packets }) =>
                packets?.filter(({ type }) => type === "nocode") || []
        )
        .flat();

    if (priorNoCode.length > 3) {
        console.log("TOO MANY NO CODES", priorNoCode);
        return null;
    }

    console.log("HAS NO CODE", codePacket?.data);
    return [{ type: "nocode", data: {} }];
};

const hasCode = async (trigger) => {
    const context = await trigger.getContext();
    const codePacket = context
        .filter(
            ({ packets }) =>
                packets?.some(({ type }) => type === "code") || false
        )
        .map(
            ({ packets }) =>
                packets?.filter(({ type }) => type === "code") || []
        )
        .flat()
        .pop();

    if (codePacket?.data) {
        console.log("HAS CODE", codePacket.data);
        return [{ type: "hascode", data: {} }];
    }

    return null;
};

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
    const codeMessage = _.chain(context)
        .filter(
            ({ packets }) =>
                packets?.some(({ type }) => type === "message") || false
        )
        .map(
            ({ packets }) =>
                packets?.filter(({ type }) => type === "message") || []
        )
        .flatten()
        .filter(({ data }) =>
            /```(?:javascript)?\n([\s\S]*?)\n```/.test(data.content)
        )
        .last()
        .get("data.content")
        .value();

    if (!codeMessage) return { type: "code", data: null };

    const codeBlockRegex = /```(?:javascript)?\n([\s\S]*?)\n```/;
    const codeBlockMatch = codeMessage.match(codeBlockRegex);
    const codeBlock = codeBlockMatch ? codeBlockMatch[1].trim() : null;
    return { type: "code", data: codeBlock };
};

window.total = 0;
const testCodeFn = async (trigger) => {
    const context = await trigger.getContext();
    // console.log("TEST CONTEXT", context);
    const challengePacket = _.find(
        context,
        ({ packets }) =>
            packets && packets?.some(({ type }) => type === "challenge")
    );
    const challenge = challengePacket
        ? _.get(challengePacket, "packets").find(
              ({ type }) => type === "challenge"
          ).data
        : null;
    // console.log("CHALLENGE", challenge, context);
    const code = context
        .reduce((acc, { packets }) => acc.concat(packets || []), [])
        .reverse()
        .find(({ type }) => type === "code").data;

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
                breakOnFailure: true,
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
        data: { name: challenge.name, results: res, code, context },
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
        "provide a single javascript function that takes a single 'lines' argument (an array of input lines), and returns an array of output lines. Let's take this step by step to make sure we get the right answer. provide your result as an esm module with the function as the default export. do not wrap your code in a codeblock, just provide the raw text",
        { model: "gpt-3.5-turbo-16k", n: passAtNum, branch: true }
    )
    .connect("challenges", "solve")
    .addNode("parse", parseFn)
    .connect("solve", "parse")
    .addNode("test", testCodeFn)
    .connect("parse", "test", hasCode)
    .addNode(
        "nocodefix",
        "You failed to provide code that I could parse out of your response. Please provide a code block containing your complete solution."
    )
    .connect("parse", "nocodefix", noCode)
    .connect("nocodefix", "parse")
    .addNode("aggregate", aggregateFn, "challenges")
    .connect("test", "aggregate")
    .output("./codeguard-results")
    // .log()
    .execute();
