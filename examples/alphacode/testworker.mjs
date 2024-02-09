self.onmessage = async (event) => {
    const { challenge, types, src } = event.data;

    try {
        const module = await import(src);

        const results = types.reduce(
            (acc, type, index) => ({
                ...acc,
                [type]: challenge[type].input.reduce(
                    (res, inputStr, index) => {
                        try {
                            const inputLines = inputStr.trim().split("\n");
                            // console.log("START TEST");
                            const output = module
                                .default(inputLines)
                                .join("\n")
                                .trim();
                            // console.log("END TEST");
                            const compare =
                                challenge[type].output[index].trim();
                            if (output == compare) {
                                return {
                                    ...res,
                                    pass: res.pass + 1,
                                };
                            } else {
                                return {
                                    ...res,
                                    fail: res.fail + 1,
                                };
                            }
                        } catch (e) {
                            return {
                                ...res,
                                fail: res.fail + 1,
                            };
                        }
                    },
                    {
                        pass: 0,
                        fail: 0,
                    }
                ),
            }),
            {}
        );
        self.postMessage(results);
    } catch (e) {
        self.postMessage({ error: e.toString() });
    }
};
