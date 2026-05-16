const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || process.env.DYNAMODB_REGION || process.env.COGNITO_REGION
});

const dynamo = DynamoDBDocumentClient.from(client);

module.exports = dynamo;
