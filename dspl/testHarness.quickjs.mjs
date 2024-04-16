import {
    getQuickJS,
    shouldInterruptAfterDeadline,
} from "npm:quickjs-emscripten";

export const runTest = async (code, test, timeout = 3000) => {
    const QuickJS = await getQuickJS();
    const vm = QuickJS.newContext();
    vm.runtime.setModuleLoader(() => {
        return code;
    });

    // Create a custom console object
    const consoleHandle = vm.newObject();
    const logHandle = vm.newFunction("log", (...args) => {
        const nativeArgs = args.map(vm.dump);
        console.log(...nativeArgs);
    });
    vm.setProp(consoleHandle, "log", logHandle);
    vm.setProp(vm.global, "console", consoleHandle);
    logHandle.dispose();
    consoleHandle.dispose();

    let result = null;
    try {
        const evalCode = `
      import impl from "./impl.js";
      const test = ${JSON.stringify(test)};
      const { input, output: expected } = test;
      const inputLines = input.split("\\n");
      const got = impl(inputLines).join("\\n");
      const gcmp = got.trim().toLowerCase();
      const pass = gcmp === expected.trim().toLowerCase();
      globalThis.result = JSON.stringify({
        status: pass ? "pass" : "fail",
        message: pass ? "Test passed" : \`Expected \${expected}, got \${got}\`,
        input,
        got,
        expected,
      });
    `;

        // Evaluate the code as an ESM module
        vm.runtime.setInterruptHandler(
            shouldInterruptAfterDeadline(Date.now() + timeout)
        );
        vm.runtime.setMemoryLimit(1024 * 1024 * 1024);
        vm.unwrapResult(vm.evalCode(evalCode, "eval.js")).dispose();
        result = JSON.parse(vm.getString(vm.getProp(vm.global, "result")));
    } catch (e) {
        console.error(e.stack, e.message);
        result = {
            status: "error",
            message: "An error occurred while running the test: " + e,
            error: e.message,
            stack: e.stack,
        };
    } finally {
        vm.dispose();
    }
    return result;
};

export const runTests = async (code, tests, options = {}) => {
    const results = [];
    for (const test of tests) {
        const result = await runTest(code, test, 10000);
        results.push(result);
        if (options.breakOnFailure && result.status !== "pass") {
            break;
        }
    }
    return results;
};
// const code = `
// function computePrimeFactors(maxValue) {
//     const smallestPrime = new Array(maxValue + 1).fill(0);
//     for (let i = 2; i <= maxValue; i++) {
//         if (smallestPrime[i] === 0) {
//             for (let j = i; j <= maxValue; j += i) {
//                 if (smallestPrime[j] === 0) {
//                     smallestPrime[j] = i;
//                 }
//             }
//         }
//     }
//     return smallestPrime;
// }

// // Function to get all prime factors of a number using precomputed smallest primes
// function getPrimeFactors(x, smallestPrime) {
//     const factors = new Set();
//     while (x > 1) {
//         factors.add(smallestPrime[x]);
//         x = Math.floor(x / smallestPrime[x]);
//     }
//     return factors;
// }

// // Main function to solve the problem
// function solve(lines) {
//     const [n, q] = lines[0].split(' ').map(Number);
//     const values = lines[1].split(' ').map(Number);
//     const queries = lines.slice(2, 2 + q).map(line => line.split(' ').map(x => Number(x) - 1));

//     const maxValue = Math.max(...values);
//     const smallestPrime = computePrimeFactors(maxValue);

//     // Map each prime to the nodes (values) it connects
//     const primeToNodes = new Map();
//     const nodeToPrimes = new Map();

//     values.forEach((value, index) => {
//         const primes = getPrimeFactors(value, smallestPrime);
//         nodeToPrimes.set(index, primes);
//         primes.forEach(prime => {
//             if (!primeToNodes.has(prime)) {
//                 primeToNodes.set(prime, new Set());
//             }
//             primeToNodes.get(prime).add(index);
//         });
//     });

//     // Create graph based on prime factor connectivity
//     const graph = Array.from({ length: n }, () => new Set());

//     primeToNodes.forEach(nodes => {
//         const nodeList = Array.from(nodes);
//         for (let i = 0; i < nodeList.length; i++) {
//             for (let j = i + 1; j < nodeList.length; j++) {
//                 graph[nodeList[i]].add(nodeList[j]);
//                 graph[nodeList[j]].add(nodeList[i]);
//             }
//         }
//     });

//     // Function to perform BFS and find the shortest path between two nodes
//     function bfs(start, end) {
//         const queue = [start];
//         const visited = new Array(n).fill(false);
//         const distance = new Array(n).fill(Infinity);
//         visited[start] = true;
//         distance[start] = 0;

//         let head = 0;
//         while (head < queue.length) {
//             const current = queue[head++];
//             if (current === end) {
//                 return distance[current];
//             }
//             graph[current].forEach(neighbor => {
//                 if (!visited[neighbor]) {
//                     visited[neighbor] = true;
//                     distance[neighbor] = distance[current] + 1;
//                     queue.push(neighbor);
//                 }
//             });
//         }
//         return Infinity; // If no path found
//     }

//     // Process each query and determine the minimum number of new nodes needed
//     const results = queries.map(([start, end]) => {
//         const minSteps = bfs(start, end);
//         return minSteps === Infinity ? '1' : '0'; // If no path, assume one new node is needed
//     });

//     return results;
// }

// export default solve;`;
// const tests = [
//     { input: "3 3\n2 10 3\n1 2\n1 3\n2 3\n", output: "0\n1\n1\n" },
//     {
//         input: "5 12\n3 8 7 6 25\n1 2\n1 3\n1 4\n1 5\n2 1\n2 3\n2 4\n2 5\n3 1\n3 2\n3 4\n3 5\n",
//         output: "0\n1\n0\n1\n0\n1\n0\n1\n1\n1\n1\n2\n",
//     },
// ];

// console.log(await runTests(code, tests, { breakOnFailure: true }));
