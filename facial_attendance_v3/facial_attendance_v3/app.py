from flask import Flask, render_template, Response, jsonify, request, make_response
import cv2
import numpy as np
import os
import csv
import pickle
from datetime import datetime, date

# InsightFace - no C++, no TensorFlow, works on Python 3.14
import insightface
from insightface.app import FaceAnalysis

app = Flask(__name__)

KNOWN_FACES_DIR = "known_faces"
ENCODINGS_FILE  = "encodings.pkl"
ATTENDANCE_DIR  = "attendance_logs"
THRESHOLD       = 0.5   # cosine similarity threshold (higher = stricter)

os.makedirs(ATTENDANCE_DIR, exist_ok=True)
os.makedirs(KNOWN_FACES_DIR, exist_ok=True)

# ─── Init InsightFace ─────────────────────────────────────────────────────────
face_app = FaceAnalysis(name="buffalo_sc", providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))

known_embeddings = []
known_names      = []
attendance_today = {}
recognition_active = False
camera = None


# ─── Embeddings ───────────────────────────────────────────────────────────────

def get_embedding(img_bgr):
    """Returns embedding array from a BGR image, or None if no face found."""
    faces = face_app.get(img_bgr)
    if faces:
        return faces[0].normed_embedding
    return None


def build_embeddings():
    global known_embeddings, known_names
    known_embeddings, known_names = [], []

    for person in os.listdir(KNOWN_FACES_DIR):
        person_dir = os.path.join(KNOWN_FACES_DIR, person)
        if not os.path.isdir(person_dir):
            continue
        for img_file in os.listdir(person_dir):
            img_path = os.path.join(person_dir, img_file)
            img = cv2.imread(img_path)
            if img is None:
                continue
            emb = get_embedding(img)
            if emb is not None:
                known_embeddings.append(emb)
                known_names.append(person)
                print(f"[INFO] Encoded: {person} / {img_file}")
            else:
                print(f"[WARN] No face found in {img_path}")

    with open(ENCODINGS_FILE, "wb") as f:
        pickle.dump({"embeddings": known_embeddings, "names": known_names}, f)
    print(f"[INFO] Built embeddings for {len(set(known_names))} people.")


def load_embeddings():
    global known_embeddings, known_names
    if os.path.exists(ENCODINGS_FILE):
        with open(ENCODINGS_FILE, "rb") as f:
            data = pickle.load(f)
            known_embeddings = data["embeddings"]
            known_names      = data["names"]
        print(f"[INFO] Loaded {len(known_names)} embeddings.")
    else:
        build_embeddings()


def identify(embedding):
    """Compare embedding against known faces, return best name or Unknown."""
    if not known_embeddings:
        return "Unknown"
    sims = [np.dot(embedding, k) for k in known_embeddings]
    best = int(np.argmax(sims))
    if sims[best] >= THRESHOLD:
        return known_names[best]
    return "Unknown"


# ─── Attendance ───────────────────────────────────────────────────────────────

def mark_attendance(name):
    if name in attendance_today:
        return False
    now    = datetime.now()
    status = "LATE" if now.hour >= 9 else "IN"
    t_str  = now.strftime("%H:%M:%S")
    attendance_today[name] = {"time": t_str, "status": status}

    today    = date.today().strftime("%Y-%m-%d")
    csv_path = os.path.join(ATTENDANCE_DIR, f"{today}.csv")
    new_file = not os.path.exists(csv_path)
    with open(csv_path, "a", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["Name", "Date", "Time", "Status"])
        w.writerow([name, today, t_str, status])
    return True


# ─── Video Stream ─────────────────────────────────────────────────────────────

def gen_frames():
    global camera, recognition_active
    camera = cv2.VideoCapture(0)
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    frame_count = 0

    while recognition_active:
        ok, frame = camera.read()
        if not ok:
            break

        frame_count += 1

        # Run recognition every 5 frames to keep CPU manageable
        if frame_count % 5 == 0:
            faces = face_app.get(frame)
            for face in faces:
                emb   = face.normed_embedding
                name  = identify(emb)
                color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)

                if name != "Unknown":
                    mark_attendance(name)

                # Draw bounding box
                box = face.bbox.astype(int)
                x1, y1, x2, y2 = box[0], box[1], box[2], box[3]
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.rectangle(frame, (x1, y2 - 28), (x2, y2), color, cv2.FILLED)
                cv2.putText(frame, name, (x1 + 4, y2 - 8),
                            cv2.FONT_HERSHEY_DUPLEX, 0.55, (0, 0, 0), 1)

        ret, buf = cv2.imencode(".jpg", frame)
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")

    if camera:
        camera.release()
        camera = None


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/video_feed")
def video_feed():
    return Response(gen_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")

@app.route("/start", methods=["POST"])
def start():
    global recognition_active
    recognition_active = True
    return jsonify({"status": "started"})

@app.route("/stop", methods=["POST"])
def stop():
    global recognition_active
    recognition_active = False
    return jsonify({"status": "stopped"})

@app.route("/attendance")
def get_attendance():
    return jsonify([
        {"name": k, "time": v["time"], "status": v["status"]}
        for k, v in attendance_today.items()
    ])

@app.route("/stats")
def get_stats():
    return jsonify({
        "present": len(attendance_today),
        "late":    sum(1 for v in attendance_today.values() if v["status"] == "LATE"),
        "total_enrolled": len(set(known_names))
    })

@app.route("/register", methods=["POST"])
def register():
    name = request.form.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    file = request.files.get("image")
    if not file:
        return jsonify({"error": "Image is required"}), 400

    person_dir = os.path.join(KNOWN_FACES_DIR, name)
    os.makedirs(person_dir, exist_ok=True)
    count    = len(os.listdir(person_dir))
    img_path = os.path.join(person_dir, f"{count+1}.jpg")
    file.save(img_path)
    build_embeddings()
    return jsonify({"message": f"Registered {name} successfully."})

@app.route("/rebuild", methods=["POST"])
def rebuild():
    build_embeddings()
    return jsonify({"message": f"Rebuilt for {len(set(known_names))} people."})

@app.route("/export")
def export():
    today    = date.today().strftime("%Y-%m-%d")
    csv_path = os.path.join(ATTENDANCE_DIR, f"{today}.csv")
    if not os.path.exists(csv_path):
        return jsonify({"error": "No attendance data for today"}), 404
    with open(csv_path) as f:
        content = f.read()
    resp = make_response(content)
    resp.headers["Content-Disposition"] = f"attachment; filename=attendance_{today}.csv"
    resp.headers["Content-Type"] = "text/csv"
    return resp


if __name__ == "__main__":
    load_embeddings()
    app.run(debug=True, threaded=True)
