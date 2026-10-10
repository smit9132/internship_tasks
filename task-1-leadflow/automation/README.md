# n8n new-lead workflow

LeadFlow can send each successfully saved lead to an optional n8n webhook. The exported workflow validates the event and lead fields, then retains the validated lead in n8n's successful execution history. It needs no third-party credentials. This example does not send email or write to Google Sheets.

## Import and configure

1. In n8n, choose **Workflows → Import from File** and select `lead-created-workflow.json`.
2. Open the imported workflow and save it.
3. Activate the workflow. n8n will show the production webhook URL for `POST /webhook/leadflow/new-lead`.
4. Set `N8N_WEBHOOK_URL` in LeadFlow's local `.env` to that full production URL, for example:

   ```dotenv
   N8N_WEBHOOK_URL=http://localhost:5678/webhook/leadflow/new-lead
   ```

5. Restart the LeadFlow server and create a lead. Check the n8n **Executions** view; the successful `Validate and log lead` node contains the validated lead record.

The workflow is inactive after import. For local testing, use the test webhook URL shown by n8n while **Listen for test event** is active; test URLs are temporary. For normal use, activate the workflow and use its production URL.

## Payload and failure behavior

LeadFlow sends a `lead.created` event with the saved lead document, including its MongoDB ID and timestamps. The workflow checks the event type, required fields, email format, and supported status before recording it in the execution data and acknowledging the request.

The LeadFlow API writes to MongoDB before calling n8n. If n8n returns an error, cannot be reached, or takes longer than three seconds, LeadFlow logs a credential-safe error and still returns the successful lead-creation response. The saved lead is never rolled back or discarded because of an automation failure.

The webhook workflow export is a starter example. An external integration, such as Google Sheets or email, is not configured or claimed to work until it has been added and tested with real credentials. Execution retention follows the n8n instance's configured pruning policy.
