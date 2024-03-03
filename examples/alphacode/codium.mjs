import { Operable } from "looplib";
import z from "https://esm.sh/zod";
import { tableFromIPC } from "https://esm.sh/apache-arrow";
import filenamify from "https://esm.sh/filenamify";

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

        const preamble = `const newArray = (n, value) => {
    if (n > 1000) {
        throw new Error("allocation failure: array is too large");
    }
    const array = new Array(n);
    array.fill(value);
    return array;
};
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
