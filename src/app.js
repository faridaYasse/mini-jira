require("dotenv").config();
const express = require("express");
const { authenticate } = require("./middleware/auth");
const usersRoutes = require("./routes/users");

const app = express();
app.use(express.json());

// Public routes
app.get("/", (req, res) => { res.json({ message: "Mini Jira Auth API is running" }); });
app.post("/api/users/signup", usersRoutes);
app.post("/api/users/signin", usersRoutes);

// Protected routes
app.use("/api/users", authenticate, usersRoutes);

module.exports = app;