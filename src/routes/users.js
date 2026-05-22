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
  ListUsersCommand,
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

function getCognitoAttribute(user, name) {
  return user.Attributes?.find((attribute) => attribute.Name === name)?.Value || "";
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function normalizeLabel(value) {
  return String(value || "").trim().toLowerCase();
}

function authErrorResponse(err) {
  if (err.name === "UsernameExistsException") {
    return {
      status: 409,
      body: {
        code: err.name,
        message: "An account with this email already exists.",
      },
    };
  }

  if (err.name === "InvalidPasswordException") {
    return {
      status: 400,
      body: {
        code: err.name,
        message: "Temporary password does not meet the required security rules.",
      },
    };
  }

  if (err.name === "InvalidParameterException") {
    return {
      status: 400,
      body: {
        code: err.name,
        message: "Please check the employee information and try again.",
      },
    };
  }

  return {
    status: 502,
    body: {
      code: err.name || "COGNITO_CREATE_FAILED",
      message: "Cognito could not create the employee. Please try again.",
    },
  };
}

function getApprovalStatus(role, teamId) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "employee" && teamId) return "active";
  if (normalizedRole === "manager") return "active";
  return "pending_approval";
}

async function listAllCognitoUsers() {
  const users = [];
  let paginationToken;

  do {
    const result = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        PaginationToken: paginationToken,
      })
    );

    users.push(...(result.Users || []));
    paginationToken = result.PaginationToken;
  } while (paginationToken);

  return users;
}

async function syncCognitoUsersToDynamo() {
  const [dynamoResult, cognitoUsers] = await Promise.all([
    docClient.send(new ScanCommand({ TableName: USERS_TABLE })),
    listAllCognitoUsers(),
  ]);

  const usersById = new Map((dynamoResult.Items || []).map((user) => [user.userId, user]));
  const now = new Date().toISOString();

  for (const cognitoUser of cognitoUsers) {
    const userId = getCognitoAttribute(cognitoUser, "sub");
    if (!userId) continue;

    const existing = usersById.get(userId);
    const email = normalizeEmail(getCognitoAttribute(cognitoUser, "email") || existing?.email);
    const name = getCognitoAttribute(cognitoUser, "name") || existing?.name || email;
    const role = normalizeRole(getCognitoAttribute(cognitoUser, "custom:role") || existing?.role || "pending");
    const teamId = getCognitoAttribute(cognitoUser, "custom:teamId") || existing?.teamId || "";
    const status = getApprovalStatus(role, teamId);

    const merged = {
      ...(existing || {}),
      userId,
      email,
      name,
      role,
      teamId,
      status,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    usersById.set(userId, merged);

    await docClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: merged,
      })
    );
  }

  return [...usersById.values()];
}

// PUBLIC: Signup as a pending user. Role and team are assigned later in Cognito.
router.post("/signup", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password, name } = req.body;

    if (isMissing(email) || isMissing(password) || isMissing(name)) {
      return res.status(400).json({
        message: "email, password, and name are required",
      });
    }

    const cognitoResult = await cognitoClient.send(
      new SignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: name },
        ],
      })
    );

    const now = new Date().toISOString();
    const pendingUser = {
      userId: cognitoResult.UserSub,
      email,
      name,
      role: "pending",
      teamId: "",
      status: "pending_approval",
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: pendingUser,
        ConditionExpression: "attribute_not_exists(userId)",
      })
    );

    console.log("Signup created pending DynamoDB user", {
      userId: pendingUser.userId,
      email: pendingUser.email,
      role: pendingUser.role,
      status: pendingUser.status,
    });

    return res.status(201).json({
      message: "Account created successfully. Please confirm your account if required, then wait for manager/admin approval.",
      user: {
        userId: cognitoResult.UserSub,
        email,
        name,
      },
      userConfirmed: cognitoResult.UserConfirmed,
    });
  } catch (err) {
    return res.status(400).json({
      code: err.name,
      message: err.message,
    });
  }
});

