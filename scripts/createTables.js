require('dotenv').config();

const { CreateTableCommand, DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || process.env.DYNAMODB_REGION || process.env.COGNITO_REGION
});

const tableDefinitions = [
  {
    TableName: process.env.DYNAMODB_USERS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' }
    ]
  },
  {
    TableName: process.env.DYNAMODB_TEAMS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'teamId', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'teamId', KeyType: 'HASH' }
    ]
  },
  {
    TableName: process.env.DYNAMODB_TASKS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'taskId', AttributeType: 'S' },
      { AttributeName: 'teamId', AttributeType: 'S' },
      { AttributeName: 'assigneeId', AttributeType: 'S' },
      { AttributeName: 'projectId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'taskId', KeyType: 'HASH' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'teamId-index',
        KeySchema: [
          { AttributeName: 'teamId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      },
      {
        IndexName: 'assigneeId-index',
        KeySchema: [
          { AttributeName: 'assigneeId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      },
      {
        IndexName: 'projectId-index',
        KeySchema: [
          { AttributeName: 'projectId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  },
  {
    TableName: process.env.DYNAMODB_PROJECTS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'projectId', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'projectId', KeyType: 'HASH' }
    ]
  },
  {
    TableName: process.env.DYNAMODB_COMMENTS_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'commentId', AttributeType: 'S' },
      { AttributeName: 'taskId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'commentId', KeyType: 'HASH' },
      { AttributeName: 'taskId', KeyType: 'RANGE' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'taskId-index',
        KeySchema: [
          { AttributeName: 'taskId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  },
  {
    TableName: process.env.DYNAMODB_AUDITLOG_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'logId', AttributeType: 'S' },
      { AttributeName: 'taskId', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'logId', KeyType: 'HASH' },
      { AttributeName: 'taskId', KeyType: 'RANGE' }
    ]
  }
];

async function createTable(definition) {
  try {
    await client.send(new CreateTableCommand(definition));
    console.log(`Created table: ${definition.TableName}`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`Table already exists, skipping: ${definition.TableName}`);
      return;
    }

    throw error;
  }
}

async function main() {
  for (const definition of tableDefinitions) {
    await createTable(definition);
  }
}

main().catch((error) => {
  console.error('Failed to create DynamoDB tables:', error);
  process.exit(1);
});
