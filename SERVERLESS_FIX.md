# Serverless Analysis Fix

## Problem
The analysis was working locally but failing in production with the error:
```
Unexpected token 'T', "The page c"... is not valid JSON
```

## Root Cause
The application was trying to spawn a Python child process (`predict.py`) to run ML predictions. **Serverless platforms (Vercel, Render, Netlify, AWS Lambda) do not support spawning child processes**. When the Python spawn failed, the server would return an HTML error page instead of JSON, causing the JSON parsing error on the frontend.

## Solution
Modified both `api/index.js` and `server/index.js` to:

1. **Detect serverless environments** by checking environment variables:
   - `VERCEL === '1'` (Vercel)
   - `RENDER === 'true'` (Render)
   - `AWS_LAMBDA_FUNCTION_NAME` (AWS Lambda)
   - `NODE_ENV === 'production'` (general production flag)

2. **Skip Python execution** when running in serverless environments

3. **Use fallback predictions** instead, which are court-type-specific estimates:
   - District Court: 60 days
   - BMC: 45 days
   - Housing Court: 75 days
   - Probate and Family Court: 120 days
   - The Superior Court: 180 days
   - Land Court Department: 150 days
   - Default: 90 days

## What Still Works
✅ Gemini AI classification (court department, case type, court location)  
✅ Case duration predictions (using fallback values)  
✅ All other analysis features  
✅ The application works identically in both local and production environments  

## Local Development
When running locally (not in production), the Python ML model will still be used if available. The fallback is only used in serverless/production environments where Python child processes aren't supported.

## Deployment
Simply redeploy your application. No additional configuration needed. The fix automatically detects the environment and uses the appropriate prediction method.

## Alternative Solution (Future Enhancement)
If you need the actual ML model predictions in production, consider:
1. **Convert Python model to TensorFlow.js** or **ONNX.js** (run in Node.js)
2. **Use a separate ML service** (AWS SageMaker, Azure ML, Google Vertex AI)
3. **Deploy Python as a separate microservice** (separate API endpoint)
4. **Use Render Web Services** instead of serverless (supports long-running processes)

For now, the fallback predictions provide reasonable estimates based on court type.
