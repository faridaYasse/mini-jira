import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { v4 as uuidv4 } from "uuid";

const region = process.env.AWS_REGION || process.env.DYNAMODB_REGION || "us-east-1";
const dynamo = new DynamoDBClient({ region });
const cw = new CloudWatchClient({ region });
const AUDITLOG_TABLE = process.env.AUDITLOG_TABLE;

async function publishAssignmentMetric(metricName, teamId) {
  try {
    await cw.send(new PutMetricDataCommand({
      Namespace: "MiniJira/Assignments",
      MetricData: [{
        MetricName: metricName,
        Dimensions: teamId ? [{ Name: "TeamId", Value: teamId }] : [],
        Value: 1,
        Unit: "Count"
      }]
    }));
  } catch (err) {
    console.error(`CloudWatch metric publish failed: ${metricName}`, err);
  }
}

export const handler = async (event) => {
  let hasFailure = false;

  for (const record of event.Records) {
    let teamId;

    try {
      const snsMessage = JSON.parse(record.body);
      const payload = JSON.parse(snsMessage.Message);

      const { taskId, assigneeId, title } = payload;
      teamId = payload.teamId;

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

      try {
        await cw.send(new PutMetricDataCommand({
          Namespace: "MiniJira",
          MetricData: [{
            MetricName: "TasksAssignedPerTeam",
            Dimensions: [{ Name: "TeamId", Value: teamId }],
            Value: 1,
            Unit: "Count"
          }]
        }));
      } catch (err) {
        console.error("CloudWatch metric publish failed: TasksAssignedPerTeam", err);
      }

      await Promise.all([
        publishAssignmentMetric("AssignmentWorkerProcessed", teamId),
        publishAssignmentMetric("NotificationsPublished", teamId),
      ]);

      console.log(`Done: logged to AuditLog and published CloudWatch metric`);
    } catch (err) {
      hasFailure = true;
      console.error("Assignment worker record failed", err);
      await publishAssignmentMetric("AssignmentWorkerFailures", teamId);
    }
  }

  if (hasFailure) {
    throw new Error("One or more assignment worker records failed");
  }
};
