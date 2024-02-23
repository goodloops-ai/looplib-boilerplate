import { tableFromIPC } from "https://esm.sh/apache-arrow";
import { partialContextSchema, prompt } from "looplib/modules/gpt.mjs";
import {
    operableCombine,
    Operable,
    Trigger,
} from "looplib/modules/operable.mjs";
import { takeUntil, withLatestFrom, take } from "rxjs";
import { testPool } from "./testpool.mjs";
import { Graph, alg } from "graphlib";

const maxLoops = (max, operable, output) => {
    const fn = (trigger) => {
        const count = trigger.find(operable).length;
        if (count > max) {
            return true;
        }
        return false;
    };

    const guard$ = new Operable(fn);

    guard$.pipe(output);

    return (trigger) => {
        guard$.next(trigger);
        return !fn(trigger);
    };
};

// const passAt = Deno.args[0];
// const passAtNum = passAt ? Number.parseInt(passAt) : 1;

const workflow = new Operable(() => true);

const challenges$ = new Operable(async () => {
    console.log("Challenges");
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
            (
                {
                    name,
                    description,
                    public_tests,
                    private_tests,
                    generated_tests,
                },
                index
            ) =>
                JSON.parse(
                    JSON.stringify({
                        name,
                        description,
                        public_tests,
                        private_tests,
                        generated_tests,
                        index,
                    })
                )
        );

    return valids.map((data) => ({
        type: "challenge",
        ...data,
    }));
});
let i = 0;
const parse$ = new Operable((trigger) => {
    const codeMessage = trigger.payload.messages
        .filter(({ content }) =>
            /```(?:javascript)?\n([\s\S]*?)\n```/.test(content)
        )
        ?.pop()?.content;

    console.log("PARSE", i++);

    if (!codeMessage) return { type: "code", data: null };

    const codeBlockRegex = /```(?:javascript)?\n([\s\S]*?)\n```/;
    const codeBlockMatch = codeMessage.match(codeBlockRegex);
    const codeBlock = codeBlockMatch ? codeBlockMatch[1].trim() : null;
    return { type: "code", data: codeBlock };
});

const assertCode = (trigger) => {
    if (trigger.payload.type !== "code") {
        throw new Error("Expected code type input");
    }
};

const hasCode = (trigger) => {
    assertCode(trigger);
    return !!trigger.payload.data;
};

const hasNoCode$ = new Operable((trigger) => {
    assertCode(trigger);
    return !trigger.payload.data;
});

window.total = 0;
const testCode$ = new Operable(async (trigger) => {
    // touch the previous run to make this go in serial
    const challenge = trigger.findOne(({ type }) => type === "challenge");

    const code = trigger.findOne(
        ({ type, data }) => type === "code" && data
    )?.data;

    if (!code || !challenge) {
        throw new Error("No code or challenge found");
    }

    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
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
            const timeout = setTimeout(
                () => resolve({ timeout: true }),
                60 * 1000
            );

            worker.onmessage = (e) => {
                clearTimeout(timeout);
                resolve(e.data);
                worker.terminate();
            };

            worker.onerror = (e) => {
                clearTimeout(timeout);
                resolve({ error: e });
                worker.terminate();
            };
            console.log(
                "DISPATCH TEST",
                challenge.index,
                challenge.name,
                Deno.memoryUsage()
            );
            worker.postMessage({
                breakOnFailure: true,
                challenge,
                src: url,
                types: ["public_tests", "private_tests", "generated_tests"],
            });
        });
    } catch (e) {
        if (worker) {
            worker.terminate();
        }
        res = {
            error: e.toString(),
            stack: e.stack,
        };
    }

    URL.revokeObjectURL(url);
    const tries = trigger.find(({ type }) => type === "eval_results").length;

    return {
        type: "eval_results",
        name: challenge.name,
        results: res,
        tries,
        code,
    };
});

const output$ = new Operable(() => {
    console.log("got output");
    return true;
});

const finish$ = operableCombine([output$], challenges$, true);

const failPublicTests$ = new Operable((trigger) => {
    const results = trigger.findOne(
        ({ type }) => type === "eval_results"
    )?.results;

    if (!results) {
        throw new Error("No results found");
    }

    const challenge = trigger.findOne(({ type }) => type === "challenge");

    if (results.public_tests?.fail > 0 || results.timeout) {
        return {
            type: "partial",
            messages: [
                {
                    role: "user",
                    content: [
                        "Public test data:",
                        challenge.public_tests.input
                            .map(
                                (i, idx) =>
                                    `Test ${idx} Input: ${i}\nTest ${idx} Expected Output:\n${challenge.public_tests.output[idx]}`
                            )
                            .join("\n\n"),
                    ].join("\n\n"),
                },
            ],
        };
    }

    return null;
});

const passPublicTests = async (trigger) => {
    const results = trigger.findOne(
        ({ type }) => type === "eval_results"
    )?.results;

    if (!results) {
        throw new Error("No results found");
    }

    const challenge = trigger.findOne(({ type }) => type === "challenge");

    if (results.public_tests?.fail === 0) {
        return { type: "passPublic" };
    }

    return null;
};

let j = 0;
workflow.pipe(
    challenges$,
    (trigger) => {
        return {
            type: "partial",
            messages: [
                {
                    role: "user",
                    content: trigger.payload.description,
                },
            ],
        };
    },
    prompt({
        prompt: `You are an expert coder at Google.

Solve the programming challenge above following the rules as closely as possible

Create a sketch of the solution before proceeding to provide your full solution.

The code should:
- Be a stand-alone ECMAScript module with no external requirements.
- It should have a function as the default export. It should have no external dependencies. 
- It should accept a single 'lines' argument (an array of input strings). 
- It should return an array of output strings.
- Do not use any comments in your code.

Enclose your code in a markdown codeblock.`,
        model: "gpt-4-0125-preview",
    }),
    parse$
);

parse$.pipe(
    hasNoCode$,
    maxLoops(3, hasNoCode$, output$),
    prompt({
        prompt: "You failed to provide code that I could parse out of your response. Please provide a code block containing your complete solution.",
        model: "gpt-4-0125-preview",
    }),
    parse$
);

parse$.pipe(hasCode, testCode$);

testCode$.pipe(
    failPublicTests$,
    maxLoops(3, failPublicTests$, output$),
    prompt({
        prompt: "You failed to pass one or more of the public tests. Please provide a solution that passes all the public tests.",
        model: "gpt-4-0125-preview",
    }),
    parse$
);

testCode$.pipe(passPublicTests, output$);

const trigger = new Trigger(0, workflow);

workflow.next(trigger);

// trigger
//     .toJson$()
//     .pipe(takeUntil(finish$.$))
//     .subscribe((json) => {
//     });
finish$.$.pipe(take(1)).subscribe(() => {
    const json = JSON.stringify(
        alg.topsort(Trigger.graph).map((node) => {
            return Trigger.graph.node(node).serialize();
        }),
        null,
        2
    );

    Trigger.sub.unsubscribe();

    Deno.writeTextFile("./guardOutput.alexprompt.memfix.4.json", json);
    console.log("FINISH");
});

console.log("start");
