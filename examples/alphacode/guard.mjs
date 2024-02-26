import { tableFromIPC } from "https://esm.sh/apache-arrow";
import {
    operableCombine,
    Operable,
    operableFrom,
    Trigger,
    prompt,
} from "looplib";
import { take, pipe, map, debounceTime, takeUntil } from "rxjs";
import { Graph, alg } from "@dagrejs/graphlib";
import z from "zod";

window.Trigger = Trigger;
window.alg = alg;

const path = Deno.args[0] || "./guardOutput";
const nonce = Math.random().toString(36).substring(7);
const inProgressPath = `${path}.inprogress.${nonce}.json`;
const outputPath = `${path}.${nonce}.json`;
const reportsPath = `${path}.reports.${nonce}.json`;

function maxLoops(max, bail$) {
    return guard(lessThan(max), bail$);
}

function lessThan(count) {
    return function (trigger) {
        // console.log("lessThan", trigger.find(this), this, count);
        return trigger.find(this).length < count;
    };
}

function guard(condition, bail$) {
    return function (trigger) {
        condition = condition.bind(this);
        const res = condition(trigger);
        return res || bail$.next(trigger);
    };
}

const workflow = new Operable(() => true);

const challenges$ = new Operable(async function () {
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

const test = async function (trigger) {
    // await new Promise((resolve) => setTimeout(resolve, 1000));
    // console.log("FROMDAG", trigger.fromDag);
    // console.log(Trigger.graph.nodes());
    // !!trigger.previous;
    const challenge = trigger.findOne(_challenge);

    const code = trigger.payload;
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
                !!code,
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
    const tries = trigger.find(this).length;

    return {
        type: "eval_results",
        name: challenge.name,
        ...res,
        tries,
        code,
    };
};

const report$ = new Operable((trigger) => {
    const results = trigger.findOne(
        z.object({ type: z.literal("eval_results") }).passthrough()
    );
    const challenge = trigger.findOne(_challenge);
    return {
        type: "report",
        results,
        challenge: {
            name: challenge.name,
            description: challenge.description,
            index: challenge.index,
        },
    };
});

const finish$ = operableCombine([report$], challenges$, true);

const _challenge = z
    .object({
        type: z.literal("challenge"),
    })
    .passthrough();

const addToContext = (prompt, query) => {
    return pipe(
        query,
        map((payload) => {
            // console.log("ADD TO CONTEXT", prompt, payload);
            return {
                type: "partial",
                messages: [
                    {
                        role: "user",
                        content: `${prompt}\n\n${payload}`,
                    },
                ],
            };
        })
    );
};

const passedPublicTests = get(
    z
        .object({ public_tests: z.object({ fail: z.number().max(0) }) })
        .passthrough()
);

const failedPublicTests = get(
    z
        .object({ public_tests: z.object({ fail: z.number().min(1) }) })
        .passthrough()
);

const timeoutTests = get(z.object({ timeout: z.literal(true) }).passthrough());

const parse$ = conditional({
    code: get(/```(?:javascript)?\n([\s\S]*?)\n```/),
    noCode: not(get(/```(?:javascript)?\n([\s\S]*?)\n```/)),
});

workflow.pipe(
    challenges$,
    addToContext(
        "You are going to solve the following challenge:",
        get(
            _challenge.transform((data) => {
                return data.description;
            })
        )
    ),
    addToContext(
        "These public tests will be used to check your work:",
        findOne(
            _challenge.transform((data) => {
                return data.public_tests.input
                    .map(
                        (i, idx) =>
                            `Test ${idx} Input:\n ${i}\nTest ${idx} Expected Output:\n${data.public_tests.output[idx]}`
                    )
                    .join("\n\n");
            })
        )
    ),
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
        model: "gpt-3.5-turbo-16k",
    }),
    parse$
);

const testResults$ = conditional({
    pass: passedPublicTests,
    fail: failedPublicTests,
    timeout: timeoutTests,
});

parse$.code.pipe(test, testResults$);

parse$.noCode.pipe(
    maxLoops(3, report$),
    prompt({
        prompt: "You failed to provide parseable code. Please provide a code implementation that can be parsed and executed from a markdown code block.",
        model: "gpt-3.5-turbo-16k",
    }),
    parse$
);
testResults$.pass.pipe(report$);

testResults$.fail.pipe(
    maxLoops(3, report$),
    prompt({
        prompt: "You failed 1 or more of the public tests. Please provide an implementation that passes all Tests.",
        model: "gpt-3.5-turbo-16k",
    }),
    parse$
);

testResults$.timeout.pipe(
    maxLoops(3, report$),
    prompt({
        prompt: "Your code took too long to execute. Please provide an implementation that executes in a reasonable amount of time.",
        model: "gpt-3.5-turbo-16k",
    }),
    parse$
);

const trigger = new Trigger(0, workflow);

workflow.next(trigger);

// trigger
//     .toJson$()
//     .pipe(takeUntil(finish$.$))
//     .subscribe((json) => {
//         Deno.writeTextFile(inProgressPath, json);
//     });
finish$.$.pipe(take(1)).subscribe((trigger) => {
    const json = JSON.stringify(
        alg.topsort(Trigger.graph).map((node) => {
            return Trigger.graph.node(node).serialize();
        }),
        null,
        2
    );

    Trigger.sub.unsubscribe();

    Deno.writeTextFile(outputPath, json);

    const reports = trigger.find(
        z.object({ type: z.literal("report") }).passthrough()
    );
    Deno.writeTextFile(reportsPath, JSON.stringify(reports, null, 2));
    const summary = reports.reduce(
        (a, r) =>
            !r.results.private_tests?.fail &&
            !r.results.public_tests?.fail &&
            !r.results.generated_tests?.fail
                ? a + 1
                : a,
        0
    );
    console.log(
        "Finished:",
        summary,
        "passes in",
        reports.length,
        "challenges"
    );
});

console.log("start");
function get(query) {
    return map(function (trigger) {
        // console.log("GET", trigger.get(query), trigger.payload);
        const res = trigger.get(query);
        return res;
    });
}

function find(query) {
    return map(function (trigger) {
        return trigger.find(query);
    });
}

function findOne(query) {
    return map(function (trigger) {
        return trigger.findOne(query);
    });
}

function not(fn) {
    return pipe(
        fn,
        map((res) => !res)
    );
}

function passThrough(trigger) {
    return trigger;
}

function conditional(conditions) {
    const input$ = operableFrom(passThrough);

    Object.entries(conditions).forEach(([key, value]) => {
        input$[key] = operableFrom(value);
        input$.pipe(input$[key]);
    });

    return input$;
}
