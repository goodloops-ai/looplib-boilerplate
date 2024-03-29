self.onmessage = async (event) => {
    const { input, expected, src } = event.data;

    try {
        const module = await import(src);
        const inputLines = input.trim().split("\n");
        const got = module.default(inputLines).join("\n").trim();
        const pass = got === expected.trim();

        self.postMessage({ pass, input, got, expected: expected.trim() });
    } catch (e) {
        self.postMessage({ error: e.toString(), stack: e.stack });
    }
};
