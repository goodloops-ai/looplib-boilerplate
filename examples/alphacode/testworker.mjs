self.onmessage = async (event) => {
    const { challenge, types, src, breakOnFailure = true } = event.data;

    try {
        const module = await import(src);
        const results = {};

        for (const type of types) {
            let pass = 0;
            let fail = 0;

            for (const index in challenge[type].input) {
                try {
                    const inputStr = challenge[type].input[index];
                    const inputLines = inputStr.trim().split("\n");
                    const output = module.default(inputLines).join("\n").trim();
                    const compare = challenge[type].output[index].trim();

                    if (output == compare) {
                        pass++;
                    } else {
                        fail++;
                        if (breakOnFailure) {
                            break;
                        }
                    }
                } catch (e) {
                    fail++;
                    if (breakOnFailure) {
                        break;
                    }
                }
            }

            results[type] = { pass, fail };

            if (fail > 0) {
                if (breakOnFailure) {
                    break;
                }
            }
        }

        self.postMessage(results);
    } catch (e) {
        self.postMessage({ error: e.toString() });
    }
};
