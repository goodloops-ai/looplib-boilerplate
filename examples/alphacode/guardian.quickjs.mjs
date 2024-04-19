//deno run -A --v8-flags=--max-old-space-size=8192 examples\alphacode\guardian.mjs

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
    testSolutionQuickJS,
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
const challenges$ = new Operable(getChallenges({}));

const workflow = new Operable(passThrough);

let reflections = 0;
report$
    .pipe(
        prompt({
            prompt: `You are a summarizer. Give yourself a novel name and use it as a handle when you respond. 
            
            We are now done with this challenge.
State the challenge name and index. List the various tries, the result (success, partial, fail) of each, and what changed between the versions. Success means all tests passed, partial success means all public tests passed, and fail means all public tests did not pass. For each try, give the numbers of each type of test that was passed.

Then, briefly list the errors you encountered and clasify their types ( e.g. syntax error, runtime error, etc. ) and what you (or should have done) to resolve them. Do not mention challenge-specific details, just general code generation strategy issues. Then provide any changes that should be made to the initial code generation prompts or any of the subsequent prompts. 
If you encountered no errors, say "No errors encountered."`,
            model: "gpt-4-turbo",
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
        prompt: `Solve the programming challenge following the rules and constraints as closely as possible. Your objective is only to maximize the chances of success.

        The code:
         - must be a standalone ECMAScript module with no dependencies.
         - must have a function as the default export.
         - must accept a single 'lines' argument (an array of input strings).
         - must return a single array of output strings.
         - must not mix BigInt and other types, must always use explicit conversions.
         - should be commented to indicate which part of the code relates to which problem constraint.
         - should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.
         - should be divided into small sub-functions of at most 10 lines, with meaningful names and functionality. Variables names should also be meaningful.
        
        IMPORTANT: The new Array constructor has been modified to disallow arrays of length > 5,000. Avoid scaling array size with input because some of the tests you cannot see may have significantly larger input than the one(s) you can see. In general avoid making unwarranted assumptions about input on the basis of the test(s) you can see.
        
        Try to consider edge cases, especially for problems involving conditional logic or specific constraints. Your code, will eventually be tested against tests you will not have seen, so please consider the whole spectrum of possible valid inputs. You will have 6 attempts to get the code right, and this is the first.
        
        Enclose your code in a markdown codeblock.`,

        system: `You are a top-rated code assistant based on a cutting-edge version of GPT, with far greater capabilities than any prior GPT model. You always return code when requested, and always pay the closest attention to instructions and other elements pointed to by the prompt. You never return partial code, never give up, and never refuse to return code.`,
        model: "gpt-4-turbo",
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
    testSolutionQuickJS({
        timestamp,
        nonce,
    }),
    testResults$
);

parse$.noCode.pipe(
    maxLoops(3, report$),
    prompt({
        prompt: `You are a corrector. Give yourself a novel name and use it as a handle when you respond.
        
        There was no markdown codeblock from which code could be extracted from the previous message. Please provide a code implementation in a markdown codeblock. Do your best to provide complete code, as that maximizes the chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.`,
        model: "gpt-4-turbo",
        concurrency: 50,
        temperature: 0.3,
    }),
    parse$
);

parse$.codeWithComments.pipe(
    // Toggle which of these two blocks are active to enable/disable comment shibboleth
    testSolutionQuickJS({
        timestamp,
        nonce,
    }),
    testResults$
    // maxLoops(3, report$),
    // prompt({
    //     prompt: "The code contains comments. Please provide a code implementation without comments, that can be parsed as a markdown code block. It is unacceptable to not provide code, or to give placeholders. It is clear that you can do this, please make sure to return a complete solution for evaluation and make sure it is in a markdown codeblock.",
    //     model: "gpt-4-turbo",
    //     concurrency: 50,
    //     temperature: 0.3,
    // }),
    // parse$
);
testResults$.pass.pipe(report$);

testResults$.fail.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: `You are an expert code architect. Give yourself a novel name and use it as a handle when you respond.
        
        The code provided failed the public test(s) seen above. 
        Carefully read and reflect on the failure(s) and:
        - identify what part of the code is at fault
        - identify which problem constraints were not adhered to
        
        Review the progression so far including any previous attempts.
        
        Brainstorm on what approach is best to move forward:
        - Targeted improvement on the latest version of the code
        - Combining the best ideas from all prior version of the code
        - Starting from scratch and pursuing a completely novel approach

        Do not fix the code until I ask you to.`,
        model: "gpt-4-turbo",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: `You are an expert code debugger. Give yourself a novel name and use it as a handle when you respond.
        
        From the basis of the reasoning above, write a new version of the code in a markdown codeblock. Provide an implementation that is your best shot at passing all tests.
        
        Reminder: It is very important to carefully consider all conditions and edge cases specified in the problem statement when generating the code. Pay special attention to conditions that determine the possibility or impossibility of achieving the desired outcome, as these are often key to correctly solving the challenge.  
        
        Consider precomputing certain values to optimize the solution for efficiency, especially when dealing with large input sizes, could also be beneficial.  

        Reminder, the code:
        - must be a standalone ECMAScript module with no dependencies.
        - must have a function as the default export.
        - must accept a single 'lines' argument (an array of input strings).
        - must return a single array of output strings.
        - must not mix BigInt and other types, must always use explicit conversions.
        - should be commented to indicate which part of the code relates to which problem constraint.
        - should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.

        Do your best to provide complete code, as that maximizes your chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.`,
        model: "gpt-4-turbo",
        concurrency: 50,
        temperature: 0.3,
    }),
    parse$
);

