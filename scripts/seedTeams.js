require('dotenv').config();

const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const dynamo = require('../src/config/dynamo');

const TEAMS_TABLE = process.env.DYNAMODB_TEAMS_TABLE;

const DEMO_TEAMS = [
  { teamId: 'frontend-team', teamName: 'Frontend' },
  { teamId: 'backend-team', teamName: 'Backend' },
  { teamId: 'qa-team', teamName: 'QA' },
  { teamId: 'devops-team', teamName: 'DevOps' },
];

async function teamExists(teamId) {
  const result = await dynamo.send(
    new GetCommand({
      TableName: TEAMS_TABLE,
      Key: { teamId },
    })
  );

  return Boolean(result.Item);
}

async function seedTeam(team) {
  if (await teamExists(team.teamId)) {
    console.log(`Team already exists, skipping: ${team.teamId}`);
    return;
  }

  const now = new Date().toISOString();

  await dynamo.send(
    new PutCommand({
      TableName: TEAMS_TABLE,
      Item: {
        ...team,
        createdAt: now,
        updatedAt: now,
        createdBy: 'seedTeams',
      },
      ConditionExpression: 'attribute_not_exists(teamId)',
    })
  );

  console.log(`Created team: ${team.teamId} (${team.teamName})`);
}

async function main() {
  if (!TEAMS_TABLE) {
    throw new Error('DYNAMODB_TEAMS_TABLE is not configured');
  }

  for (const team of DEMO_TEAMS) {
    await seedTeam(team);
  }
}

main().catch((error) => {
  console.error('Failed to seed teams:', error);
  process.exit(1);
});
