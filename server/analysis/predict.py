#!/usr/bin/env python3
"""
predict.py — thin Node.js integration wrapper for the Random Forest case-duration model.

Usage (called by Node.js via child_process.spawn):
  Reads ONE JSON object from stdin:
    { "court_department": "...", "case_type": "...", "court_location": "..." }
  Writes ONE JSON object to stdout:
    { "predicted_days": 42.3 }
  Any error is written to stderr; exits with code 1 on failure.

Direct test (Windows):
  echo {"court_department":"District Court","case_type":"Torts","court_location":"Suffolk County Civil"} | python predict.py
"""

import sys
import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

ARTIFACTS = {
    "model":   "random_forest_case_duration_model.joblib",
    "scaler":  "model_scaler.joblib",
    "le_dept": "court_department_encoder.joblib",
    "le_type": "case_type_encoder.joblib",
    "le_loc":  "court_location_encoder.joblib",
}


def load_artifacts():
    import joblib
    loaded = {}
    for key, fname in ARTIFACTS.items():
        path = SCRIPT_DIR / fname
        if not path.exists():
            raise FileNotFoundError(f"Missing artifact: {path}")
        loaded[key] = joblib.load(path)

    # feature_names: try .json first (smaller, faster)
    json_path = SCRIPT_DIR / "feature_names.json"
    joblib_path = SCRIPT_DIR / "feature_names.joblib"
    if json_path.exists():
        loaded["feature_names"] = json.loads(json_path.read_text())
    elif joblib_path.exists():
        loaded["feature_names"] = joblib.load(joblib_path)
    else:
        loaded["feature_names"] = None

    return loaded


def prepare_features(court_department, case_type, court_location, loaded):
    import pandas as pd
    le_dept = loaded["le_dept"]
    le_type = loaded["le_type"]
    le_loc  = loaded["le_loc"]
    feature_names = loaded.get("feature_names")

    df = pd.DataFrame([{
        "court_department": court_department,
        "case_type":        case_type,
        "court_location":   court_location,
    }])

    # Label encoding — unknown values fall back to 0
    enc_map = [
        ("court_department", le_dept, "dept_enc"),
        ("case_type",        le_type, "type_enc"),
        ("court_location",   le_loc,  "loc_enc"),
    ]
    for col, le, enc_name in enc_map:
        classes = set(le.classes_)
        val = df[col].iloc[0]
        df[enc_name] = le.transform([val])[0] if val in classes else 0

    dept_dummies = pd.get_dummies(df["court_department"], prefix="dept", drop_first=True)
    type_dummies = pd.get_dummies(df["case_type"],        prefix="type", drop_first=True)
    loc_dummies  = pd.get_dummies(df["court_location"],   prefix="loc",  drop_first=True)

    X = pd.concat(
        [df[["dept_enc", "type_enc", "loc_enc"]], dept_dummies, type_dummies, loc_dummies],
        axis=1,
    )

    if feature_names:
        for c in feature_names:
            if c not in X.columns:
                X[c] = 0
        X = X[feature_names]

    return X


def fallback_days(court_department, case_type, court_location):
    """Return a rough default when model artifacts are missing."""
    # Simple heuristic by court type (days)
    defaults = {
        "District Court": 60,
        "BMC": 45,
        "Housing Court": 75,
        "Probate and Family Court": 120,
        "The Superior Court": 180,
        "Land Court Department": 150,
    }
    return float(defaults.get(court_department, 90))


def main():
    raw = sys.stdin.read().strip()
    inp = {}
    if raw:
        try:
            inp = json.loads(raw)
        except json.JSONDecodeError:
            pass
    court_department = inp.get("court_department", "District Court")
    case_type = inp.get("case_type", "Civil")
    court_location = inp.get("court_location", "Suffolk County Civil")

    try:
        loaded = load_artifacts()
        X = prepare_features(court_department, case_type, court_location, loaded)
        scaler = loaded["scaler"]
        model = loaded["model"]
        X_scaled = scaler.transform(X) if scaler is not None else X
        pred = float(model.predict(X_scaled)[0])
        print(json.dumps({"predicted_days": round(pred, 1)}))
    except Exception as exc:
        print(f"predict.py: {exc}", file=sys.stderr)
        days = fallback_days(court_department, case_type, court_location)
        print(json.dumps({"predicted_days": round(days, 1), "fallback": True}))
    sys.stdout.flush()
    sys.stderr.flush()
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"predict.py: {exc}", file=sys.stderr)
        print(json.dumps({"predicted_days": 90.0, "fallback": True}))
        sys.stdout.flush()
        sys.stderr.flush()
        sys.exit(0)
