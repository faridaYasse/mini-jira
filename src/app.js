const express = require("express");
const app = express();
app.use(express.json());
app.get("/", (req, res) => { res.json({ message: "running" }); });
const users = require("./routes/users");
app.use("/api/users", users);
module.exports = app;