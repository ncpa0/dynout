# dynout

Dynamic output for terminal applications. - Easily update previously printed line.

## Example

```ts
import { Output } from "dynout";

Output.line("This is a static line that will never change");

const dl = Output.dline("This line can be changed later");

// ... do something
Output.line("print other things");

dl.update(current => {
  return "Second line changed!";
));

dl.close(); // prevent any more changes to this line
