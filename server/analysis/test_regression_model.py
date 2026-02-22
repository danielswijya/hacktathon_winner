#!/usr/bin/env python3
"""
Test script for a trained regression model (.joblib) that predicts time_taken
from court_department, case_type, and court_location.

Usage:
  # Check that all artifacts load
  python test_regression_model.py check

  # Evaluate on a CSV (same columns as training + optional time_taken for metrics)
  python test_regression_model.py eval test_data.csv

  # Single prediction
  python test_regression_model.py predict --dept "District Court" --type "Small Claims" --loc "Cambridge District Court"

  # Run a sensible demo prediction (no args needed)
  python test_regression_model.py demo

Expects in this folder (or --dir):
  - model.joblib                      (fitted RandomForestRegressor)
  - scaler.joblib                     (fitted StandardScaler)
  - court_department_encoder.joblib   (LabelEncoder)
  - case_type_encoder.joblib
  - court_location_encoder.joblib
  - feature_names.joblib              (optional; list of X.columns for alignment)

Save from training (after fitting) e.g.:
  joblib.dump(best_fitted_model, 'model.joblib')
  joblib.dump(best_scaler, 'scaler.joblib')
  joblib.dump(best_le_dept, 'court_department_encoder.joblib')
  joblib.dump(best_le_type, 'case_type_encoder.joblib')
  joblib.dump(best_le_loc, 'court_location_encoder.joblib')
  joblib.dump(best_feature_names, 'feature_names.joblib')
"""

import json
import os
import argparse
import numpy as np
import pandas as pd
import joblib
from pathlib import Path

# --- CONFIG: point to folder and filenames ---
SCRIPT_DIR = Path(__file__).resolve().parent
SAVE_DIR = SCRIPT_DIR

ARTIFACTS = {
    "model": "random_forest_case_duration_model.joblib",
    "scaler": "model_scaler.joblib",
    "le_dept": "court_department_encoder.joblib",
    "le_type": "case_type_encoder.joblib",
    "le_loc": "court_location_encoder.joblib",
    "feature_names": "feature_names.joblib",  # optional; also tries feature_names.json
}

# Sensible sample inputs (case_type, court_location, court_department must match training categories)
SAMPLE_INPUTS = [
    {
        "court_department": "District Court",
        "case_type": "Small Claims",
        "court_location": "Cambridge District Court",
        "description": "Small claims case in a district court",
    },
    {
        "court_department": "Housing Court",
        "case_type": "Housing Court Summary Process",
        "court_location": "Boston Housing Court",
        "description": "Summary process (eviction) in housing court",
    },
    {
        "court_department": "Probate and Family Court",
        "case_type": "DR Custody, Support, and Parenting Time",
        "court_location": "Suffolk County Probate and Family Court",
        "description": "Custody/support case in probate and family court",
    },
    {
        "court_department": "The Superior Court",
        "case_type": "Contract / Business Cases",
        "court_location": "Middlesex County",
        "description": "Contract/business case in superior court",
    },
]


def load_artifacts(dir_path=None):
    """Load model, scaler, encoders (and optionally feature_names) from SAVE_DIR."""
    d = Path(dir_path or SAVE_DIR)
    loaded = {}

    for key, fname in ARTIFACTS.items():
        if key == "feature_names":
            path = d / fname
            json_path = d / "feature_names.json"
            if path.exists():
                loaded[key] = joblib.load(path)
                print(f"  ✓ Loaded {key}: {path.name}")
            elif json_path.exists():
                loaded[key] = json.loads(json_path.read_text())
                print(f"  ✓ Loaded {key}: {json_path.name}")
            else:
                loaded[key] = None
                print(f"  ✗ Not found: {fname} or feature_names.json")
            continue
        path = d / fname
        if path.exists():
            loaded[key] = joblib.load(path)
            print(f"  ✓ Loaded {key}: {path.name}")
        else:
            loaded[key] = None
            print(f"  ✗ Not found: {path.name}")

    if loaded.get("model") is None:
        print("\n  → Add the missing files from your training script, then run again.")
        raise FileNotFoundError(
            f"No model file found in {d}. Expected: random_forest_case_duration_model.joblib, "
            "model_scaler.joblib, court_*_encoder.joblib (and optionally feature_names.json)."
        )
    return loaded


def prepare_features(df, le_dept, le_type, le_loc, feature_names_ref=None):
    """
    Mirror training pipeline: label encode + one-hot, then align columns.
    df must have columns: court_department, case_type, court_location
    """
    df = df.copy()

    # Label encoding (same as training: dept_enc, type_enc, loc_enc)
    enc_map = [
        ("court_department", le_dept, "dept_enc"),
        ("case_type", le_type, "type_enc"),
        ("court_location", le_loc, "loc_enc"),
    ]
    for col, le, enc_name in enc_map:
        if le is None:
            raise ValueError(f"Missing encoder for {col}")
        classes = set(le.classes_)
        df[enc_name] = df[col].map(lambda x: le.transform([x])[0] if x in classes else -1)
        if (df[enc_name] == -1).any():
            df.loc[df[enc_name] == -1, enc_name] = 0

    dept_dummies = pd.get_dummies(df["court_department"], prefix="dept", drop_first=True)
    type_dummies = pd.get_dummies(df["case_type"], prefix="type", drop_first=True)
    loc_dummies = pd.get_dummies(df["court_location"], prefix="loc", drop_first=True)

    X = pd.concat(
        [df[["dept_enc", "type_enc", "loc_enc"]], dept_dummies, type_dummies, loc_dummies],
        axis=1,
    )

    # Align to training feature order if we have it
    if feature_names_ref is not None and len(feature_names_ref) > 0:
        for c in feature_names_ref:
            if c not in X.columns:
                X[c] = 0
        X = X[feature_names_ref]

    return X


