import { tableFromIPC } from "https://esm.sh/apache-arrow";
import {
    operableCombine,
    Operable,
    operableFrom,
    Trigger,
    prompt,
} from "looplib";
import { take, pipe, map, debounceTime, takeUntil, tap } from "rxjs";
import { basename } from "https://deno.land/std@0.219.0/path/mod.ts";
import { Graph, alg } from "@dagrejs/graphlib";
import z from "zod";
import filenamify from "filenamify";
import {
    generateReport,
    getChallenges,
    testSolution1,
    passedPublicTests,
    failedPublicTests,
    timeoutTests,
    errorTests,
} from "./codium.mjs";
import {
    conditional,
    get,
    not,
    passThrough,
    maxLoops,
    retryTo,
    guard,
} from "./std.mjs";
import YAML from "https://esm.sh/yaml";

window.Trigger = Trigger;
window.alg = alg;

const timestamp = new Date().toISOString();
const path = Deno.args[0] || basename(import.meta.url).split(".")[0];
const nonce = Math.random().toString(36).substring(7);

const report$ = new Operable(generateReport());
const challenges$ = new Operable(getChallenges({}));

const workflow = new Operable(passThrough);

const reportPrompt$ = prompt({
    prompt: `We are now done with this challenge.
State the challenge name and index. List the various tries, the result (success, partial, fail) of each, and what changed between the versions. Success means all tests passed, partial success means all public tests passed, and fail means all public tests did not pass. For each try, give the numbers of each type of test that was passed.

Then, briefly list the errors you encountered and clasify their types ( e.g. syntax error, runtime error, etc. ) and what you (or should have done) to resolve them. Do not mention challenge-specific details, just general code generation strategy issues. Then provide any changes that should be made to the initial code generation prompts or any of the subsequent prompts. 
If you encountered no errors, say "No errors encountered."`,
    model: "gpt-3.5-turbo",
});

