import { env } from "./env.js";
import { createApp } from "./app.js";

createApp().listen(env.PORT, () => {
  console.log(`api :${env.PORT}`);
});
