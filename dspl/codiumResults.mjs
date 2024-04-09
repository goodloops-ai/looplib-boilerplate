const report = Deno.args[0];

const raw = await Deno.readTextFile(report);

const j = JSON.parse(raw);
const challenges = JSON.parse(j.blackboard.challengesJSON);

console.log("Total Challenges", challenges.length);
console.log("Total Pass:", challenges.filter((c) => c.tests_passed).length);
console.log(
    "Public Tests Passed",
    challenges.filter((c) => c.public_tests_passed).length
);
