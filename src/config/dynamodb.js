const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({
  region: process.env.DYNAMODB_REGION,
});

const docClient = DynamoDBDocumentClient.from(client);

module.exports = { docClient };