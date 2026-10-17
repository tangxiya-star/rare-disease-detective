"""Offline hand-landmark extraction for a case video (MediaPipe Hands, 21 points per hand).

    uv run --python 3.11 --with mediapipe==0.10.14 --with opencv-python-headless==4.10.0.84 \
        python tools/extract_landmarks.py ../cases/01_guitarist_drd/movement.mov ../cases/01_guitarist_drd/landmarks.json

Output: normalized (0-1) image coordinates per frame, for display only. MediaPipe extracts
motion coordinates; it does not establish a diagnosis (PRD safety boundary).
"""

import json
import sys

import cv2
import mediapipe as mp


def main(src: str, out: str) -> None:
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames, detected = [], 0
    with mp.solutions.hands.Hands(static_image_mode=False, max_num_hands=2, model_complexity=1,
                                  min_detection_confidence=0.5, min_tracking_confidence=0.5) as hands:
        i = 0
        while True:
            ok, img = cap.read()
            if not ok:
                break
            res = hands.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            found = []
            if res.multi_hand_landmarks:
                for lm, hd in zip(res.multi_hand_landmarks, res.multi_handedness):
                    found.append({
                        "label": hd.classification[0].label, "score": round(hd.classification[0].score, 3),
                        "points": [[round(p.x, 4), round(p.y, 4)] for p in lm.landmark],
                    })
                detected += 1
            frames.append({"t": round(i / fps, 3), "hands": found})
            i += 1
    meta = {"source": src.split("/")[-1], "fps": fps, "width": w, "height": h, "frames": len(frames),
            "frames_with_hands": detected, "model": "MediaPipe Hands 0.10.14 (model_complexity=1)",
            "note": "Motion coordinates only; not a diagnosis. Labels are from the camera's view."}
    with open(out, "w") as f:
        json.dump({"meta": meta, "frames": frames}, f, separators=(",", ":"))
    print(json.dumps(meta))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