// PROTECTED: Manager creates an employee with an assigned team for demos/admin workflow.
router.post("/employees", authenticate, isManager, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { name, teamId } = req.body;
    const temporaryPassword = req.body.temporaryPassword || req.body.password;

    if (isMissing(email) || isMissing(temporaryPassword) || isMissing(name) || isMissing(teamId)) {
      return res.status(400).json({
        message: "email, temporaryPassword, name, and teamId are required",
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

    const userRole = "employee";
    const cognitoResult = await cognitoClient.send(
      new SignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        Password: temporaryPassword,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: name },
          { Name: "custom:role", Value: userRole },
          { Name: "custom:teamId", Value: teamId },
        ],
      })
    );

    const userId = cognitoResult.UserSub;
    const user = {
      userId,
      email,
      name,
      role: userRole,
      teamId,
      status: "active",
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
      message: "Employee created successfully. They may need to confirm their email before signing in.",
      user: {
        userId,
        email,
        name,
        role: userRole,
        teamId,
        status: "active",
      },
    });
  } catch (err) {
    const response = authErrorResponse(err);
    return res.status(response.status).json(response.body);
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
      status: "active",
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
  try {
    const now = new Date().toISOString();
    const status = getApprovalStatus(req.user.role, req.user.teamId);
    const existing = await docClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: req.user.userId },
      })
    );

    if (existing.Item) {
      await docClient.send(
        new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { userId: req.user.userId },
          UpdateExpression: "SET email = :email, #name = :name, #role = :role, teamId = :teamId, #status = :status, updatedAt = :updatedAt",
          ExpressionAttributeNames: {
            "#name": "name",
            "#role": "role",
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":email": req.user.email || existing.Item.email || "",
            ":name": req.user.name || existing.Item.name || req.user.email || "",
            ":role": req.user.role,
            ":teamId": req.user.teamId || "",
            ":status": status,
            ":updatedAt": now,
          },
        })
      );
    } else {
      await docClient.send(
        new PutCommand({
          TableName: USERS_TABLE,
          Item: {
            userId: req.user.userId,
            email: req.user.email || "",
            name: req.user.name || req.user.email || "",
            role: req.user.role,
            teamId: req.user.teamId || "",
            status,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: "attribute_not_exists(userId)",
        })
      );
    }
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }

  return res.json({
    message: "Token is valid",
    user: req.user,
  });
});

// PROTECTED: Get all users - manager only
router.get("/", authenticate, isManager, async (req, res) => {
  try {
    const users = await syncCognitoUsersToDynamo();
    const pendingCount = users.filter((user) => user.status === "pending_approval").length;

    console.log("Manage Members API returning users", {
      total: users.length,
      pending: pendingCount,
      filteredOut: 0,
    });

    return res.json(users);
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

    const existingTeams = await docClient.send(
      new ScanCommand({
        TableName: TEAMS_TABLE,
      })
    );
    const normalizedTeamName = normalizeLabel(teamName);
    const duplicateTeam = (existingTeams.Items || []).find((team) =>
      normalizeLabel(team.teamName || team.name || team.teamId) === normalizedTeamName
    );

    if (duplicateTeam) {
      return res.status(409).json({
        code: "TEAM_ALREADY_EXISTS",
        message: "A team with this name already exists.",
        team: duplicateTeam,
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

    if (normalizeRole(userResult.Item.role) === "manager") {
      return res.status(400).json({
        message: "Managers are not assigned to a single team",
      });
    }

    const wasPending =
      normalizeRole(userResult.Item.role) === "pending" ||
      userResult.Item.status === "pending_approval" ||
      !userResult.Item.teamId;

    await docClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: "SET #role = :role, teamId = :teamId, #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#role": "role",
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":role": "employee",
          ":teamId": teamId,
          ":status": "active",
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
          { Name: "custom:role", Value: "employee" },
        ],
      })
    );

    console.log("Manager approved user", {
      userId,
      email,
      teamId,
      role: "employee",
      status: "active",
    });

    return res.json({
      message: wasPending
        ? "Employee approved and assigned to team. Ask them to sign out and sign in again."
        : "Employee team updated. Ask them to sign out and sign in again.",
      user: {
        userId,
        email,
        role: "employee",
        teamId,
        status: "active",
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
});

module.exports = router;
