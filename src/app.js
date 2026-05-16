require("dotenv").config();
const express = require("express");
const usersRoutes = require("./routes/users");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Mini Jira Auth API is running" });
});

app.use("/api/users", usersRoutes);

module.exports = app;