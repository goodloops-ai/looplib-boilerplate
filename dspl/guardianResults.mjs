const reportsPath = Deno.args[0];

const reportsText = await Deno.readTextFile(reportsPath);
const reports = JSON.parse(reportsText);

const summary = reports.reduce(
    (a, r) =>
        r.results?.public_tests?.pass &&
        !r.results.private_tests?.fail &&
        !r.results.public_tests?.fail &&
        !r.results.generated_tests?.fail
            ? a + 1
            : a,
    0
);

const puplic_tests_passed = reports.filter(
    (r) => r.results?.public_tests?.pass && !r.results.public_tests?.fail
);
const violent = reports.filter((r) => !r.results?.public_tests);

console.log(
    "Finished:",
    summary,
    "passes in",
    reports.length,
    "challenges.",
    "Public Pass:",
    puplic_tests_passed.length
);

const interrupted = reports.filter((r) => !r.results.private_tests);

console.log("Interrupted:", puplic_tests_passed.length);
