import filenamify from "filenamify";

export const runTests = async ({ code, tests, challenge }) => {
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
        await Deno.writeFile(tmpFile, new Uint8Array(await blob.arrayBuffer()));
    } catch (e) {}
    const url = URL.createObjectURL(blob);
    let total_results = [];
    let worker;

    console.log("RUNNING TESTS", challenge.name, challenge.index);
    try {
        for (const test of tests) {
            const { input, output: expected } = test;
            worker = new Worker(
                import.meta.resolve("@local/dspl/testworker.single.mjs"),
                {
                    type: "module",
                }
            );

            const res = await new Promise((resolve, reject) => {
                const timeout = setTimeout(
                    () =>
                        resolve({
                            status: "fail",
                            timeout: true,
                            input,
                            message: "Timeout",
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
                        status: "fail",
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
                    challenge.name
                );
                worker.postMessage({
                    breakOnFailure: true,
                    challenge,
                    src: url,
                    input,
                    expected,
                });
            });

            total_results.push(res);
        }
    } catch (e) {
        if (worker) {
            worker.terminate();
        }
        total_results = [
            {
                status: "error",
                message: "An error occurred while running the tests: " + e,
                error: e.toString(),
                stack: e.stack,
            },
        ];
    }

    URL.revokeObjectURL(url);
    //delete the tmp file
    await Deno.remove(tmpFile);

    console.log("RESULTS", challenge.name, total_results);
    return total_results;
};
