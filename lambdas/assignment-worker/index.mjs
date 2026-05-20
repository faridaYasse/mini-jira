import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { v4 as uuidv4 } from "uuid";

const dynamo = new DynamoDBClient({});
const cw = new CloudWatchClient({});
const AUDITLOG_TABLE = process.env.AUDITLOG_TABLE;

export const handler = async (event) => {
  for (const record of event.Records) {
    const snsMessage = JSON.parse(record.body);
    const payload = JSON.parse(snsMessage.Message);

    const { taskId, assigneeId, teamId, title } = payload;

    console.log(`Processing: task=${taskId} assignee=${assigneeId} team=${teamId}`);

    await dynamo.send(new PutItemCommand({
      TableName: AUDITLOG_TABLE,
      Item: {
        logId:      { S: uuidv4() },
        taskId:     { S: taskId },
        changedBy:  { S: "system-assignment" },
        fromStatus: { S: "" },
        toStatus:   { S: "assigned" },
        createdAt:  { S: new Date().toISOString() },
        assigneeId: { S: assigneeId },
        teamId:     { S: teamId },
        title:      { S: title },
      }
    }));

    await cw.send(new PutMetricDataCommand({
      Namespace: "MiniJira",
      MetricData: [{
        MetricName: "TasksAssignedPerTeam",
        Dimensions: [{ Name: "TeamId", Value: teamId }],
        Value: 1,
        Unit: "Count"
      }]
    }));

    console.log(`Done: logged to AuditLog and published CloudWatch metric`);
  }
};