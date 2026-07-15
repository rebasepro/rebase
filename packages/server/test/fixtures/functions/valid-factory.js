const { Hono } = require("hono");
module.exports = () => {
    const app = new Hono();
    app.post("/hello", (c) => c.text("hello from valid-factory"));
    return app;
};