let reflections = 0;
report$.pipe(reportPrompt$).$.subscribe((trigger) => {
    console.log("REPORT", trigger.payload);
    const reflectPath = filenamify(
        `${path}.reflect.${timestamp}.${nonce}.${++reflections}.md`
    );

    const lastPayload = trigger.findOne(
        z.object({ type: z.literal("partial") }).passthrough()
    );

    console.log("last");

    const lastMessage =
        lastPayload.messages[lastPayload.messages.length - 1].content;

    Deno.writeTextFile(reflectPath, lastMessage);
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

const solveConfig = {
    prompt: `Solve the programming challenge above following the rules and constraints as closely as possible.

The code:
 - must be a standalone ECMAScript module with no dependencies
 - must have a function as the default export
 - must accept a single 'lines' argument (an array of input strings)
 - must return a single array of output strings
 - must not mix BigInt and other types, must always use explicit conversions
 - must match the output format and precision exactly as specified in the problem statement

IMPORTANT: The new Array constructor has been modified to disallow arrays of length > 10,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general avoid making unwarranted assumptions about input on the basis of the test(s) you can see.

Try to consider edge cases, especially for problems involving conditional logic or specific constraints. Your code, will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.

Some Tips:
 - When working with BigInt, it's crucial to ensure that all operations and functions used are compatible with BigInt values. This includes avoiding standard Math functions unless explicitly converting BigInt to a number where necessary and safe.
 - The output checking is case sensitive, so make sure to get the case of any words right.

Coding style to minimize errors:
 - avoid use of "const" and prefer "let"
 - avoid use of template literals
 - avoid arrow functions
 - avoid spread syntax for object/array cloning

Reminder, the code:
 - must be a standalone ECMAScript module with no dependencies
 - must have a function as the default export
 - must accept a single 'lines' argument (an array of input strings)
 - must return a single array of output strings
 - must not mix BigInt and other types, must always use explicit conversions
 - must match the output format and precision exactly as specified in the problem statement

Enclose your code in a markdown codeblock.`,
    system: "You are a top-rated code assistant who always returns code when requested, and always pays the closest attention to instructions and other elements pointed to by the prompt. You never return partial code or refuse to return code.",
    model: "gpt-3.5-turbo",
    temperature: 0.3,
    maxRetries: 1,
    timeout: 10000,
    concurrency: 50,
};

const solveMulti$ = prompt({
    ...solveConfig,
    n: 5,
    branch: false,
});

const solveSingle$ = prompt({
    ...solveConfig,
});

function reportError(report$) {
    return guard((trigger) => {
        console.log("GOT ERROR?", trigger.payload.error);
        return !trigger.payload.error;
    }, report$);
}

const solveSingle2$ = workflow.pipe(
    challenges$,
    solveSingle$,
    reportError(report$)
);
solveSingle2$.pipe(parse$);

solveMulti$.pipe(
    prompt({
        prompt: `Carefully review the solutions provided. 
Can you identify where the various versions disagree in terms of implementation?`,
        temperature: 0.3,
        model: "gpt-3.5-turbo",
        concurrency: 50,
    }),
    reportError(report$),
    prompt({
        prompt: `For each area of disagreement, decide the best approach and write an updated specification indicating the right way to go. Write it as a straight specification with no code included.`,
        temperature: 0.3,
        model: "gpt-3.5-turbo",
    }),
    reportError(report$),
    (trigger) => {
        const addendum = trigger.payload.messages[1].content;
        const challenge = trigger.findOne(
            z.object({ type: z.literal("challenge") }).passthrough()
        );
        const oldPartial = trigger
            .find(z.object({ type: z.literal("partial") }).passthrough())
            .find(({ messages }) =>
                messages.some(({ role, content }) =>
                    content.includes("Additional Instructions:")
                )
            );

        const newAddendum = `Additional Instructions:\n${
            oldPartial ? oldPartial.messages[1].content : ""
        }\n${addendum}`;

        return {
            type: "blind",
            messages: [
                {
                    role: "user",
                    content: YAML.stringify(challenge, null, 2),
                },
                {
                    role: "user",
                    content: newAddendum,
                },
            ],
        };
    },
    maxLoops(3, solveSingle$),
    solveMulti$
);

const testResults$ = conditional({
    pass: passedPublicTests,
    fail: failedPublicTests,
    timeout: timeoutTests,
    error: errorTests,
});

const testSolution$ = operableFrom(
    testSolution1({
        timestamp,
        nonce,
        concurrency: 1,
    })
);

parse$.code.pipe(testSolution$, testResults$);
parse$.codeWithComments.pipe(testSolution$); // already connected to testResults$ via parse$.code

const noCodePrompt$ = prompt({
    prompt: "The code was not parseable. Please provide a code implementation that can be parsed as a markdown code block. Do your best to provide complete code, as that maximizes your chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.",
    model: "gpt-3.5-turbo",
    concurrency: 50,
    temperature: 0.3,
});

parse$.noCode.pipe(
    maxLoops(3, report$),
    noCodePrompt$,
    reportError(report$),
    parse$
);

testResults$.pass.pipe(report$);

const failedPromptAnalyze$ = prompt({
    prompt: "The code failed the public test(s) seen above. Review the progression so far, and brainstorm on what may help improve the code so that it satisfies all requirements. Carefully read and reflect on the failure(s) and identify what part of the code is at fault. Consider whether a minor change or a deep reconsideration of strategy is in order. Do not fix the code until I ask you to.",
    model: "gpt-3.5-turbo",
    concurrency: 50,
    temperature: 0.4,
});
const failedPromptRewrite$ = prompt({
    prompt: `Rewrite the code and submit it again, in full, as a markdown code block. Please provide an implementation that is your best shot at passing all tests, both the ones you know about, and others you may not yet have seen.
        
        Reminder: It is very important to carefully consider all conditions and edge cases specified in the problem statement when generating the code. Pay special attention to conditions that determine the possibility or impossibility of achieving the desired outcome, as these are often key to correctly solving the challenge.  
        
        Consider precomputing certain values to optimize the solution for efficiency, especially when dealing with large input sizes, could also be beneficial.  
        
        Do your best to provide complete code, as that maximizes your chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.`,
    model: "gpt-3.5-turbo",
    concurrency: 50,
    temperature: 0.3,
});

testResults$.fail.pipe(
    maxLoops(5, report$),
    failedPromptAnalyze$,
    reportError(report$),
    failedPromptRewrite$,
    reportError(report$),
    parse$
);

const timeoutPromptAnalyze$ = prompt({
    prompt: "The code took too long to execute and was terminated. Review the progression so far, and brainstorm on what may help improve the code so that it satisfies all requirements. Carefully read and reflect on the failure(s) and identify what part of the code is at fault. Consider whether a minor change or a deep reconsideration of strategy is in order. Do not fix the code until I ask you to.",
    model: "gpt-3.5-turbo",
    concurrency: 50,
    temperature: 0.4,
});
const timeoutPromptRewrite$ = prompt({
    prompt: `Rewrite the code and submit it again, in full, as a markdown code block. Please do your best to provide an implementation that executes much more efficiently.  
        
        Reminder: It is very important to carefully consider all conditions and edge cases specified in the problem statement when generating the code. Pay special attention to conditions that determine the possibility or impossibility of achieving the desired outcome, as these are often key to correctly solving the challenge.  
        
        Consider precomputing certain values to optimize the solution for efficiency, especially when dealing with large input sizes, could also be beneficial.  
        
        Do your best to provide complete code, as that maximizes your chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.`,
    model: "gpt-3.5-turbo",
    concurrency: 50,
    temperature: 0.4,
});

testResults$.timeout.pipe(
    maxLoops(5, report$),
    timeoutPromptAnalyze$,
    reportError(report$),
    timeoutPromptRewrite$,
    reportError(report$),
    parse$
);

const errorPromptAnalyze$ = prompt({
    prompt: "The code threw an error as seen above. Review the progression so far, and brainstorm on what may help improve the code so that it satisfies all requirements. Carefully read and reflect on the failure(s) and identify what part of the code is at fault. Consider whether a minor change or a deep reconsideration of strategy is in order. Do not fix the code until I ask you to.",
    model: "gpt-3.5-turbo",
    concurrency: 50,
    temperature: 0.4,
});

const errorPromptRewrite$ = prompt({
    prompt: `Rewrite the code and submit it again, in full, as a markdown code block. Please do your best to provide an implementation that does not throw this or any other error. 
    
    Reminder: It is very important to carefully consider all conditions and edge cases specified in the problem statement when generating the code. Pay special attention to conditions that determine the possibility or impossibility of achieving the desired outcome, as these are often key to correctly solving the challenge.  
    
    Consider precomputing certain values to optimize the solution for efficiency, especially when dealing with large input sizes, could also be beneficial.  
    
    Do your best to provide complete code, as that maximizes your chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.`,
    model: "gpt-3.5-turbo",
    concurrency: 50,
    temperature: 0.3,
});

testResults$.error.pipe(
    maxLoops(5, report$),
    errorPromptAnalyze$,
    reportError(report$),
    errorPromptRewrite$,
    reportError(report$),
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
