import { Operable } from "looplib";
import z from "https://esm.sh/zod";
import { mergeMap, pipe } from "https://esm.sh/rxjs";
import { tableFromIPC } from "https://esm.sh/apache-arrow";
import filenamify from "https://esm.sh/filenamify";
import { get } from "./std.mjs";

const _challenge = z
    .object({
        type: z.literal("challenge"),
    })
    .passthrough();

const getValids = async function (
    path = "./examples/alphacode/codechallenge_valid.arrow"
) {
    let table;
    try {
        const data = await Deno.readFile(path);
        table = tableFromIPC(data);
    } catch (e) {
        table = await tableFromIPC(fetch(path));
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
//  [
//     61, 97, 71, 46, 89, 40, 98, 5, 84, 34, 100, 87, 58, 54, 44, 1,
// ].includes(index)
export function getChallenges({
    path,
    includePrivate = false,
    subset = [],
} = {}) {
    return async function getChallenges() {
        console.log("Challenges");
        const valids = await getValids(path);

        return valids
            .map(
                ({
                    index,
                    name,
                    description,
                    public_tests,
                    private_tests,
                    generated_tests,
                }) => {
                    return {
                        index,
                        name,
                        description,
                        public_tests,
                        ...(includePrivate && {
                            private_tests,
                            generated_tests,
                        }),
                    };
                }
            )
            .map((data) => ({
                type: "challenge",
                ...data,
            }))
            .filter(
                ({ index }) => subset.length === 0 || subset.includes(index)
            );
    };
}

export const testSolution = ({
    timestamp = new Date().toISOString(),
    nonce = Math.floor(Math.random() * 1000),
    reformat = false,
    types = ["public_tests", "private_tests", "generated_tests"],
}) =>
    async function (trigger) {
        const valids = await getChallenges({ includePrivate: true })();
        const __challenge = trigger.findOne(_challenge);
        const challenge = valids.find((c) => c.index === __challenge.index);

        const code = trigger.payload.result;
        if (!code || !challenge) {
            console.log("No code or challenge found!!!!!!!!!!!!!!!");
            throw new Error("No code or challenge found");
        }

        const preamble = `(function() {
    // Save a reference to the original Array constructor
    const OriginalArray = Array;

    // Define a new constructor function that wraps the original Array constructor
    function ArrayExtended(...args) {
        // Check if the new array size is more than 100000
        if (args.length === 1 && typeof args[0] === 'number' && args[0] > 100000) {
            throw new Error("self.Array has been modified in this environment. Array size cannot exceed 100000 items in this environment.");
        }

        // Use the original Array constructor's behavior for instantiation
        const instance = new OriginalArray(...args);

        // Copy all properties and methods from the original Array prototype to the new instance
        // This ensures that methods like Array.from, Array.isArray, etc., are preserved
        Object.setPrototypeOf(instance, ArrayExtended.prototype);

        return instance;
    }

    // Set the prototype of the new constructor to the original Array prototype
    // This ensures that instances of ArrayExtended are still instances of Array
    ArrayExtended.prototype = Object.create(OriginalArray.prototype);
    // Ensure the constructor property points to the new constructor
    ArrayExtended.prototype.constructor = ArrayExtended;

    // Copy static methods from the original Array to the new constructor
    // This includes methods like Array.from, Array.isArray, etc.
    Object.setPrototypeOf(ArrayExtended, OriginalArray);

    // Override the global Array with the new constructor
    self.Array = ArrayExtended;
})();
`;

        const blob = new Blob([preamble, code], {
            type: "application/javascript",
        });
        // write the blob to a tmp file in the current directory named after the challenge name
        const tmpFile = filenamify(
            `./testing-${challenge.name}.${timestamp}.${nonce}.js`
        );

        try {
            await Deno.writeFile(
                tmpFile,
                new Uint8Array(await blob.arrayBuffer())
            );
        } catch (e) {}
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
                    types,
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

        for (const type of [
            "public_tests",
            "private_tests",
            "generated_tests",
        ]) {
            if (reformat && res[type] && res[type].failures) {
                res[type].failures = res[type].failures.map((f) => ({
                    ...f,
                    input: reformat
                        ? f.input
                        : JSON.stringify(f.input.split("\n")),
                    expected: reformat
                        ? f.expected
                        : JSON.stringify(f.expected.split("\n")),
                }));
            }
        }

        URL.revokeObjectURL(url);
        //delete the tmp file
        await Deno.remove(tmpFile);
        const tries = trigger.find(this).length + 1;

        return {
            type: "eval_results",
            name: challenge.name,
            tries,
            ...res,
        };
    };

export const testSolution1 = ({
    timestamp = new Date().toISOString(),
    nonce = Math.floor(Math.random() * 1000),
    concurrency = 1,
}) =>
    async function (trigger) {
        const valids = await getChallenges({ includePrivate: true })();
        const __challenge = trigger.findOne(_challenge);
        const challenge = valids.find((c) => c.index === __challenge.index);

        const code = trigger.payload.result;
        if (!code || !challenge) {
            console.log("No code or challenge found!!!!!!!!!!!!!!!");
            throw new Error("No code or challenge found");
        }

        const preamble = `(function() {
    // Save a reference to the original Array constructor
    const OriginalArray = Array;

    // Define a new constructor function that wraps the original Array constructor
    function ArrayExtended(...args) {
        // Check if the new array size is more than 100000
        if (args.length === 1 && typeof args[0] === 'number' && args[0] > 100000) {
            throw new Error("self.Array has been modified in this environment. Array size cannot exceed 100000 items in this environment.");
        }

        // Use the original Array constructor's behavior for instantiation
        const instance = new OriginalArray(...args);

        // Copy all properties and methods from the original Array prototype to the new instance
        // This ensures that methods like Array.from, Array.isArray, etc., are preserved
        Object.setPrototypeOf(instance, ArrayExtended.prototype);

        return instance;
    }

    // Set the prototype of the new constructor to the original Array prototype
    // This ensures that instances of ArrayExtended are still instances of Array
    ArrayExtended.prototype = Object.create(OriginalArray.prototype);
    // Ensure the constructor property points to the new constructor
    ArrayExtended.prototype.constructor = ArrayExtended;

    // Copy static methods from the original Array to the new constructor
    // This includes methods like Array.from, Array.isArray, etc.
    Object.setPrototypeOf(ArrayExtended, OriginalArray);

    // Override the global Array with the new constructor
    self.Array = ArrayExtended;
})();
`;

        const blob = new Blob([preamble, code], {
            type: "application/javascript",
        });
        // write the blob to a tmp file in the current directory named after the challenge name
        const tmpFile = filenamify(
            `./testing-${challenge.name}.${timestamp}.${nonce}.js`
        );

        try {
            await Deno.writeFile(
                tmpFile,
                new Uint8Array(await blob.arrayBuffer())
            );
        } catch (e) {}
        const url = URL.createObjectURL(blob);
        let total_results = {};
        let worker;
        try {
            const types = ["public_tests", "private_tests", "generated_tests"];

            for (const type of types) {
                if (challenge[type]) {
                    let pass = 0;
                    const failures = [];

                    for (const index in challenge[type].input) {
                        const expected = challenge[type].output[index];
                        const input = challenge[type].input[index];

                        worker = new Worker(
                            import.meta.resolve(
                                "@local/examples/alphacode/testworker.single.mjs"
                            ),
                            {
                                type: "module",
                            }
                        );

                        const res = await new Promise((resolve, reject) => {
                            const timeout = setTimeout(
                                () =>
                                    resolve({
                                        pass: false,
                                        timeout: true,
                                        input,
                                        expected,
                                    }),
                                10000
                            );

                            worker.onmessage = (e) => {
                                clearTimeout(timeout);
                                resolve(e.data);
                                worker.terminate();
                            };

                            worker.onerror = (e) => {
                                clearTimeout(timeout);
                                resolve({
                                    pass: false,
                                    error: e,
                                    input,
                                    expected,
                                });
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
                                input,
                                expected,
                            });
                        });

                        if (res.pass) {
                            pass++;
                        }
                        if (!res.pass) {
                            failures.push(res);
                        }
                        if (!res.pass && type !== "public_tests") {
                            break;
                        }
                    }

                    total_results[type] = {
                        pass,
                        fail: failures.length,
                        failures,
                    };
                    if (failures.length > 0) {
                        break;
                    }
                }
            }
        } catch (e) {
            if (worker) {
                worker.terminate();
            }
            total_results = {
                error: e.toString(),
                stack: e.stack,
            };
        }

        URL.revokeObjectURL(url);
        //delete the tmp file
        await Deno.remove(tmpFile);
        const tries = trigger.find(this).length + 1;

        return {
            type: "eval_results",
            name: challenge.name,
            tries,
            ...total_results,
        };
    };

export const generateReport = () => (trigger) => {
    console.log("generateReport");
    const results = trigger.findOne(
        z.object({ type: z.literal("eval_results") }).passthrough()
    );
    const challenge = trigger.findOne(_challenge);

    const tokens = trigger
        .find(
            z.object({
                tokens: z.object({
                    model: z.string(),
                    request: z.number(),
                    response: z.number(),
                }),
            })
        )
        .reduce((acc, { tokens: { model, request, response } }) => {
            if (!acc[model]) {
                acc[model] = { request: 0, response: 0 };
            }
            acc[model].request += request;
            acc[model].response += response;
            return acc;
        }, {});

    return {
        type: "report",
        results,
        tokens,
        challenge: {
            name: challenge.name,
            description: challenge.description,
            index: challenge.index,
        },
    };
};

export const passedPublicTests = get(
    z
        .object({ public_tests: z.object({ fail: z.number().max(0) }) })
        .passthrough()
);

export const passedAllTests = get(
    z
        .object({
            public_tests: z.object({ fail: z.number().max(0) }),
            private_tests: z.object({ fail: z.number().max(0) }),
            generated_tests: z.object({ fail: z.number().max(0) }),
        })
        .passthrough(),
    true
);

export const failedPublicTests = get(
    z
        .object({ public_tests: z.object({ fail: z.number().min(1) }) })
        .passthrough(),
    true
);

export const timeoutTests = get(
    z.object({ timeout: z.literal(true) }).passthrough(),
    true
);

export const errorTests = get(
    z.object({ error: z.string(), stack: z.string() }).passthrough(),
    true
);
