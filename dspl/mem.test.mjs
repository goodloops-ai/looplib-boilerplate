import {
    assertEquals,
    assertNotEquals,
} from "https://deno.land/std/testing/asserts.ts";
import { mem, importJson } from "../dspl/mem.mjs";
import { runTests } from "./testHarness.mjs";
import _ from "https://esm.sh/lodash";

Deno.test(
    "mem library - basic memoization and dependency resolution",
    async () => {
        const calculator = mem({
            a: 10,
            b: 20,
            sum: {
                get: ({ a, b }) => a + b,
            },
            product: {
                get: ({ a, b }) => a * b,
            },
        });

        assertEquals(
            await calculator.sum,
            30,
            "Sum should be correctly computed"
        );
        assertEquals(
            await calculator.product,
            200,
            "Product should be correctly computed"
        );

        // Test memoization by changing dependencies
        calculator.a = 5;
        assertEquals(
            await calculator.sum,
            25,
            "Sum should be updated after changing a dependency"
        );
        assertEquals(
            await calculator.product,
            100,
            "Product should be updated after changing a dependency"
        );
    }
);

Deno.test("mem library - asynchronous getters", async () => {
    const asyncCalculator = mem({
        a: 10,
        b: 20,
        asyncSum: {
            get: async ({ a, b }) => {
                // Simulate an asynchronous operation
                return new Promise((resolve) =>
                    setTimeout(() => resolve(a + b), 100)
                );
            },
        },
        asyncProduct: {
            get: async ({ a, b }) => {
                // Simulate an asynchronous operation
                return new Promise((resolve) =>
                    setTimeout(() => resolve(a * b), 100)
                );
            },
        },
    });

    assertEquals(
        await asyncCalculator.asyncSum,
        30,
        "Async sum should be correctly computed"
    );
    assertEquals(
        await asyncCalculator.asyncProduct,
        200,
        "Async product should be correctly computed"
    );
});

Deno.test("mem library - memoization with complex dependencies", async () => {
    const complexObject = mem({
        baseValue: 5,
        increment: {
            get: ({ baseValue }) => baseValue + 1,
        },
        double: {
            get: ({ increment }) => increment * 2,
        },
        asyncTriple: {
            get: async ({ double }) => {
                // Simulate an asynchronous operation
                return new Promise((resolve) =>
                    setTimeout(() => resolve(double * 1.5), 100)
                );
            },
        },
    });

    assertEquals(
        await complexObject.increment,
        6,
        "Increment should be correctly computed"
    );
    assertEquals(
        await complexObject.double,
        12,
        "Double should be correctly computed"
    );
    assertEquals(
        await complexObject.asyncTriple,
        18,
        "Async triple should be correctly computed"
    );

    // Test memoization by changing the base value
    complexObject.baseValue = 10;
    assertEquals(
        await complexObject.increment,
        11,
        "Increment should be updated after changing baseValue"
    );
    assertEquals(
        await complexObject.double,
        22,
        "Double should be updated after changing baseValue"
    );
    assertEquals(
        await complexObject.asyncTriple,
        33,
        "Async triple should be updated after changing baseValue"
    );
});

Deno.test(
    "mem library - async function memoization without dependency changes",
    async () => {
        let computationCount = 0;

        const asyncMemoTest = mem({
            input: 5,
            asyncComputed: {
                get: async ({ input }) => {
                    computationCount++;
                    // Simulate an asynchronous computation
                    return new Promise((resolve) =>
                        setTimeout(() => resolve(input * 2), 100)
                    );
                },
            },
        });

        // First access triggers computation
        const firstAccessStart = performance.now();
        const firstResult = await asyncMemoTest.asyncComputed;
        const firstAccessDuration = performance.now() - firstAccessStart;

        assertEquals(
            firstResult,
            10,
            "First result should be correctly computed"
        );
        assertEquals(computationCount, 1, "Computation should occur once");

        // Second access should be memoized, hence faster and without recomputation
        const secondAccessStart = performance.now();
        const secondResult = await asyncMemoTest.asyncComputed;
        const secondAccessDuration = performance.now() - secondAccessStart;

        assertEquals(
            secondResult,
            10,
            "Second result should be memoized and match the first"
        );
        assertEquals(
            computationCount,
            1,
            "Computation count should not increase"
        );
        assertEquals(
            secondAccessDuration < firstAccessDuration / 2,
            true,
            "Second access should be significantly faster due to memoization"
        );
    }
);

