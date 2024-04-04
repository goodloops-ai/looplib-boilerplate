self.onmessage = async (event) => {
    const { input, expected, src } = event.data;
    // console.log("Running test", input, expected, src);
    try {
        const module = await import(src);
        const inputLines = input.split("\n");
        const got = module.default(inputLines).join("\n");
        // console.log("got", got);
        // console.log("expected", expected);
        const gcmp = got.trim().toLowerCase();
        const pass = gcmp === expected.trim().toLowerCase();

        self.postMessage({
            status: pass ? "pass" : "fail",
            message: pass ? "Test passed" : `Expected ${expected}, got ${got}`,
            input,
            got,
            expected: expected,
        });
    } catch (e) {
        self.postMessage({
            status: "fail",
            message: e.toString(),
            stack: e.stack,
        });
    }
};
