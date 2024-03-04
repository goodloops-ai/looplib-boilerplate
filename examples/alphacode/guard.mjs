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
import {
    generateReport,
    getChallenges,
    testSolution,
    passedPublicTests,
    failedPublicTests,
    timeoutTests,
    errorTests,
} from "./codium.mjs";
import { conditional, get, not, passThrough, maxLoops } from "./std.mjs";

window.Trigger = Trigger;
window.alg = alg;

const timestamp = new Date().toISOString();
const path = Deno.args[0] || "./guardOutput";
const nonce = Math.random().toString(36).substring(7);

const report$ = new Operable(generateReport());
const challenges$ = new Operable(getChallenges());

const workflow = new Operable(passThrough);

let reflections = 0;
report$
    .pipe(
        prompt({
            prompt: `We are now done with this challenge.
State the challenge name and index.
Briefly list the errors you encountered and clasify their types ( e.g. syntax error, runtime error, etc. ) and what you (or should have done) to resolve them. Do not mention challenge-specific details, just general code generation strategy issues. Then provide any changes that should be made to the initial code generation prompts or any of the subsequent prompts. 
If you encountered no errors, simply say "No errors encountered."`,

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
  - must be a standalone ECMAScript module with no dependencies.
  - should have a function as the default export. It should have no external dependencies.
  - should accept a single 'lines' argument (an array of input strings). 
  - should return an array of output strings.
  - must not contain any code comments.
  - should use a provided function 'newArray' to create arrays instead of the built-in Array constructor.

Also:
  - the Array constructor has been modified to disallow arrays of length > 1000.

Make sure to consider edge cases, especially for problems involving conditional logic or specific constraints.

You will have 6 attempts to get the code right, and this is the first.

Enclose your code in a markdown codeblock.`,
        model: "gpt-4-0125-preview",
        temperature: 0.4,
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

parse$.code.pipe(
    testSolution({
        timestamp,
        nonce,
    }),
    testResults$
);

parse$.noCode.pipe(
    maxLoops(3, report$),
    prompt({
        prompt: "You failed to provide parseable code, or you included comments in your code. Please provide a code implementation without comments, that can be parsed and executed from a markdown code block.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.2,
    }),
    parse$
);
testResults$.pass.pipe(report$);

testResults$.fail.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "Your code failed the public test(s) seen above. Reflect on the failure(s) and identify what part of the code is at fault. Do not fix the code until I ask you to.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: "Fix the code and submit it again, in full, as a markdown code block.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.2,
    }),
    parse$
);

testResults$.timeout.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "Your code took too long to execute and was terminated. Reflect on what may have caused this and identify what part of the code is at fault. Do not fix the code until I ask you to.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: "Fix the code and submit it again, in full, as a markdown code block. Please provide an implementation that executes much more efficiently.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.2,
    }),
    parse$
);

testResults$.error.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "Your code threw an error you have discussed above. Please provide an implementation that does not throw this or any other error.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
    }),
    parse$
);

const triggers = [];
triggers.push(
    new Trigger(
        {
            run: 0,
            hidden: true,
        },
        workflow
    )
);

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
            r.results?.public_tests?.pass &&
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

// ----------------

// import { Flow } from "looplib";
// import {
//     getChallenges,
//     testSolution,
//     generateReport,
//     writeReports,
// } from "looplib/codium";

// import { parseCode } from "looplib/std";

// import { prompt, trimContext } from "looplib/gpt";

// const sessionFile = Deno.args[0] || "./session";
// const reportFile = Deno.args[1] || "./report";

// Flow(sessionFile)
//     .connect(
//         getChallenges,
//         { challengeSet: "test", subset: [5, 7, 9] },
//         "getChallenges"
//     )
//     .map(
//         Flow()
//             .connect(prompt, {
//                 prompt: `You are an expert coder at Google.

// Solve the programming challenge above following the rules as closely as possible

// Reason about the problem before proceeding to provide your full solution.

// The code:
//   - must be a standalone ECMAScript module with no dependencies.
//   - should have a function as the default export. It should have no external dependencies.
//   - should accept a single 'lines' argument (an array of input strings).
//   - should return an array of output strings.
//   - must not contain any code comments.
//   - should use a provided function 'newArray' to create arrays instead of the built-in Array constructor.

// Also:
//   - the Array constructor has been modified to disallow arrays of length > 1000.

// Make sure to consider edge cases, especially for problems involving conditional logic or specific constraints.

// You will have 6 attempts to get the code right, and this is the first.

// Enclose your code in a markdown codeblock.`,
//                 model: "gpt-4-0125-preview",
//                 temperature: 0.4,
//                 concurrency: 50,
//             })
//             .guard(
//                 [parseCode, { language: "javascript" }],
//                 Flow()
//                     .maxLoops(3, generateReport, { exit_reason: "max_parse" })
//                     .connect(prompt, {
//                         prompt: "You failed to provide parseable code, or you included comments in your code. Please provide a code implementation without comments, that can be parsed and executed from a markdown code block.",
//                         model: "gpt-4-0125-preview",
//                         concurrency: 50,
//                     })
//                     .loop("parse"),
//                 "parse"
//             )
//             .guard(
//                 [testSolution, { timeout: 60, memory: 512 }],
//                 Flow()
//                     .maxLoops(3, generateReport, { exit_reason: "max_retry" })
//                     .connect(prompt, {
//                         prompt: "Your code failed as described above. Reflect on the failure(s) and identify what part of the code is at fault. Do not fix the code until I ask you to.",
//                         model: "gpt-4-0125-preview",
//                         concurrency: 50,
//                     })
//                     .connect(prompt, {
//                         prompt: "Fix the code and submit it again, in full, as a markdown code block.",
//                         model: "gpt-4-0125-preview",
//                         concurrency: 50,
//                     })
//                     .loop("parse")
//             )
//             .connect(generateReport, { exit_reason: "complete" })
//     )
//     .connect(writeReports, { file: reportFile })
//     .connect(trimContext, { index: -1 })
//     .connect(prompt, {
//         prompt: `We are now done with all the challenges.
//         analyze the reports and provide a summary of common issues and how to address them.`,
//     })
//     .connect(trimContext, { index: -1, system: true })
//     .loop("getChallenges", { count: 5 });
