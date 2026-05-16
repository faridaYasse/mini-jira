require("dotenv").config();
const express = require("express");
const router = express.Router();
const { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand } = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });

router.post("/signup", async (req, res) => {
  try {
    const { email, password, name, role, teamId } = req.body;
    if (!email || !password || !name || !role) {
      return res.status(400).json({ message: "email, password, name, and role are required" });
    }
    await cognitoClient.send(new SignUpCommand({
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "name", Value: name },
        { Name: "custom:role", Value: role },
        { Name: "custom:teamId", Value: teamId || "" },
      ],
    }));
    res.status(201).json({ message: "User registered! Check your email to confirm." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await cognitoClient.send(new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: process.env.COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));
    res.json({ message: "Login successful", tokens: result.AuthenticationResult });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
const { authenticate } = require("../middleware/auth");

router.get("/me", authenticate, async (req, res) => {
  res.json({ message: "Token is valid!", user: req.user });
});

module.exports = router;