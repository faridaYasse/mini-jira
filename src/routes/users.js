require("dotenv").config();

const express = require("express");
const router = express.Router();

const { authenticate, isManager } = require("../middleware/auth");
const { docClient } = require("../config/dynamodb");

const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  InitiateAuthCommand,
  AdminUpdateUserAttributesCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const { v4: uuidv4 } = require("uuid");

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || process.env.AWS_REGION,
});

const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE;
const TEAMS_TABLE = process.env.DYNAMODB_TEAMS_TABLE;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// PUBLIC: Signup as employee
router.post("/signup", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password, name, teamId } = req.body;

    if (isMissing(email) || isMissing(password) || isMissing(name)) {
      return res.status(400).json({
        message: "email, password, and name are required",
      });
    }

    const userRole = "employee";
    const finalTeamId = teamId || "";

    if (finalTeamId) {
      const teamResult = await docClient.send(
        new GetCommand({
          TableName: TEAMS_TABLE,
          Key: { teamId: finalTeamId },
        })
      );

      if (!teamResult.Item) {
        return res.status(404).json({
          message: "Team not found",
        });
      }
    }

    const cognitoResult = await cognitoClient.send(
      new SignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: name },
          { Name: "custom:role", Value: userRole },
          { Name: "custom:teamId", Value: finalTeamId },
        ],
      })
    );

    const userId = cognitoResult.UserSub;

    const user = {
      userId,
      email,
      name,
      role: userRole,
      teamId: finalTeamId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
        ConditionExpression: "attribute_not_exists(userId)",
      })
    );

    return res.status(201).json({
      message: "User registered successfully. Check your email to confirm your account.",
      user: {
        userId,
        email,
        name,
        role: userRole,
        teamId: finalTeamId,
      },
    });
  } catch (err) {
    return res.status(400).json({
      message: err.message,
    });
  }
});

// DEMO ONLY: Create manager using secret key
router.post("/create-manager", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password, name, secretKey } = req.body;

    if (!ADMIN_SECRET_KEY) {
      return res.status(500).json({
        message: "ADMIN_SECRET_KEY is not configured",
      });
    }

    if (secretKey !== ADMIN_SECRET_KEY) {
      return res.status(403).json({
        message: "Invalid secret key",
      });
    }

    if (isMissing(email) || isMissing(password) || isMissing(name)) {
      return res.status(400).json({
        message: "email, password, and name are required",
      });
    }

    const userRole = "manager";

    const cognitoResult = await cognitoClient.send(
      new SignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: name },
          { Name: "custom:role", Value: userRole },
          { Name: "custom:teamId", Value: "" },
        ],
      })
    );

    const userId = cognitoResult.UserSub;

    const user = {
      userId,
      email,
      name,
      role: userRole,
      teamId: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
        ConditionExpression: "attribute_not_exists(userId)",
      })
    );

    return res.status(201).json({
      message: "Manager registered successfully. Check your email to confirm your account.",
      user: {
        userId,
        email,
        name,
        role: userRole,
        teamId: "",
      },
    });
  } catch (err) {
    return res.status(400).json({
      message: err.message,
    });
  }
});

// PUBLIC: Sign in
router.post("/signin", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (isMissing(email) || isMissing(password)) {
      return res.status(400).json({
        message: "email and password are required",
      });
    }

    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      })
    );

    return res.json({
      message: "Login successful",
      tokens: result.AuthenticationResult,
    });
  } catch (err) {
    return res.status(400).json({
      message: err.message,
    });
  }
});

// PROTECTED: Get my profile
router.get("/me", authenticate, async (req, res) => {
  return res.json({
    message: "Token is valid",
    user: req.user,
  });
});

// PROTECTED: Get all users - manager only
router.get("/", authenticate, isManager, async (req, res) => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
      })
    );

    return res.json(result.Items || []);
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
});

// PROTECTED: Create team - manager only
router.post("/teams", authenticate, isManager, async (req, res) => {
  try {
    const { teamName } = req.body;

    if (isMissing(teamName)) {
      return res.status(400).json({
        message: "teamName is required",
      });
    }

    const teamId = uuidv4();

    const team = {
      teamId,
      teamName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.userId,
    };

    await docClient.send(
      new PutCommand({
        TableName: TEAMS_TABLE,
        Item: team,
        ConditionExpression: "attribute_not_exists(teamId)",
      })
    );

    return res.status(201).json({
      message: "Team created successfully",
      team,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
});

// PROTECTED: Get all teams - manager only
router.get("/teams", authenticate, isManager, async (req, res) => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TEAMS_TABLE,
      })
    );

    return res.json(result.Items || []);
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
});

// PROTECTED: Add user to team - manager only
router.post("/teams/:teamId/members", authenticate, isManager, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId, userEmail } = req.body;

    const email = normalizeEmail(userEmail);

    if (isMissing(teamId)) {
      return res.status(400).json({
        message: "teamId is required",
      });
    }

    if (isMissing(userId) || isMissing(email)) {
      return res.status(400).json({
        message: "userId and userEmail are required",
      });
    }

    const teamResult = await docClient.send(
      new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamId },
      })
    );

    if (!teamResult.Item) {
      return res.status(404).json({
        message: "Team not found",
      });
    }

    const userResult = await docClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId },
      })
    );

    if (!userResult.Item) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (normalizeEmail(userResult.Item.email) !== email) {
      return res.status(400).json({
        message: "userEmail does not match the selected userId",
      });
    }

    if (userResult.Item.role === "manager") {
      return res.status(400).json({
        message: "Managers are not assigned to a single team",
      });
    }

    await docClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: "SET teamId = :teamId, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":teamId": teamId,
          ":updatedAt": new Date().toISOString(),
        },
      })
    );

    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: "custom:teamId", Value: teamId },
          { Name: "custom:role", Value: userResult.Item.role || "employee" },
        ],
      })
    );

    return res.json({
      message: "User team updated successfully in DynamoDB and Cognito",
      user: {
        userId,
        email,
        role: userResult.Item.role,
        teamId,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
});

module.exports = router;