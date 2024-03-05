import { Operable } from "looplib";
import z from "https://esm.sh/zod";
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
}) =>
    async function (trigger) {
        const valids = await getChallenges({ includePrivate: true })();
        const __challenge = trigger.findOne(_challenge);
        const challenge = valids.find((c) => c.index === __challenge.index);

        const code = trigger.payload.result;
        if (!code || !challenge) {
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
        const tries = trigger.find(this).length + 1;

        return {
            type: "eval_results",
            name: challenge.name,
            tries,
            ...res,
        };
    };

export const generateReport = () => (trigger) => {
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
};

export const passedPublicTests = get(
    z
        .object({ public_tests: z.object({ fail: z.number().max(0) }) })
        .passthrough()
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
