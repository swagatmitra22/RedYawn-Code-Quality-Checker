from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import List

from trinity_engine.ml.feature_extractor import FEATURE_ORDER


def train_model(dataset_csv: Path, output_model: Path) -> None:
    try:
        from sklearn.ensemble import RandomForestClassifier  # type: ignore
        from sklearn.model_selection import train_test_split  # type: ignore
        from sklearn.metrics import classification_report  # type: ignore
        import joblib  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "scikit-learn and joblib are required for training. "
            "Install with: pip install scikit-learn joblib"
        ) from exc

    rows: List[List[float]] = []
    labels: List[str] = []

    with dataset_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        expected = set(FEATURE_ORDER + ["label"])
        missing = expected - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Dataset is missing required columns: {sorted(missing)}")

        for row in reader:
            rows.append([float(row[name]) for name in FEATURE_ORDER])
            labels.append(str(row["label"]))

    if not rows:
        raise ValueError("Dataset is empty.")

    x_train, x_test, y_train, y_test = train_test_split(
        rows, labels, test_size=0.2, random_state=42, stratify=labels
    )

    model = RandomForestClassifier(
        n_estimators=250,
        max_depth=14,
        random_state=42,
        n_jobs=-1,
        class_weight="balanced",
    )
    model.fit(x_train, y_train)

    preds = model.predict(x_test)
    print(classification_report(y_test, preds))

    output_model.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "feature_order": FEATURE_ORDER,
        },
        output_model,
    )
    print(f"Saved model to: {output_model}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Trinity smell severity model.")
    parser.add_argument("--dataset", required=True, help="Path to CSV dataset with features + label.")
    parser.add_argument(
        "--output",
        default="trinity_engine/ml/model.pkl",
        help="Output model path.",
    )
    args = parser.parse_args()

    train_model(Path(args.dataset), Path(args.output))


if __name__ == "__main__":
    main()
