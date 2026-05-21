'use strict';

const {
  CloudWatchClient,
  PutMetricDataCommand,
} = require('@aws-sdk/client-cloudwatch');

const DEFAULT_NAMESPACE = 'MiniJira/Tasks';
const REGION =
  process.env.AWS_REGION || process.env.DYNAMODB_REGION || 'us-east-1';

const cloudWatch = new CloudWatchClient({ region: REGION });

function normalizeDimensions(dimensions = {}) {
  if (Array.isArray(dimensions)) return dimensions;

  return Object.entries(dimensions)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([Name, value]) => ({
      Name,
      Value: String(value),
    }));
}

async function publishMetric(
  metricName,
  value,
  unit = 'Count',
  dimensions = {},
  namespace = DEFAULT_NAMESPACE
) {
  try {
    await cloudWatch.send(
      new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: unit,
            Dimensions: normalizeDimensions(dimensions),
          },
        ],
      })
    );
  } catch (err) {
    console.error(`CloudWatch metric publish failed: ${metricName}`, err);
  }
}

module.exports = {
  publishMetric,
};
