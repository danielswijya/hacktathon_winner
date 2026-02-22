# Analysis pipeline

This folder contains the **regression model** used to estimate case duration (days). The full flow is:

1. **JSON source**: Each report’s data lives in Supabase in the `parsed_documents` table as `fields` and `checkboxes` (the parsed form data).

2. **Gemini classification** (in server): The server passes that JSON (as an incident summary) to Gemini. Gemini must return exactly:
   - **city** → `court_location` (one of the allowed Massachusetts courts)
   - **court type** → `court_department` (`District Court`, `Probate and Family Court`, `The Superior Court`, `Housing Court`, `BMC`, `Land Court Department`)
   - **case type** → `case_type` (e.g. `Small Claims`, `Civil`, `Torts`, `Housing Court Summary Process`, etc.)

3. **Regression**: The server passes those three values to this folder’s `predict.py`, which loads the trained model and outputs **estimated number of days**.

## Endpoints

- **POST /api/analyze** — Body: `{ fields, checkboxes }`. Builds summary, runs Gemini + regression.
- **POST /api/documents/:id/analyze** — Loads the document from `parsed_documents` by `id`, uses its stored `fields` and `checkboxes`, then runs Gemini + regression.

## Artifacts (predict.py)

- `random_forest_case_duration_model.joblib`
- `model_scaler.joblib`
- `court_department_encoder.joblib`
- `case_type_encoder.joblib`
- `court_location_encoder.joblib`
- `feature_names.json` (optional)

Input: one JSON object on stdin with `court_department`, `case_type`, `court_location`.  
Output: one JSON object on stdout with `predicted_days`.