def run_predictions(model, scaler, X):
    """Scale and predict."""
    if scaler is not None:
        X_scaled = scaler.transform(X)
    else:
        X_scaled = X
    return model.predict(X_scaled)


def evaluate(artifacts, test_csv_path, dir_path=None):
    """Load model, prepare features from CSV, and compute metrics if time_taken present."""
    from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error

    loaded = load_artifacts(dir_path)
    model = loaded["model"]
    scaler = loaded["scaler"]
    le_dept = loaded["le_dept"]
    le_type = loaded["le_type"]
    le_loc = loaded["le_loc"]
    feature_names = loaded.get("feature_names")

    df = pd.read_csv(test_csv_path)
    required = ["court_department", "case_type", "court_location"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Test CSV must have columns: {required}. Missing: {missing}")

    X = prepare_features(df, le_dept, le_type, le_loc, feature_names_ref=feature_names)
    y_pred = run_predictions(model, scaler, X)

    df = df.copy()
    df["predicted_time_taken"] = y_pred

    has_target = "time_taken" in df.columns and df["time_taken"].notna().any()
    if has_target:
        y_true = df["time_taken"].dropna()
        valid = df["time_taken"].notna()
        y_p = y_pred[valid.values]
        print("\n--- Evaluation (samples with non-null time_taken) ---")
        print(f"  R²       = {r2_score(y_true, y_p):.4f}")
        print(f"  RMSE     = {np.sqrt(mean_squared_error(y_true, y_p)):.2f} days")
        print(f"  MAE      = {mean_absolute_error(y_true, y_p):.2f} days")
        print(f"  N        = {valid.sum()}")

    print("\n--- Predictions (first 10 rows) ---")
    print(df.head(10).to_string())
    out_path = Path(test_csv_path).with_suffix(".predicted.csv")
    df.to_csv(out_path, index=False)
    print(f"\nFull predictions saved to: {out_path}")
    return df


def predict_single(artifacts, court_department, case_type, court_location, dir_path=None):
    """Single prediction from three strings."""
    loaded = load_artifacts(dir_path)
    df = pd.DataFrame([{
        "court_department": court_department,
        "case_type": case_type,
        "court_location": court_location,
    }])
    X = prepare_features(
        df,
        loaded["le_dept"],
        loaded["le_type"],
        loaded["le_loc"],
        feature_names_ref=loaded.get("feature_names"),
    )
    pred = run_predictions(loaded["model"], loaded["scaler"], X)
    return float(pred[0])


def main():
    parser = argparse.ArgumentParser(description="Test trained regression model (.joblib)")
    parser.add_argument(
        "mode",
        nargs="?",
        default="check",
        choices=["check", "eval", "predict", "demo"],
        help="check=load only; eval=CSV with metrics; predict=single; demo=sample prediction",
    )
    parser.add_argument(
        "input",
        nargs="?",
        help="For eval: path to CSV. For predict: not used (use --dept/--type/--loc).",
    )
    parser.add_argument("--dept", default="", help="court_department (for predict)")
    parser.add_argument("--type", dest="case_type", default="", help="case_type (for predict)")
    parser.add_argument("--loc", default="", help="court_location (for predict)")
    parser.add_argument("--dir", default=None, help="Folder containing .joblib files (default: script dir)")
    args = parser.parse_args()

    dir_path = Path(args.dir) if args.dir else SAVE_DIR
    print(f"Artifacts directory: {dir_path}\n")

    if args.mode == "check":
        load_artifacts(dir_path)
        print("\nAll available artifacts loaded successfully.")
        return

    if args.mode == "eval":
        if not args.input or not os.path.isfile(args.input):
            print("Usage: python test_regression_model.py eval <path_to_test.csv>")
            return
        evaluate(None, args.input, dir_path=dir_path)
        return

    if args.mode == "predict":
        if not all([args.dept, args.case_type, args.loc]):
            print("Usage: python test_regression_model.py predict --dept <dept> --type <type> --loc <loc>")
            return
        days = predict_single(
            None,
            args.dept.strip(),
            args.case_type.strip(),
            args.loc.strip(),
            dir_path=dir_path,
        )
        print(f"\nPredicted time_taken: {days:.1f} days")
        return

    if args.mode == "demo":
        # Run first sample input to "shoot out" the regression number
        sample = SAMPLE_INPUTS[0]
        print(f"Demo input: {sample['description']}")
        print(f"  court_department = {sample['court_department']!r}")
        print(f"  case_type        = {sample['case_type']!r}")
        print(f"  court_location   = {sample['court_location']!r}")
        days = predict_single(
            None,
            sample["court_department"],
            sample["case_type"],
            sample["court_location"],
            dir_path=dir_path,
        )
        print(f"\n>>> Predicted time_taken: {days:.1f} days")
        return


if __name__ == "__main__":
    main()
