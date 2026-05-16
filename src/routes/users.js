require("dotenv").config();
const express = require("express");
const router = express.Router();
const { authenticate, isManager } = require("../middleware/auth");
const { docClient } = require("../config/dynamodb");
const { PutCommand, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { v4: uuidv4 } = require("uuid");

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });

// ✅ PUBLIC: Signup
router.post("/signup", async (req, res) => {
  try {
    const { email, password, name, teamId } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: "email, password, and name are required" });
    }
    const userRole = "employee";
    const cognitoResult = await cognitoClient.send(new SignUpCommand({
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "name", Value: name },
        { Name: "custom:role", Value: userRole },
        { Name: "custom:teamId", Value: teamId || "" },
      ],
    }));
    const userId = cognitoResult.UserSub;
    await docClient.send(new PutCommand({
      TableName: process.env.DYNAMODB_USERS_TABLE,
      Item: { userId, email, name, role: userRole, teamId: teamId || "", createdAt: new Date().toISOString() }
    }));
    res.status(201).json({ message: "User registered! Check your email to confirm." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ✅ PUBLIC: Signin
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

// ✅ PROTECTED: Get my profile
router.get("/me", authenticate, async (req, res) => {
  res.json({ message: "Token is valid!", user: req.user });
});

// ✅ PROTECTED: Get all users (manager only)
router.get("/", authenticate, isManager, async (req, res) => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: process.env.DYNAMODB_USERS_TABLE }));
    res.json(result.Items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ PROTECTED: Create team (manager only)
router.post("/teams", authenticate, isManager, async (req, res) => {
  try {
    const { teamName } = req.body;
    if (!teamName) return res.status(400).json({ message: "teamName is required" });
    const teamId = uuidv4();
    const team = { teamId, teamName, createdAt: new Date().toISOString(), createdBy: req.user.userId };
    await docClient.send(new PutCommand({ TableName: process.env.DYNAMODB_TEAMS_TABLE, Item: team }));
    res.status(201).json({ message: "Team created", team });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ PROTECTED: Get all teams (manager only)
router.get("/teams", authenticate, isManager, async (req, res) => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: process.env.DYNAMODB_TEAMS_TABLE }));
    res.json(result.Items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ PROTECTED: Add user to team (manager only)
router.post("/teams/:teamId/members", authenticate, isManager, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required" });
    await docClient.send(new UpdateCommand({
      TableName: process.env.DYNAMODB_USERS_TABLE,
      Key: { userId },
      UpdateExpression: "SET teamId = :teamId, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":teamId": teamId,
        ":updatedAt": new Date().toISOString(),
      },
    }));
    res.json({ message: "User team updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;