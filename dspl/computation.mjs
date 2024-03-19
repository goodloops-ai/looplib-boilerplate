import { map } from "rxjs/operators";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";

// Define the schema for the configuration of the operator
const computationSchema = z.object({
  fn: z.function().args(z.object({})).returns(z.object({})),
});

// Implement the operator
function computationOperator({ fn }) {
  return map(({ input, messages, env }) => {
    const output = fn(input);
    return { output, messages, env };
  });
}

// Define the schema for the operator
const schema = base.extend({
  config: computationSchema,
  input: z.object({}).optional(),
  output: z.object({}).optional(),
}).describe("A simple building block of a computation given a provided function");

// Export the operator and schema
export const operator = computationOperator;
export default wrap({ operator: computationOperator, schema });