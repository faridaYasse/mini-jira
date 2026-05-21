import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const dynamo = new DynamoDBClient({});
const sns = new SNSClient({});

const TASKS_TABLE = process.env.TASKS_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

export const handler = async () => {
  const today = new Date().toISOString().split("T")[0];
  console.log(`Running daily digest for ${today}`);

  const result = await dynamo.send(new ScanCommand({
    TableName: TASKS_TABLE,
    FilterExpression: "begins_with(deadline, :today) AND #s <> :done",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":today": { S: today },
      ":done":  { S: "Done" }
    }
  }));

  const tasks = result.Items || [];
  console.log(`Found ${tasks.length} tasks due today`);

  if (tasks.length === 0) return;

  const byAssignee = {};
  for (const task of tasks) {
    const assigneeId = task.assigneeId.S;
    if (!byAssignee[assigneeId]) {
      byAssignee[assigneeId] = { tasks: [] };
    }
    byAssignee[assigneeId].tasks.push(
      `• ${task.title.S} [Priority: ${task.priority?.S || "Normal"}]`
    );
  }

  for (const [assigneeId, data] of Object.entries(byAssignee)) {
    const message = [
      `Hello!`,
      ``,
      `You have the following tasks due TODAY (${today}):`,
      ``,
      ...data.tasks,
      ``,
      `Please log in to Mini-Jira and update your task status.`
    ].join("\n");

    await sns.send(new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Subject: `Mini-Jira Daily Digest — Tasks Due Today`,
      Message: message
    }));

    console.log(`Sent digest for assignee ${assigneeId}`);
  }
};