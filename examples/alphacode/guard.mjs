import { tableFromIPC } from "https://esm.sh/apache-arrow";
import {
    operableCombine,
    Operable,
    operableFrom,
    Trigger,
    prompt,
} from "looplib";
import { take, pipe, map, debounceTime, takeUntil, tap } from "rxjs";
import { Graph, alg } from "@dagrejs/graphlib";
import z from "zod";
import filenamify from "filenamify";

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

const getValids = async function () {
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
    return valids;
};

const challenges$ = new Operable(async function () {
    console.log("Challenges");
    const valids = await getValids();

    return valids
        .map(({ index, name, description, public_tests }) => {
            return {
                index,
                name,
                description,
                public_tests,
            };
        })
        .map((data) => ({
            type: "challenge",
            ...data,
        }));
});

const test = async function (trigger) {
    // await new Promise((resolve) => setTimeout(resolve, 1000));
    // console.log("FROMDAG", trigger.fromDag);
    // console.log(Trigger.graph.nodes());
    // !!trigger.previous;
    const valids = await getValids();
    const __challenge = trigger.findOne(_challenge);
    const challenge = valids.find((c) => c.index === __challenge.index);

    const code = trigger.payload.result;
    if (!code || !challenge) {
        throw new Error("No code or challenge found");
    }

    const preamble = `const newArray = (n, value) => {
    if (n > 1000) {
        throw new Error("allocation failure: array is too large");
    }
    const array = new Array(n);
    array.fill(value);
    return array;
};
`;

    const blob = new Blob([preamble, code], { type: "application/javascript" });
    // write the blob to a tmp file in the current directory named after the challenge name
    const tmpFile = `./testing-${filenamify(
        challenge.name
    )}.${timestamp}.${nonce}.js`;

    await Deno.writeFile(tmpFile, new Uint8Array(await blob.arrayBuffer()));
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
    //delete the tmp file
    await Deno.remove(tmpFile);
    const tries = trigger.find(this).length;

    return {
        type: "eval_results",
        name: challenge.name,
        tries,
        ...res,
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

let reflections = 0;
report$
    .pipe(
        prompt({
            prompt: `We are now done with this challenge.

List the types of errors you encountered and how you resolved them.
Did you get stuck?
if I provide you with a prior list of errors, repeat them in your response.
If you didn't get stuck or encounter any errors, simply repeat the accumulated report.
`,
            reducer: true,
            model: "gpt-4-0125-preview",
        })
    )
    .$.subscribe((trigger) => {
        console.log("REPORT", trigger.payload);
        const reflectPath = filenamify(
            `${path}.reflect.${timestamp}.${nonce}.${++reflections}.md`
        );

        Deno.writeTextFile(
            reflectPath,
            trigger.payload.messages[trigger.payload.messages.length - 1]
                .content
        );
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
        .passthrough(),
    true
);

const timeoutTests = get(
    z.object({ timeout: z.literal(true) }).passthrough(),
    true
);

const errorTests = get(
    z.object({ error: z.string(), stack: z.string() }).passthrough(),
    true
);
const regex = /```(?:javascript)?\n([\s\S]*?)\n```/;

const parse$ = conditional({
    code: get(regex, true),
    noCode: not(get(regex)),
});

workflow.pipe(
    challenges$,
    prompt({
        prompt: `You are an expert coder at Google.

Solve the programming challenge above following the rules as closely as possible

Reason about the problem before proceeding to provide your full solution.

The code:
- It must be a standalone ECMAScript module with no dependencies.
- It should have a function as the default export. It should have no external dependencies.
- It should accept a single 'lines' argument (an array of input strings). 
- It should return an array of output strings.
- It must not contain comments.
- It should use a provided function 'newArray' to create arrays instead of the built-in Array constructor.
  - newArray(n, value) returns an array of length n with each element set to value.
  - the function will throw an error if n is greater than 1000.
  - newArray is already defined in the global scope, you must not define or import it.

Enclose your code in a markdown codeblock.`,
        model: "gpt-3.5-turbo-16k",
        concurrency: 50,
    }),
    parse$
);

const testResults$ = conditional({
    pass: passedPublicTests,
    fail: failedPublicTests,
    timeout: timeoutTests,
    error: errorTests,
});

parse$.code.pipe(test, testResults$);

parse$.noCode.pipe(
    maxLoops(3, report$),
    prompt({
        prompt: "You failed to provide parseable code, or you included comments in your code. Please provide a code implementation that can be parsed and executed from a markdown code block.",
        model: "gpt-3.5-turbo-16k",
        concurrency: 50,
    }),
    parse$
);
testResults$.pass.pipe(report$);

testResults$.fail.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "You failed 1 or more of the public tests. Please provide an implementation that passes all Tests.",
        model: "gpt-3.5-turbo-16k",
        concurrency: 50,
    }),
    parse$
);

testResults$.timeout.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "Your code took too long to execute. Please provide an implementation that executes in a reasonable amount of time.",
        model: "gpt-3.5-turbo-16k",
        concurrency: 50,
    }),
    parse$
);

testResults$.error.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "Your code threw an error. Please provide an implementation that does not throw an error.",
        model: "gpt-3.5-turbo-16k",
        concurrency: 50,
    }),
    parse$
);

const triggers = [];
triggers.push(
    new Trigger(
        {
            run: Deno.args[0] ? parseInt(Deno.args[0]) : 0,
            hidden: true,
        },
        workflow
    )
);

const timestamp = new Date().toISOString();

triggers.forEach((trigger) => {
    workflow.next(trigger);
    trigger.toJson$().subscribe((json) => {
        const inProgressPath = filenamify(
            `${path}.inprogress.${timestamp}.${nonce}.${
                trigger.findOne(z.object({ run: z.number() })).run
            }.json`
        );
        Deno.writeTextFile(inProgressPath, json);
    });
});

finish$.$.subscribe((trigger) => {
    const json = JSON.stringify(
        alg.topsort(Trigger.graph).map((node) => {
            return Trigger.graph.node(node).serialize();
        }),
        null,
        2
    );

    const { run } = trigger.findOne(z.object({ run: z.number() }));
    const outputPath = filenamify(`${path}.${timestamp}.${nonce}.${run}.json`);
    const reportsPath = filenamify(
        `${path}.reports.${timestamp}.${nonce}.${run}.json`
    );

    Deno.writeTextFile(outputPath, json);

    const reports = trigger.find(
        z.object({ type: z.literal("report") }).passthrough()
    );
    Deno.writeTextFile(reportsPath, JSON.stringify(reports, null, 2));
    const summary = reports.reduce(
        (a, r) =>
            r.results.public_tests?.pass &&
            !r.results.private_tests?.fail &&
            !r.results.public_tests?.fail &&
            !r.results.generated_tests?.fail
                ? a + 1
                : a,
        0
    );

    const violent = reports.filter((r) => !r.results?.public_tests);

    console.log(
        nonce,
        run,
        "Finished:",
        summary,
        "passes in",
        reports.length,
        "challenges.",
        "Violent failures:",
        violent
    );
});

console.log("start");
function get(query, hidden = false) {
    return map(function (trigger) {
        // console.log("GET", trigger.get(query), trigger.payload);
        const res = trigger.get(query);
        if (!res) {
            return;
        }
        return { result: res, hidden };
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
