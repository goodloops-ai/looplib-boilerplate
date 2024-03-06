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
State the challenge name and index. List the various tries, the result (success, partial, fail) of each, and what changed between the versions.
Briefly list the errors you encountered and clasify their types ( e.g. syntax error, runtime error, etc. ) and what you (or should have done) to resolve them. Do not mention challenge-specific details, just general code generation strategy issues. Then provide any changes that should be made to the initial code generation prompts or any of the subsequent prompts. 
If you encountered no errors, say "No errors encountered."`,
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

const codeRegex = /```(?:javascript|js)?\n([\s\S]*?)\n```/;
const codeWithNoCommentsRegex =
    /```(?:javascript|js)?\n((?:(?!\/\/|\/\*|\*\/).)*(?:\n(?:(?!\/\/|\/\*|\*\/).)*)*)\n```/;
const codeWithCommentsRegex =
    /```(?:javascript|js)\n([\s\S]*?(?:\/\/.*|\/\*[\s\S]*?\*\/)[\s\S]*?)\n```/;

const parse$ = conditional({
    code: get(codeWithNoCommentsRegex, true),
    noCode: not(get(codeRegex)),
    codeWithComments: get(codeWithCommentsRegex, true),
});

workflow.pipe(
    challenges$,
    prompt({
        prompt: `Solve the programming challenge above following the rules and constraints as closely as possible.

Reason carefully about the problem, break it down into parts, and consider what expertise is needed to solve it, before proceeding to provide your full solution.

The code:
  - must be a standalone ECMAScript module with no dependencies.
  - should have a function as the default export. It should have no external dependencies.
  - should accept a single 'lines' argument (an array of input strings).
  - should return a single array of output strings.
  - must not contain any code comments.

IMPORTANT: The new Array constructor has been modified to disallow arrays of length > 10,000. Make sure to not scale array size with input because some of the tests you cannot see may be significantly larger than the one(s) you can see. In general avoid making unwarranted assumptions about input on the basis of the test(s) you can see.

Make sure to consider edge cases, especially for problems involving conditional logic or specific constraints. Your code, in the final stage, will be tested against tests you will not see, so please consider the whole spectrum of possible valid inputs.

Some Tips:
 - When working with BigInt, it's crucial to ensure that all operations and functions used are compatible with BigInt values. This includes avoiding standard Math functions unless explicitly converting BigInt to a number where necessary and safe.
 - The output checking is case sensitive, so make sure to get the case of any words right.
 - It is very important to match the output format and precision exactly as specified in the problem statement.

You will have 6 attempts to get the code right, and this is the first.

Enclose your code in a markdown codeblock.`,
        system: "You are a top-rated code assistant who always returns code when requested, and always pays the closest attention to instructions and other elements pointed to by the prompt. You never return partial code or refuse to return code.",
        model: "gpt-4-0125-preview",
        temperature: 0.3,
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
        prompt: "The code was not parseable. Please provide a code implementation without comments, that can be parsed as a markdown code block. It is unacceptable to not provide code, or to give placeholders. It is clear that you can do this, please make sure to return a complete solution for evaluation and make sure it is in a markdown codeblock.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.3,
    }),
    parse$
);

parse$.codeWithComments.pipe(
    // Toggle which of these two blocks are active to enable/disable comment shibboleth
    testSolution({
        timestamp,
        nonce,
    }),
    testResults$
    // maxLoops(3, report$),
    // prompt({
    //     prompt: "The code contains comments. Please provide a code implementation without comments, that can be parsed as a markdown code block. It is unacceptable to not provide code, or to give placeholders. It is clear that you can do this, please make sure to return a complete solution for evaluation and make sure it is in a markdown codeblock.",
    //     model: "gpt-4-0125-preview",
    //     concurrency: 50,
    //     temperature: 0.3,
    // }),
    // parse$
);
testResults$.pass.pipe(report$);

testResults$.fail.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "The code failed the public test(s) seen above. Review the progression so far, and brainstorm on what may help improve the code so that it satisfies all requirements. Carefully read and reflect on the failure(s) and identify what part of the code is at fault. Consider whether a minor change or a deep reconsideration of strategy is in order. Do not fix the code until I ask you to.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: "Rewrite the code and submit it again, in full, as a markdown code block. Please provide an implementation that will pass all tests, both the ones you know about, and others you may not yet have seen.  It is unacceptable to not provide code, or to give placeholders. It is clear that you can do this, please make sure to return a complete solution for evaluation.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.3,
    }),
    parse$
);

testResults$.timeout.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "The code took too long to execute and was terminated. Review the progression so far, and brainstorm on what may help improve the code so that it satisfies all requirements. Carefully read and reflect on the failure(s) and identify what part of the code is at fault. Consider whether a minor change or a deep reconsideration of strategy is in order. Do not fix the code until I ask you to.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: "Rewrite the code and submit it again, in full, as a markdown code block. Please provide an implementation that executes much more efficiently.  It is unacceptable to not provide code, or to give placeholders. It is clear that you can do this, please make sure to return a complete solution for evaluation.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.3,
    }),
    parse$
);

testResults$.error.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: "The code threw an error as seen above. Review the progression so far, and brainstorm on what may help improve the code so that it satisfies all requirements. Carefully read and reflect on the failure(s) and identify what part of the code is at fault. Consider whether a minor change or a deep reconsideration of strategy is in order. Do not fix the code until I ask you to.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: "Rewrite the code and submit it again, in full, as a markdown code block. Please provide an implementation that does not throw this or any other error.  It is unacceptable to not provide code, or to give placeholders. It is clear that you can do this, please make sure to return a complete solution for evaluation.",
        model: "gpt-4-0125-preview",
        concurrency: 50,
        temperature: 0.3,
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