Deno.test(
    "mem library - async function memoization with dependency changes",
    async () => {
        let computationCount = 0;

        const asyncMemoTest = mem({
            input: 5,
            asyncComputed: {
                get: async ({ input }) => {
                    computationCount++;
                    // Simulate an asynchronous computation
                    return new Promise((resolve) =>
                        setTimeout(() => resolve(input * 2), 100)
                    );
                },
            },
        });

        // First access to compute and memoize
        await asyncMemoTest.asyncComputed;
        assertEquals(computationCount, 1, "Initial computation should occur");

        // Change dependency
        asyncMemoTest.input = 10;

        // Access after changing dependency should trigger recomputation
        const recomputedResult = await asyncMemoTest.asyncComputed;
        assertEquals(
            recomputedResult,
            20,
            "Result should be recomputed after dependency change"
        );
        assertEquals(
            computationCount,
            2,
            "Computation count should increase after dependency change"
        );
    }
);

Deno.test("kitchen sink", async () => {
    const codium = mem({
        challengeFile: "./dspl/challenges.valid.json",
        challenges: {
            get: ({ challengeFile }) =>
                importJson(challengeFile, {
                    public_test_results: {
                        get: ({ public_tests, code }) =>
                            runTests(code, public_tests),
                    },
                    public_tests_passed: {
                        get: ({ public_test_results }) =>
                            public_test_results?.length &&
                            _.every(public_test_results, ["status", "pass"]),
                    },
                    private_test_results: {
                        get: ({ public_tests_passed, private_tests, code }) =>
                            public_tests_passed
                                ? runTests(code, private_tests, {
                                      breakOnFailure: true,
                                  })
                                : [],
                    },
                    private_tests_passed: {
                        get: ({ private_test_results }) =>
                            private_test_results?.length &&
                            _.every(private_test_results, ["status", "pass"]),
                    },
                    generated_test_results: {
                        get: ({
                            public_tests_passed,
                            private_tests_passed,
                            generated_tests,
                            code,
                        }) =>
                            public_tests_passed && private_tests_passed
                                ? runTests(code, generated_tests, {
                                      breakOnFailure: true,
                                  })
                                : [],
                    },
                    generated_tests_passed: {
                        get: ({ generated_test_results }) =>
                            generated_test_results?.length &&
                            _.every(generated_test_results, ["status", "pass"]),
                    },
                    tests_passed: {
                        get: ({
                            public_tests_passed,
                            private_tests_passed,
                            generated_tests_passed,
                        }) => {
                            return (
                                public_tests_passed &&
                                private_tests_passed &&
                                generated_tests_passed
                            );
                        },
                    },
                }),
        },
    });
    console.log(await codium.challengeFile);
    console.log((await codium.challenges)?.length);
    const gregor = (await codium.challenges)[5];
    console.log("code set, public tests", await gregor.public_test_results);
    console.log("public tests passed", await gregor.public_tests_passed);
    console.log("private tests", await gregor.private_test_results);
    // console.log("private tests passed", await gregor.private_tests_passed);
    const midTime = Date.now();
    // console.log("Time taken so far: ", midTime - startTime, "ms");
    gregor.code = `function solveGregorPawnGame(lines) {
        let results = [];
        let t = parseInt(lines[0]);
        let lineIndex = 1;
        for (let i = 0; i < t; i++) {
            let n = parseInt(lines[lineIndex++]);
            let enemyRow = lines[lineIndex++];
            let gregorRow = lines[lineIndex++];
            let pawnsReached = 0;
            for (let j = 0; j < n; j++) {
                if (gregorRow[j] === "1") {
                    if (enemyRow[j] === "0") {
                        pawnsReached++;
                    } else {
                        if (j > 0 && enemyRow[j - 1] === "1") {
                            enemyRow =
                                enemyRow.substring(0, j - 1) +
                                "0" +
                                enemyRow.substring(j);
                            pawnsReached++;
                        } else if (j < n - 1 && enemyRow[j + 1] === "1") {
                            enemyRow =
                                enemyRow.substring(0, j + 1) +
                                "0" +
                                enemyRow.substring(j + 2);
                            pawnsReached++;
                        }
                    }
                }
            }
            results.push(pawnsReached.toString());
        }
        return results;
    }
    export default solveGregorPawnGame;
    `;

    console.log(
        "generated tests",
        (await gregor.generated_test_results).length
    );
    console.log("first check of generated took", Date.now() - midTime, "ms");
    assertEquals(
        Date.now() - midTime > 1000,
        true,
        "first check should be slow"
    );
    const midTime2 = Date.now();
    console.log(
        "generated tests",
        (await gregor.generated_test_results).length,
        Date.now()
    );
    assertEquals(
        Date.now() - midTime2 < 10,
        true,
        "second check should be fast"
    );
    console.log("second check of generated took", Date.now() - midTime2, "ms");
    console.log("generated tests passed", await gregor.generated_tests_passed);
    assertEquals(await gregor.tests_passed, true, "All tests should pass");
});
