self.onmessage = async (event) => {
    const { challenge, types, src, breakOnFailure = true } = event.data;

    try {
        const module = await import(src);
        const results = {};

        for (const type of types) {
            let pass = 0;
            const failures = [];

            for (const index in challenge[type].input) {
                const inputStr = challenge[type].input[index];
                const inputLines = inputStr.trim().split("\n");
                const output = module.default(inputLines).join("\n").trim();
                const compare = challenge[type].output[index].trim();

                if (output == compare) {
                    pass++;
                } else {
                    const failure = {
                        index: index,
                        input: inputStr,
                        expected: compare,
                        got: output,
                    };
                    failures.push(failure);
                    if (breakOnFailure) {
                        break;
                    }
                }
            }

            results[type] = { pass, fail: failures.length, failures };

            if (failures.length > 0 && breakOnFailure) {
                break;
            }
        }

        self.postMessage(results);
    } catch (e) {
        self.postMessage({ error: e.toString(), stack: e.stack });
    }
};