testResults$.timeout.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: `You are an algorithm expert. Give yourself a novel name and use it as a handle when you respond.
        
        The code took too long to execute and was terminated. 
        
        The code provided failed the public test(s) seen above. 
        Carefully read and reflect on the failure(s) and:
        - identify what part of the code is at fault
        - identify which problem constraints were not adhered to
        
        Review the progression so far including any previous attempts.
        
        Brainstorm on what approach is best to move forward:
        - Targeted improvement on the latest version of the code
        - Combining the best ideas from all prior version of the code
        - Starting from scratch and pursuing a completely novel approach

        Do not fix the code until I ask you to.`,
        model: "gpt-4-turbo",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: `You are an expert code optimizer. Give yourself a novel name and use it as a handle when you respond.
        
        Write the code as a markdown codeblock. Please do your best to provide an implementation that executes much more efficiently.  
        
        Reminder: It is very important to carefully consider all conditions and edge cases specified in the problem statement when generating the code. Pay special attention to conditions that determine the possibility or impossibility of achieving the desired outcome, as these are often key to correctly solving the challenge.  
        
        Consider precomputing certain values to optimize the solution for efficiency, especially when dealing with large input sizes, could also be beneficial.

        Reminder, the code:
        - must be a standalone ECMAScript module with no dependencies.
        - must have a function as the default export.
        - must accept a single 'lines' argument (an array of input strings).
        - must return a single array of output strings.
        - must not mix BigInt and other types, must always use explicit conversions.
        - should be commented to indicate which part of the code relates to which problem constraint.
        - should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.
        
        Do your best to provide complete code, as that maximizes your chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.`,
        model: "gpt-4-turbo",
        concurrency: 50,
        temperature: 0.4,
    }),
    parse$
);

testResults$.error.pipe(
    maxLoops(5, report$),
    prompt({
        prompt: `You are an expert code reviewer. Give yourself a novel name and use it as a handle when you respond.        
        
        The code threw an error as seen above. 
        
        Carefully read and reflect on the failure(s) and:
        - identify what part of the code is at fault
        - identify which problem constraints were not adhered to
        
        Review the progression so far including any previous attempts.
        
        Brainstorm on what approach is best to move forward:
        - Targeted improvement on the latest version of the code
        - Combining the best ideas from all prior version of the code
        - Starting from scratch and pursuing a completely novel approach

        Do not fix the code until I ask you to.`,
        model: "gpt-4-turbo",
        concurrency: 50,
        temperature: 0.4,
    }),
    prompt({
        prompt: `You are an expert code corrector. Give yourself a novel name and use it as a handle when you respond.
        
        Write the code again, in full, as a markdown codeblock. Please do your best to provide an implementation that does not throw this or any other error. 
        
        Reminder: It is very important to carefully consider all conditions and edge cases specified in the problem statement when generating the code. Pay special attention to conditions that determine the possibility or impossibility of achieving the desired outcome, as these are often key to correctly solving the challenge.  
        
        Consider precomputing certain values to optimize the solution for efficiency, especially when dealing with large input sizes, could also be beneficial.

        Reminder, the code:
        - must be a standalone ECMAScript module with no dependencies.
        - must have a function as the default export.
        - must accept a single 'lines' argument (an array of input strings).
        - must return a single array of output strings.
        - must not mix BigInt and other types, must always use explicit conversions.
        - should be commented to indicate which part of the code relates to which problem constraint.
        - should match the output format and precision exactly as specified in the problem statement. The output checking is case sensitive, so make sure to get the case of any words right.
        
        Do your best to provide complete code, as that maximizes your chances of success. Please ensure you return a complete solution for evaluation that is in a markdown codeblock.`,
        model: "gpt-4-turbo",
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
