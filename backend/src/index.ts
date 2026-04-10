import { app } from "./app.js";
import { config } from "./env.js";

app.listen(config.port, () => {
  console.log(`Agent backend listening on http://localhost:${config.port}`);
});
