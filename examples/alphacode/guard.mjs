import { Workflow } from "looplib/sdk.mjs";

const passAt = Deno.args[0];
const passAtNum = passAt ? Number.parseInt(passAt) : 1;

const workflow = new Workflow("guard-flow");

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
    const tries = context
        .map(({ packets }) => packets)
        .flat()
        .filter(Boolean)
        .filter(({ type }) => type === "eval_results").length;

    return {
        type: "eval_results",
        data: {
            name: challenge.name,
            results: res,
            tries,
            code,
            context,
        },
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

const passPublicTests = async (trigger) => {
    const context = await trigger.getContext();
    const results = context
        .map(({ packets }) => packets)
        .flat()
        .filter(Boolean)
        .filter(({ type }) => type === "eval_results")
        .map(({ data }) => data.results);

    console.log("PASS PUBLIC TESTS???", results);
    return results.length > 3 || results.pop()?.public_tests?.fail === 0
        ? [{ type: "passOrExhaust" }]
        : null;
};

const failPublicTests = async (trigger) => {
    const context = await trigger.getContext();
    const results = context
        .map(({ packets }) => packets)
        .flat()
        .filter(Boolean)
        .filter(({ type }) => type === "eval_results")
        .map(({ data }) => data.results);

    const challenge = context
        .map(({ packets }) => packets)
        .flat()
        .filter(Boolean)
        .filter(({ type }) => type === "challenge")
        .map(({ data }) => data)
        .pop();

    console.log("FAIL PUBLIC TESTS???", results);
    const last = results.pop();
    if (results.length < 3 && (last?.public_tests?.fail > 0 || last.timeout)) {
        return [
            {
                type: "message",
                data: {
                    role: "user",
                    content: [
                        "public test data",
                        challenge.public_tests.input
                            .map(
                                (i, idx) =>
                                    `Test ${idx} Input: ${i}\nTest ${idx} Expected Output:\n${challenge.public_tests.output[idx]}`
                            )
                            .join("\n\n"),
                    ].join("\n\n"),
                },
            },
        ];
    }

    return null;
};

await workflow
    .addNode("challenges", challengesFn)
    .addNode(
        "solve",
        "provide a single javascript function that takes a single 'lines' argument (an array of input lines), and returns an array of output lines. Let's take this step by step to make sure we get the right answer. provide your result as an esm module with the function as the default export.",
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
    .addNode(
        "publicTestFix",
        "You failed to pass one or more of the public tests. Please provide a solution that passes all the public tests.",
        { model: "gpt-3.5-turbo-16k" }
    )
    .connect("test", "aggregate", passPublicTests)
    .connect("test", "publicTestFix", failPublicTests)
    .connect("publicTestFix", "parse")
    .output("./codeguard-results")
    // .log()
    .execute();
