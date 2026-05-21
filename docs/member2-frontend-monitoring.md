# Member 2 Monitoring IAM Note

No backend EC2 or Lambda IAM role templates are present in this repo.

When those roles are defined, add this permission to the backend EC2 role and the Lambda execution roles that publish custom metrics:

```json
{
  "Effect": "Allow",
  "Action": "cloudwatch:PutMetricData",
  "Resource": "*"
}
```
