const { Hono } = require("hono");
const app = new Hono();
app.get("/hello", (c) => c.text("hello from valid-app"));
module.exports = app;
