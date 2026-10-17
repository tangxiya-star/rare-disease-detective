"""Export a finished run to recordings/<name>.json for replay in the demo.

    cd backend && RDD_DB_PATH=/path/to/db.sqlite3 uv run python -m tools.export_run RUN_ID NAME "Label shown in the UI"
"""

import json
import sys

from app.config import load_settings
from app.db import DB
from app.recordings import RECORDINGS, export_run


def main() -> None:
    run_id, name, label = sys.argv[1], sys.argv[2], sys.argv[3]
    rec = export_run(DB(load_settings().db_path), run_id, label)
    RECORDINGS.mkdir(exist_ok=True)
    out = RECORDINGS / f"{name}.json"
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    print(f"{out}: {len(rec['rows']['events'])} events, {rec['duration_s']} s, {rec['llm_backend']}")


if __name__ == "__main__":
    main()
