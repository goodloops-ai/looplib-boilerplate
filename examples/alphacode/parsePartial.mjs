const file = Deno.args[0];

const json = JSON.parse(await Deno.readTextFile(file));

const passes = json
    .filter(({ node }) => node === "test")
    .map((pass) => {
        const { packets } = pass;
        const resultsPacket = packets.find(
            ({ type }) => type === "eval_results"
        );

        return {
            results: resultsPacket.data.results,
            tries: resultsPacket.data.tries,
        };
    });

console.log("PASSES", JSON.stringify(passes, null, 2));
